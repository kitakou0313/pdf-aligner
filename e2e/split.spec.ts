import type { Page } from '@playwright/test';
import { A3, A4, A4_LANDSCAPE } from '../tests/fixtures/spec.ts';
import { RENDER_TIMEOUT_MS, chooseFile, dropFiles, expectRendered, downloadPng, openAndWait, throttleCpu, ui } from './helpers/app.ts';
import { test, expect } from './helpers/fixtures.ts';
import { gridOf, type Grid } from './helpers/geometry.ts';
import { canvasHash, pngHash } from './helpers/pixels.ts';
import { decodePng } from './helpers/png-decode.ts';
import { commitColumns, progressOf, waitForProgress, watchCanvasWidth, watchStatus } from './helpers/render-watch.ts';
import {
  a4Grid,
  collectDownloads,
  commitSeparators,
  expectBackground,
  expectImage,
  expectSegmentPages,
  failToBlobAt,
  holdToBlobAt,
  pageIndexAt,
  readSaved,
  releaseToBlob,
  segmentLabels,
  selectSegment,
} from './helpers/split.ts';
import { labelPercent, metrics, scrollOf, scrollTo } from './helpers/zoom.ts';

/** colored-12(A4 縦 12 ページ)を、区切り 4, 9、列数 4 で分けたときの、各セグメントの期待値(blueprint の例 8 と同じ考え方)。 */
interface Expected {
  readonly start: number;
  readonly label: string;
  /** 元の PDF での、セグメントの先頭ページ(0 始まり)。 */
  readonly first: number;
  readonly count: number;
  /** 実際の列数(列数 4 と、セグメントのページ数の小さい方)。 */
  readonly columns: number;
  readonly fileName: string;
}

const SEGMENTS: readonly Expected[] = [
  { start: 1, label: 'p.1–3(1/3)', first: 0, count: 3, columns: 3, fileName: 'colored-12-p01-03-3cols.png' },
  { start: 4, label: 'p.4–8(2/3)', first: 3, count: 5, columns: 4, fileName: 'colored-12-p04-08-4cols.png' },
  { start: 9, label: 'p.9–12(3/3)', first: 8, count: 4, columns: 4, fileName: 'colored-12-p09-12-4cols.png' },
];
const CONTROLS = ['pick', 'columns', 'separators', 'segment', 'zoomIn', 'zoomOut', 'zoomLevel', 'zoomFit', 'download'] as const;
const IDLE_TEXT = 'すべてPNGをダウンロード';

/** セグメントの期待するレイアウト(blueprint の式)。 */
function gridOfSegment(segment: Expected): Grid {
  return a4Grid(segment.count, segment.columns);
}

/** colored-12 を開いて、列数 4、区切り 4, 9 にして、先頭のセグメント(p.1–3)を描き終えた状態にする。 */
async function openSplit(page: Page): Promise<void> {
  await page.goto('/');
  await openAndWait(page, 'colored-12.pdf');
  await commitColumns(page, '4');
  await commitSeparators(page, '4, 9');
  await expectImage(page, gridOfSegment(SEGMENTS[0]!));
}

/** 「すべてPNGをダウンロード」を押して、一括保存が終わる(ボタンが元の文言に戻る)まで待つ。 */
async function downloadAllAndWait(page: Page): Promise<void> {
  await ui(page).downloadAll.click();
  await expect(ui(page).downloadAll).toHaveText(IDLE_TEXT, { timeout: RENDER_TIMEOUT_MS });
}

/** 「画面に合わせる」の倍率(表示の整数パーセント)を、領域の大きさと画面の密度から求める(上限は 100%)。 */
async function expectedFitPercent(page: Page, grid: Grid): Promise<number> {
  const area = await ui(page).preview.evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight, dpr: window.devicePixelRatio }));
  return Math.round(Math.min((area.width / grid.width) * area.dpr, (area.height / grid.height) * area.dpr, 1) * 100);
}

