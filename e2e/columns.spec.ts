import type { Page } from '@playwright/test';
import { A4, pageColor } from '../tests/fixtures/spec.ts';
import { chooseFile, expectRendered, openAndWait, throttleCpu, ui } from './helpers/app.ts';
import { test, expect } from './helpers/fixtures.ts';
import { gridOf, pointIn } from './helpers/geometry.ts';
import { BACKGROUND, canvasPixels, expectColor } from './helpers/pixels.ts';
import { commitColumns, currentProgress, progressOf, waitForProgress, watchCanvasWidth, watchStatus } from './helpers/render-watch.ts';

const TWELVE_A4 = Array.from({ length: 12 }, () => A4);
const A4_150 = Array.from({ length: 150 }, () => A4);
const TOLERANCE = 3;

/** 12 ページの PDF を、その列数(既定 10)で描き終えた状態にする。 */
async function openTwelve(page: Page): Promise<void> {
  await page.goto('/');
  await openAndWait(page, 'colored-12.pdf');
}

test('列数を変えると、新しい列数で並べ直した画像になる(ページ順は行方向)', async ({ page, shot }) => {
  await openTwelve(page);
  await commitColumns(page, '4');
  const grid = gridOf(TWELVE_A4, 4, 2);
  await expect(ui(page).canvas).toHaveJSProperty('width', grid.width);
  await expect(ui(page).download).toBeEnabled();
  await shot('列数 4');
  await expect(ui(page).canvas).toHaveJSProperty('height', grid.height);
  for (const index of [0, 3, 4, 11]) {
    const [color] = await canvasPixels(page, [pointIn(grid.page(index), 0.8, 0.2)]);
    expectColor(color!, pageColor(index), TOLERANCE, `${index + 1} ページ目`);
  }
  const [empty] = await canvasPixels(page, [{ x: 3, y: grid.height - 4 }]);
  expectColor(empty!, BACKGROUND, 0, '外周の余白');
});

test.describe('確定したときの丸め(blueprint の例 3。12 ページ、既定 10)', () => {
  const CASES: [string, string, string][] = [
    ['15', '12', '総ページ数を超える値は、総ページ数に丸める'],
    ['0', '1', '0 は 1 に丸める'],
    ['-3', '1', '負の値は 1 に丸める'],
    ['3.6', '4', '小数は四捨五入する(切り上がる)'],
    ['3.4', '3', '小数は四捨五入する(切り下がる)'],
    ['', '10', '空欄は直前の値に戻る'],
  ];
  for (const [input, expected, reason] of CASES) {
    test(`${JSON.stringify(input)} → ${expected}(${reason})`, async ({ page }) => {
      await openTwelve(page);
      await commitColumns(page, input);
      await expect(ui(page).columns).toHaveValue(expected);
      await expect(ui(page).canvas).toHaveJSProperty('width', gridOf(TWELVE_A4, Number(expected), 2).width);
      await expect(ui(page).download).toBeEnabled();
    });
  }
});

test('Enter キーでも確定する', async ({ page }) => {
  await openTwelve(page);
  await ui(page).columns.fill('6');
  await ui(page).columns.press('Enter');
  await expect(ui(page).canvas).toHaveJSProperty('width', gridOf(TWELVE_A4, 6, 2).width);
});

test('入力の途中では、待ち時間を置いて、最後の値だけを反映する(途中の値では描かない)', async ({ page }) => {
  await openTwelve(page);
  const widths = await watchCanvasWidth(page);
  await ui(page).columns.fill('');
  await ui(page).columns.pressSequentially('12', { delay: 60 });
  await expect(ui(page).canvas).toHaveJSProperty('width', gridOf(TWELVE_A4, 12, 2).width);
  await expect(ui(page).download).toBeEnabled();
  await page.waitForTimeout(600);
  expect(await widths.jsonValue(), '描画の開始は 1 回だけ(途中の値 1 では描かない)').toEqual([gridOf(TWELVE_A4, 12, 2).width]);
});

test('入力の途中で、反映できない値(範囲外)になったら、描き直さない。確定したときに丸めて反映する', async ({ page }) => {
  await openTwelve(page);
  const widths = await watchCanvasWidth(page);
  await ui(page).columns.fill('99');
  await page.waitForTimeout(700);
  expect(await widths.jsonValue(), '入力の途中では、範囲外の値を反映しない').toEqual([]);
  await ui(page).columns.blur();
  await expect(ui(page).columns).toHaveValue('12');
  await expect(ui(page).canvas).toHaveJSProperty('width', gridOf(TWELVE_A4, 12, 2).width);
});

test('PDF を読み込むまでは、列数・ズーム・ダウンロードは無効(blueprint の「操作の可否」)', async ({ page, shot }) => {
  await page.goto('/');
  for (const name of ['columns', 'zoomIn', 'zoomOut', 'zoomLevel', 'zoomFit', 'download'] as const) {
    await expect(ui(page)[name], name).toBeDisabled();
  }
  await expect(ui(page).pick).toBeEnabled();
  await shot('未読み込み');
  await openAndWait(page, 'colored-12.pdf');
  for (const name of ['columns', 'zoomIn', 'zoomOut', 'zoomLevel', 'zoomFit', 'download'] as const) {
    await expect(ui(page)[name], name).toBeEnabled();
  }
});

