import { readFile } from 'node:fs/promises';
import { A4, pageColor } from '../tests/fixtures/spec.ts';
import { ERROR_TEXT } from '../src/core/messages.ts';
import { chooseFile, downloadPng, dropFiles, expectRendered, openAndWait, ui } from './helpers/app.ts';
import { test, expect } from './helpers/fixtures.ts';
import { gridOf, pointIn } from './helpers/geometry.ts';
import { decodePng, pixelAt } from './helpers/png-decode.ts';
import { BACKGROUND, canvasPixels, expectColor } from './helpers/pixels.ts';
import { fixturePath } from './helpers/pdf-files.ts';
import { commitColumns } from './helpers/render-watch.ts';

// 文言は、blueprint の F8 に書いてあるものを、そのまま書く(実装の定数ではなく、仕様が根拠)
const PASSWORD_ERROR = 'パスワードで保護された PDF には対応していません。';
const INVALID_ERROR = 'PDF を読み込めませんでした。ファイルが壊れているか、PDF ではない可能性があります。';
const EMPTY_ERROR = 'ページがありません。';
const MULTIPLE_ERROR = 'PDF は 1 ファイルだけ指定してください。';
const PNG_ERROR = '画像が大きすぎて PNG を生成できませんでした。列数を変更するか、PDF を分割してお試しください。';
const TWELVE_A4 = Array.from({ length: 12 }, () => A4);

test.describe('読み込めないファイル(エラー表示。未読み込みの状態に戻る)', () => {
  const CASES: [string, string, string][] = [
    ['encrypted.pdf', PASSWORD_ERROR, 'パスワード付き PDF'],
    ['broken-garbage.pdf', INVALID_ERROR, '見出しだけで中身がない PDF'],
    ['broken-truncated.pdf', INVALID_ERROR, '途中で切れた PDF'],
    ['not-a-pdf.txt', INVALID_ERROR, 'PDF ではないファイル'],
    ['zero-pages.pdf', EMPTY_ERROR, '0 ページの PDF'],
  ];
  for (const [file, message, label] of CASES) {
    test(`${label}(${file})は、「${message}」を表示して、操作は未読み込みの状態のまま`, async ({ page, shot }) => {
      await page.goto('/');
      await chooseFile(page, file);
      await expect(ui(page).status).toHaveText(message);
      await shot(label);
      for (const name of ['columns', 'zoomIn', 'zoomOut', 'zoomLevel', 'zoomFit', 'download'] as const) {
        await expect(ui(page)[name], name).toBeDisabled();
      }
      await expect(ui(page).pick).toBeEnabled();
      await expect(page.locator('#placeholder')).toBeVisible();
      await expect(ui(page).stage).toBeHidden();
    });
  }

  test('メッセージの文言は、実装の定数と、blueprint の F8 の文言が一致している', () => {
    expect(ERROR_TEXT.encrypted).toBe(PASSWORD_ERROR);
    expect(ERROR_TEXT.invalid).toBe(INVALID_ERROR);
    expect(ERROR_TEXT.empty).toBe(EMPTY_ERROR);
    expect(ERROR_TEXT.multipleFiles).toBe(MULTIPLE_ERROR);
    expect(ERROR_TEXT.pngFailed).toBe(PNG_ERROR);
  });

  test('読み込みに失敗すると、表示中だった前の PDF は破棄され、エラーだけが残る', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    await chooseFile(page, 'encrypted.pdf');
    await expect(ui(page).status).toHaveText(PASSWORD_ERROR);
    await expect(ui(page).stage).toBeHidden();
    await expect(page.locator('#placeholder')).toBeVisible();
    await expect(ui(page).columns).toHaveValue('');
    await expect(ui(page).canvas).toHaveJSProperty('width', 0);
  });

  test('エラーの後に、正しい PDF を選ぶと、エラーは消えて、通常どおり読み込める', async ({ page }) => {
    await page.goto('/');
    await chooseFile(page, 'broken-garbage.pdf');
    await expect(ui(page).status).toHaveText(INVALID_ERROR);
    await openAndWait(page, 'single-page.pdf');
    await expect(ui(page).status).toHaveText('');
    await expect(ui(page).canvas).toHaveJSProperty('width', gridOf([A4], 1, 2).width);
  });

  test('PDF かどうかは、拡張子ではなく中身で決まる(.txt の名前の PDF は読める。名前の拡張子は .pdf だけ取り除く)', async ({ page }) => {
    await page.goto('/');
    const buffer = await readFile(fixturePath('single-page.pdf'));
    await page.setInputFiles('#file-input', { name: 'report.txt', mimeType: 'text/plain', buffer });
    await expectRendered(page);
    expect((await downloadPng(page)).fileName).toBe('report.txt-1cols.png');
  });
});