test.describe('区切りの入力(blueprint の F9、例 7。12 ページ)', () => {
  test('PDF を読み込むまでは無効。読み込むと欄は有効で、区切りなしのときは、セグメントの選択と「すべてPNGをダウンロード」は無効', async ({ page, shot }) => {
    await page.goto('/');
    for (const name of ['separators', 'segment', 'downloadAll'] as const) await expect(ui(page)[name], name).toBeDisabled();
    await openAndWait(page, 'colored-12.pdf');
    await expect(ui(page).separators).toBeEnabled();
    await expect(ui(page).separators).toHaveValue('');
    await expect(ui(page).separators).toHaveAttribute('placeholder', '例: 5, 12, 20');
    await expect(ui(page).segment).toBeDisabled();
    await expect(ui(page).downloadAll).toBeDisabled();
    expect(await segmentLabels(page)).toEqual(['p.1–12(1/1)']);
    await shot('区切りなし');
  });

  test('区切りを入力すると、セグメントの選択肢ができて、選択と「すべてPNGをダウンロード」が有効になる', async ({ page, shot }) => {
    await openSplit(page);
    await expect(ui(page).separators).toHaveValue('4, 9');
    expect(await segmentLabels(page)).toEqual(SEGMENTS.map((segment) => segment.label));
    await expect(ui(page).segment).toBeEnabled();
    await expect(ui(page).segment).toHaveValue('1');
    await expect(ui(page).downloadAll).toBeEnabled();
    await shot('区切り 4, 9');
  });

  const CASES: [string, string, string[]][] = [
    ['9, 4, 4', '4, 9', ['p.1–3(1/3)', 'p.4–8(2/3)', 'p.9–12(3/3)']],
    ['9, 4, 4, 1, 0, 99, x', '4, 9', ['p.1–3(1/3)', 'p.4–8(2/3)', 'p.9–12(3/3)']],
    ['12', '12', ['p.1–11(1/2)', 'p.12–12(2/2)']],
    ['2, 3', '2, 3', ['p.1–1(1/3)', 'p.2–2(2/3)', 'p.3–12(3/3)']],
    ['1', '', ['p.1–12(1/1)']],
    ['', '', ['p.1–12(1/1)']],
    ['4 9', '', ['p.1–12(1/1)']],
  ];
  for (const [input, written, labels] of CASES) {
    test(`${JSON.stringify(input)} → 欄は ${JSON.stringify(written)}、選択肢は ${labels.length} 個(確定したときの正規化)`, async ({ page }) => {
      await page.goto('/');
      await openAndWait(page, 'colored-12.pdf');
      await commitSeparators(page, input);
      await expect(ui(page).separators).toHaveValue(written);
      expect(await segmentLabels(page)).toEqual(labels);
      await expectRendered(page);
    });
  }

  test('入力の途中では、全ての項目が有効になったときだけ、待ち時間を置いて 1 回だけ反映する', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    const widths = await watchCanvasWidth(page);
    await ui(page).separators.pressSequentially('4, 9', { delay: 60 });
    await expect(ui(page).segment).toBeEnabled();
    await expectRendered(page);
    await page.waitForTimeout(600);
    expect(await widths.jsonValue(), '描画の開始は 1 回だけ(途中の「4,」では反映しない)').toEqual([a4Grid(3, 3).width]);
    expect(await segmentLabels(page)).toHaveLength(3);
  });

  test('入力の途中で反映できない値のときは、描き直さない。確定したときに、有効なものだけに整えて反映する', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    const widths = await watchCanvasWidth(page);
    await ui(page).separators.fill('4, 99');
    await page.waitForTimeout(700);
    expect(await widths.jsonValue(), '入力の途中では、範囲外の項目を含む値を反映しない').toEqual([]);
    expect(await segmentLabels(page)).toHaveLength(1);
    await ui(page).separators.blur();
    await expect(ui(page).separators).toHaveValue('4');
    expect(await segmentLabels(page)).toEqual(['p.1–3(1/2)', 'p.4–12(2/2)']);
  });

  test('Enter キーでも確定する', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    await ui(page).separators.fill('9, 4');
    await ui(page).separators.press('Enter');
    await expect(ui(page).separators).toHaveValue('4, 9');
    expect(await segmentLabels(page)).toHaveLength(3);
  });
});

test('各セグメントの画像は、そのセグメントのページだけを、実際の列数で並べる(ページの色は、元のページ番号に対応する)', async ({ page, shot }) => {
  await openSplit(page);
  for (const segment of SEGMENTS) {
    await selectSegment(page, segment.start);
    const grid = gridOfSegment(segment);
    await expectImage(page, grid);
    await expectSegmentPages(page, grid, segment.first, segment.count);
    await shot(segment.label);
  }
  await selectSegment(page, 4);
  const second = gridOfSegment(SEGMENTS[1]!);
  await expectImage(page, second);
  await expectBackground(page, second, [5, 6, 7]);
});