test.describe('大きな PDF(150 ページ)の描画', () => {
  test('描きながら順次プレビューに表示し、進捗(描画中 N/150 ページ)を 1 ページごとに更新する', async ({ page, shot }) => {
    await page.goto('/');
    const log = await watchStatus(page);
    await throttleCpu(page, 4);
    await chooseFile(page, 'many-pages-150.pdf');
    await waitForProgress(page, 40);
    const width = await ui(page).canvas.evaluate((c: HTMLCanvasElement) => c.width);
    const grid = gridOf(A4_150, 10, width / (32 + 10 * 595 + 9 * 16));
    const [first, last] = await canvasPixels(page, [pointIn(grid.page(0), 0.8, 0.2), pointIn(grid.page(149), 0.8, 0.2)]);
    // ページは順に描かれるので、標本を取った後でまだ 150 未満なら、標本を取った時点でも、最後のページは描かれていない
    expect(await currentProgress(page), '標本を取った後も、描画中(標本が有効)').toBeLessThan(150);
    expectColor(first!, pageColor(0), TOLERANCE, '描き終えたページ');
    expectColor(last!, BACKGROUND, 0, 'まだ描いていないページ(背景色のまま)');
    await shot('描画の途中');
    await expect(ui(page).download, '描画中は、ダウンロードできない').toBeDisabled();
    await expect(ui(page).columns, '描画中も、列数は変えられる').toBeEnabled();
    await throttleCpu(page, 1);
    await expectRendered(page);
    const progress = progressOf((await log.jsonValue()) as string[]);
    expect(progress.at(-1)).toBe(150);
    expect(progress, '進捗は増える一方').toEqual([...progress].sort((a, b) => a - b));
    expect(new Set(progress).size, '1 ページごとに更新される').toBeGreaterThan(40);
  });

  test('描画中に列数の欄へ入力しているとき、進捗の更新で、入力中の文字を消されない', async ({ page }) => {
    await page.goto('/');
    await throttleCpu(page, 4);
    await chooseFile(page, 'many-pages-150.pdf');
    await waitForProgress(page, 10);
    await ui(page).columns.fill('999');
    const typedAt = await waitForProgress(page, 10);
    await waitForProgress(page, typedAt + 5);
    await expect(ui(page).columns, '範囲外(150 ページなので 999 は範囲外)の値は反映されず、入力した文字がそのまま残る').toHaveValue('999');
    await throttleCpu(page, 1);
    await ui(page).columns.blur();
    await expect(ui(page).columns).toHaveValue('150');
    await expectRendered(page);
  });

  test('描画中に列数を変えると、進行中の描画を中断して、最初から描き直す', async ({ page, shot }) => {
    await page.goto('/');
    const log = await watchStatus(page);
    await throttleCpu(page, 4);
    await chooseFile(page, 'many-pages-150.pdf');
    const reached = await waitForProgress(page, 30);
    await commitColumns(page, '15');
    await expect(ui(page).columns).toHaveValue('15');
    await shot('列数を変更した直後');
    await throttleCpu(page, 1);
    await expectRendered(page);
    const progress = progressOf((await log.jsonValue()) as string[]);
    const restart = progress.findIndex((n, i) => i > progress.indexOf(reached) && n < reached);
    expect(restart, '進捗が最初(0 付近)からやり直された').toBeGreaterThan(0);
    expect(Math.max(...progress.slice(0, restart)), '最初の描画は、最後まで進まずに中断された').toBeLessThan(150);
    const width = await ui(page).canvas.evaluate((c: HTMLCanvasElement) => c.width);
    const grid = gridOf(A4_150, 15, width / (32 + 15 * 595 + 14 * 16));
    const points = [0, 14, 15, 149].map((i) => pointIn(grid.page(i), 0.8, 0.2));
    const colors = await canvasPixels(page, points);
    [0, 14, 15, 149].forEach((index, i) => expectColor(colors[i]!, pageColor(index), TOLERANCE, `${index + 1} ページ目(15 列)`));
    await shot('15 列で描き直した結果');
  });

  test('描画中に別の PDF を選ぶと、進行中の描画を中断して、新しい PDF だけになる', async ({ page }) => {
    await page.goto('/');
    await throttleCpu(page, 4);
    await chooseFile(page, 'many-pages-150.pdf');
    await waitForProgress(page, 20);
    expect(await currentProgress(page), '切り替える時点で、150 ページの描画は終わっていない').toBeLessThan(150);
    await chooseFile(page, 'single-page.pdf');
    await throttleCpu(page, 1);
    await expectRendered(page);
    const grid = gridOf([A4], 1, 2);
    await expect(ui(page).canvas).toHaveJSProperty('width', grid.width);
    await expect(ui(page).canvas).toHaveJSProperty('height', grid.height);
    await expect(ui(page).columns).toHaveValue('1');
    await expect(ui(page).status).toHaveText('');
    const [color] = await canvasPixels(page, [pointIn(grid.page(0), 0.8, 0.2)]);
    expectColor(color!, pageColor(0), TOLERANCE, '新しい PDF の 1 ページ目');
  });
});