test.describe('複数ファイルのドロップ', () => {
  test('どれも読み込まず、エラーを出す。表示中の PDF、画像、列数、倍率はそのまま残る', async ({ page, shot }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    await commitColumns(page, '4');
    await expect(ui(page).canvas).toHaveJSProperty('width', gridOf(TWELVE_A4, 4, 2).width);
    await expect(ui(page).download).toBeEnabled();
    await ui(page).zoomIn.click();
    const label = await ui(page).zoomLevel.innerText();
    await dropFiles(page, ['single-page.pdf', 'mixed-sizes.pdf']);
    await expect(ui(page).status).toHaveText(MULTIPLE_ERROR);
    await shot('複数ファイルのドロップを拒否');
    await expect(ui(page).columns).toHaveValue('4');
    await expect(ui(page).zoomLevel).toHaveText(label);
    await expect(ui(page).download).toBeEnabled();
    await expect(ui(page).canvas).toHaveJSProperty('width', gridOf(TWELVE_A4, 4, 2).width);
    const [color] = await canvasPixels(page, [pointIn(gridOf(TWELVE_A4, 4, 2).page(5), 0.8, 0.2)]);
    expectColor(color!, pageColor(5), 3, '6 ページ目(前の PDF のまま)');
  });

  test('未読み込みのときに複数ファイルをドロップしても、エラーを出すだけ', async ({ page }) => {
    await page.goto('/');
    await dropFiles(page, ['single-page.pdf', 'colored-12.pdf']);
    await expect(ui(page).status).toHaveText(MULTIPLE_ERROR);
    await expect(ui(page).download).toBeDisabled();
    await expect(page.locator('#placeholder')).toBeVisible();
  });

  test('エラーは、次の列数の変更で消える', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    await dropFiles(page, ['single-page.pdf', 'colored-12.pdf']);
    await expect(ui(page).status).toHaveText(MULTIPLE_ERROR);
    await commitColumns(page, '6');
    await expect(ui(page).canvas).toHaveJSProperty('width', gridOf(TWELVE_A4, 6, 2).width);
    await expect(ui(page).status).not.toHaveText(MULTIPLE_ERROR);
    await expect(ui(page).download).toBeEnabled();
    await expect(ui(page).status).toHaveText('');
  });

  test('エラーは、別の PDF の選択で消える', async ({ page }) => {
    await page.goto('/');
    await dropFiles(page, ['single-page.pdf', 'colored-12.pdf']);
    await expect(ui(page).status).toHaveText(MULTIPLE_ERROR);
    await openAndWait(page, 'single-page.pdf');
    await expect(ui(page).status).toHaveText('');
  });
});

test.describe('ドロップの取り扱い', () => {
  test('プレビュー領域の外にドロップしても、ブラウザがファイルを開いて画面が遷移することはない(既定の動作を止める)', async ({ page }) => {
    await page.goto('/');
    const url = page.url();
    expect(await dropFiles(page, ['single-page.pdf'], 'body'), 'ブラウザの既定の動作が止められた').toBe(true);
    expect(await dropFiles(page, ['single-page.pdf'], '.toolbar')).toBe(true);
    expect(page.url()).toBe(url);
    await expect(ui(page).download, '領域の外へのドロップは、読み込みにならない').toBeDisabled();
  });

  test('ファイルを 1 つドロップすると読み込む(ドロップ以外の、領域内のイベントは邪魔しない)', async ({ page }) => {
    await page.goto('/');
    expect(await dropFiles(page, ['single-page.pdf'])).toBe(true);
    await expectRendered(page);
  });
});