test('セルの大きさは、セグメントのページだけで決まる(ほかのセグメントのページの大きさに影響されない)', async ({ page, shot }) => {
  await page.goto('/');
  await openAndWait(page, 'mixed-sizes.pdf');
  await commitSeparators(page, '2');
  const first = gridOf([A4], 1, 2);
  const second = gridOf([A4_LANDSCAPE, A3], 2, 2);
  expect([first.width, first.height, second.width, second.height]).toEqual([1254, 1748, 3464, 2446]);
  await expectImage(page, first);
  await expectSegmentPages(page, first, 0, 1);
  await shot('p.1–1(A4 縦だけ)');
  await selectSegment(page, 2);
  await expectImage(page, second);
  await expectSegmentPages(page, second, 1, 2);
  await shot('p.2–3(A4 横と A3)');
});

test('ダウンロードした PNG は、表示中のセグメントの canvas と全ての画素が一致する。名前は規則どおりで、canvas は常に 1 枚', async ({ page, keepPng }) => {
  await openSplit(page);
  for (const segment of SEGMENTS) {
    await selectSegment(page, segment.start);
    const grid = gridOfSegment(segment);
    await expectImage(page, grid);
    const { fileName, data } = await downloadPng(page);
    await keepPng(segment.label, data);
    const png = decodePng(data);
    expect({ width: png.width, height: png.height }).toEqual({ width: grid.width, height: grid.height });
    expect({ width: png.width, height: png.height, sha256: pngHash(png) }).toEqual(await canvasHash(page));
    expect([fileName, png.opaque]).toEqual([segment.fileName, true]);
    // 出力画像の canvas(#canvas)は常に 1 枚。元PDFプレビュー(F11)のサムネイルは、別の canvas を持つ
    await expect(page.locator('#canvas')).toHaveCount(1);
  }
});

test('区切りを変えると、直前に表示していたセグメントの先頭ページを含むセグメントを表示する(blueprint の例 7)', async ({ page }) => {
  await openSplit(page);
  await selectSegment(page, 9);
  await commitSeparators(page, '4');
  expect(await segmentLabels(page)).toEqual(['p.1–3(1/2)', 'p.4–12(2/2)']);
  await expect(ui(page).segment, 'p.9–12 の先頭 9 を含む p.4–12').toHaveValue('4');
  await expectImage(page, a4Grid(9, 4));
  await commitSeparators(page, '6');
  await expect(ui(page).segment, 'p.4–12 の先頭 4 を含む p.1–5').toHaveValue('1');
  await expectImage(page, a4Grid(5, 4));
  await expectSegmentPages(page, a4Grid(5, 4), 0, 5);
  await commitSeparators(page, '');
  expect(await segmentLabels(page)).toEqual(['p.1–12(1/1)']);
  await expectImage(page, a4Grid(12, 4));
});

test('セグメントを切り替えても、「画面に合わせる」は追従し、固定の倍率は保たれて、スクロール位置は左上に戻る', async ({ page }) => {
  await openSplit(page);
  await expect(ui(page).zoomLevel).toHaveText(`${await expectedFitPercent(page, gridOfSegment(SEGMENTS[0]!))}%`);
  await selectSegment(page, 4);
  await expectImage(page, gridOfSegment(SEGMENTS[1]!));
  await expect(ui(page).zoomLevel, '画像が変わると、画面に合わせた倍率も変わる').toHaveText(`${await expectedFitPercent(page, gridOfSegment(SEGMENTS[1]!))}%`);
  await ui(page).zoomLevel.click();
  await scrollTo(page, 300, 300);
  await selectSegment(page, 9);
  await expectImage(page, gridOfSegment(SEGMENTS[2]!));
  expect(await labelPercent(page), '固定の倍率(100%)は保たれる').toBe(100);
  expect((await metrics(page)).zoom).toBeCloseTo(1, 3);
  expect(await scrollOf(page), 'スクロール位置は左上に戻る').toEqual({ x: 0, y: 0 });
});

test('描画中に区切りを変えると、進行中の描画を中断して、最初のセグメントを最初から描く(進捗の総数は、そのセグメントのページ数)', async ({ page, shot }) => {
  await page.goto('/');
  const log = await watchStatus(page);
  await throttleCpu(page, 6);
  await chooseFile(page, 'many-pages-30.pdf');
  const reached = await waitForProgress(page, 5);
  await commitSeparators(page, '5, 20');
  await shot('区切りを入力した直後');
  await throttleCpu(page, 1);
  await expectImage(page, a4Grid(4, 4));
  const texts = (await log.jsonValue()) as string[];
  const progress = progressOf(texts);
  const restart = progress.findIndex((n, i) => i > progress.indexOf(reached) && n < reached);
  expect(restart, '進捗が最初(0 付近)からやり直された').toBeGreaterThan(0);
  expect(Math.max(...progress.slice(0, restart)), '最初の描画は、最後まで進まずに中断された').toBeLessThan(30);
  expect(texts.some((text) => /描画中 \d+\/4 ページ/.test(text)), '進捗の総数は、p.1–4 のページ数(4)').toBe(true);
  expect(await segmentLabels(page)).toEqual(['p.1–4(1/3)', 'p.5–19(2/3)', 'p.20–30(3/3)']);
});

test('失敗したページは、元の PDF のページ番号で警告する。失敗したページを含まないセグメントには、警告を出さない', async ({ page }) => {
  /** 描画に失敗したページ(元の PDF の pageNumber ページ目)が 1 つだけのときの、警告の文言。 */
  const warning = (pageNumber: number): string => `1 ページの描画に失敗しました(ページ: ${pageNumber})`;
  await page.goto('/');
  await openAndWait(page, 'broken-page.pdf');
  await expect(ui(page).status).toHaveText(warning(2));
  await commitSeparators(page, '2');
  await expect(ui(page).status, 'p.1–1 には、失敗したページがない').toHaveText('');
  await selectSegment(page, 2);
  await expect(ui(page).status, 'p.2–3 の先頭のページ(セグメント内の 1 番目)でも、元の番号 2').toHaveText(warning(2));
  await commitSeparators(page, '3');
  await expect(ui(page).status, 'p.1–2 に含まれる').toHaveText(warning(2));
  await selectSegment(page, 3);
  await expect(ui(page).status, 'p.3–3 には、失敗したページがない').toHaveText('');
});