test.describe('一部のページの描画に失敗したとき(broken-page.pdf: 3 ページのうち 2 ページ目)', () => {
  const THREE = [A4, A4, A4];

  test('他のページは描き、失敗したページのセルは背景色のまま(目印なし)。警告に、失敗したページ番号を出す', async ({ page, shot }) => {
    await page.goto('/');
    await openAndWait(page, 'broken-page.pdf');
    await shot('2 ページ目の描画に失敗');
    await expect(ui(page).status).toHaveText('1 ページの描画に失敗しました(ページ: 2)');
    await expect(ui(page).status.locator('.warning')).toHaveCount(1);
    const grid = gridOf(THREE, 3, 2);
    await expect(ui(page).canvas).toHaveJSProperty('width', grid.width);
    const cell = grid.cell(1);
    const points = [pointIn(grid.page(0), 0.8, 0.2), pointIn(grid.page(2), 0.8, 0.2), pointIn(cell, 0.5, 0.5), pointIn(cell, 0.05, 0.05), pointIn(cell, 0.95, 0.95)];
    const [first, third, middle, corner1, corner2] = await canvasPixels(page, points);
    expectColor(first!, pageColor(0), 3, '1 ページ目');
    expectColor(third!, pageColor(2), 3, '3 ページ目');
    for (const [name, color] of [['中央', middle], ['左上', corner1], ['右下', corner2]] as const) {
      expectColor(color!, BACKGROUND, 0, `失敗したページのセル(${name})は背景色のまま`);
    }
  });

  test('警告が出ていても、ダウンロードはできる。PNG でも、失敗したページのセルは背景色', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'broken-page.pdf');
    const { data } = await downloadPng(page);
    const png = decodePng(data);
    const grid = gridOf(THREE_PAGES, 3, 2);
    expect([png.width, png.height]).toEqual([grid.width, grid.height]);
    const middle = pointIn(grid.cell(1), 0.5, 0.5);
    expectColor(pixelAt(png, middle.x, middle.y), BACKGROUND, 0, 'PNG の、失敗したページのセル');
    const first = pointIn(grid.page(0), 0.8, 0.2);
    expectColor(pixelAt(png, first.x, first.y), pageColor(0), 3, 'PNG の 1 ページ目');
    await expect(ui(page).status, '警告は、ダウンロードのあとも出し続ける').toHaveText('1 ページの描画に失敗しました(ページ: 2)');
  });

  test('列数を変えて描き直しても、(同じページが失敗するので)警告が出る', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'broken-page.pdf');
    await commitColumns(page, '1');
    await expect(ui(page).canvas).toHaveJSProperty('height', gridOf(THREE_PAGES, 1, 2).height);
    await expect(ui(page).download).toBeEnabled();
    await expect(ui(page).status).toHaveText('1 ページの描画に失敗しました(ページ: 2)');
  });
});

const THREE_PAGES = [A4, A4, A4];

test.describe('PNG を生成できなかったとき', () => {
  test('保存せずに、「画像が大きすぎて…」を表示する。完了の状態のままで、列数を変えるとエラーは消える', async ({ page, shot }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    await page.evaluate(() => {
      /** ブラウザが PNG を生成できない状況を、toBlob が(常に)null を返すことで再現する。 */
      HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback): void {
        callback(null);
      };
    });
    let downloaded = false;
    page.on('download', () => (downloaded = true));
    await ui(page).download.click();
    await expect(ui(page).status).toHaveText(PNG_ERROR);
    await shot('PNG を生成できなかった');
    expect(downloaded, '保存されない').toBe(false);
    await expect(ui(page).download, '完了の状態のまま').toBeEnabled();
    await expect(ui(page).canvas).toHaveJSProperty('width', gridOf(TWELVE_A4, 10, 2).width);
    await commitColumns(page, '5');
    await expect(ui(page).canvas).toHaveJSProperty('width', gridOf(TWELVE_A4, 5, 2).width);
    await expect(ui(page).download).toBeEnabled();
    await expect(ui(page).status, 'エラーは、次の列数の変更で消える').toHaveText('');
  });
});