test.describe('すべてPNGをダウンロード(一括保存。blueprint の F10、例 9。colored-12、区切り 4, 9、列数 4)', () => {
  test('全セグメントを、先頭から順に、セグメントごとの PNG として保存する。全ての PNG のページを合わせると、元の全ページがちょうど 1 度ずつ現れる', async ({ page, shot, keepPng }) => {
    await openSplit(page);
    const downloads = collectDownloads(page);
    await downloadAllAndWait(page);
    await expect.poll(() => downloads.length).toBe(3);
    const saved = await Promise.all(downloads.map(readSaved));
    expect(saved.map((file) => file.fileName)).toEqual(SEGMENTS.map((segment) => segment.fileName));
    const found: number[] = [];
    for (const [index, file] of saved.entries()) {
      const segment = SEGMENTS[index]!;
      const grid = gridOfSegment(segment);
      const png = decodePng(file.data);
      await keepPng(segment.label, file.data);
      expect({ width: png.width, height: png.height, opaque: png.opaque }).toEqual({ width: grid.width, height: grid.height, opaque: true });
      for (let cell = 0; cell < segment.count; cell += 1) found.push(pageIndexAt(png, grid, cell, 12) ?? -1);
      expect(found.slice(-segment.count), `${segment.label} の各セルのページ`).toEqual(Array.from({ length: segment.count }, (_, i) => segment.first + i));
    }
    expect([...found].sort((a, b) => a - b), '全ページが、ちょうど 1 度ずつ').toEqual(Array.from({ length: 12 }, (_, i) => i));
    await shot('一括保存の後');
  });

  test('終わったら、保存を始める前のセグメントに戻り、操作は有効に戻る。完了の通知は出さず、canvas は 1 枚のまま', async ({ page }) => {
    await openSplit(page);
    await selectSegment(page, 4);
    await expectImage(page, gridOfSegment(SEGMENTS[1]!));
    await downloadAllAndWait(page);
    await expect(ui(page).segment).toHaveValue('4');
    await expectImage(page, gridOfSegment(SEGMENTS[1]!));
    await expectSegmentPages(page, gridOfSegment(SEGMENTS[1]!), 3, 5);
    await expect(ui(page).status).toHaveText('');
    for (const name of CONTROLS) await expect(ui(page)[name], name).toBeEnabled();
    // 出力画像の canvas(#canvas)は常に 1 枚。元PDFプレビュー(F11)のサムネイルは、別の canvas を持つ
    await expect(page.locator('#canvas')).toHaveCount(1);
  });

  test('保存中は、「キャンセル」以外の操作が無効になり、進捗は「保存中 K/N 個(範囲)」だけを出す(ページごとの「描画中」は出さない)。ドロップは無視される', async ({ page, shot }) => {
    await openSplit(page);
    const log = await watchStatus(page);
    await holdToBlobAt(page, 1);
    await ui(page).downloadAll.click();
    await expect(ui(page).status).toHaveText('保存中 1/3 個(p.1–3)');
    await expect(ui(page).downloadAll).toHaveText('キャンセル');
    await expect(ui(page).downloadAll).toBeEnabled();
    for (const name of CONTROLS) await expect(ui(page)[name], name).toBeDisabled();
    // 出力画像の canvas(#canvas)は常に 1 枚。元PDFプレビュー(F11)のサムネイルは、別の canvas を持つ
    await expect(page.locator('#canvas'), 'プレビューと同じ 1 枚の canvas').toHaveCount(1);
    await shot('一括保存中(1 個目の保存を待たせている)');
    expect(await dropFiles(page, ['single-page.pdf']), 'ブラウザの既定の動作(ファイルを開く)は止められる').toBe(true);
    await expect(ui(page).status, '別の PDF に置き換わらず、エラーも出ない').toHaveText('保存中 1/3 個(p.1–3)');
    await releaseToBlob(page);
    await expect(ui(page).downloadAll).toHaveText(IDLE_TEXT, { timeout: RENDER_TIMEOUT_MS });
    const texts = (await log.jsonValue()) as string[];
    const last = texts.lastIndexOf('保存中 3/3 個(p.9–12)');
    expect(new Set(texts.filter((text) => text.startsWith('保存中'))), '保存中の進捗').toEqual(new Set(['保存中 1/3 個(p.1–3)', '保存中 2/3 個(p.4–8)', '保存中 3/3 個(p.9–12)']));
    expect(texts.slice(0, last + 1).filter((text) => text.includes('描画中')), '保存中は、ページごとの「描画中」を出さない').toEqual([]);
    await expect(ui(page).separators, '別の PDF に置き換わっていない').toHaveValue('4, 9');
  });

  test('保存の途中でキャンセルすると、その保存が終わってから止まる。警告の個数は、実際に保存された個数で、以降は保存しない。元のセグメントに戻る', async ({ page, shot }) => {
    await openSplit(page);
    const downloads = collectDownloads(page);
    await holdToBlobAt(page, 2);
    await ui(page).downloadAll.click();
    await expect(ui(page).status).toHaveText('保存中 2/3 個(p.4–8)');
    await ui(page).downloadAll.click();
    await releaseToBlob(page);
    await expect(ui(page).status).toHaveText('保存をキャンセルしました。3 個中 2 個を保存しました。', { timeout: RENDER_TIMEOUT_MS });
    await shot('キャンセルした後');
    await page.waitForTimeout(700);
    expect(downloads, '警告の個数と、実際に保存されたファイルの数が一致する').toHaveLength(2);
    expect((await Promise.all(downloads.map(readSaved))).map((file) => file.fileName)).toEqual([SEGMENTS[0]!.fileName, SEGMENTS[1]!.fileName]);
    await expect(ui(page).segment).toHaveValue('1');
    await expectImage(page, gridOfSegment(SEGMENTS[0]!));
    for (const name of CONTROLS) await expect(ui(page)[name], name).toBeEnabled();
  });

  test('PNG を生成できなかったら、そこで止まり、以降は保存しない。警告に、そのセグメントの範囲と保存した個数を出す', async ({ page, shot }) => {
    await openSplit(page);
    const downloads = collectDownloads(page);
    await failToBlobAt(page, 2);
    await ui(page).downloadAll.click();
    await expect(ui(page).status).toHaveText('p.4–8 の画像が大きすぎて PNG を生成できませんでした。3 個中 1 個を保存しました。', { timeout: RENDER_TIMEOUT_MS });
    await shot('PNG を生成できなかった');
    await page.waitForTimeout(700);
    expect((await Promise.all(downloads.map(readSaved))).map((file) => file.fileName)).toEqual([SEGMENTS[0]!.fileName]);
    await expect(ui(page).segment).toHaveValue('1');
    await expectImage(page, gridOfSegment(SEGMENTS[0]!));
    for (const name of CONTROLS) await expect(ui(page)[name], name).toBeEnabled();
  });
});
