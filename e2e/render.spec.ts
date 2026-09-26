import type { Page } from '@playwright/test';
import { A3, A4, A4_LANDSCAPE, pageColor } from '../tests/fixtures/spec.ts';
import { chooseFile, downloadPng, dropFiles, expectRendered, openAndWait, ui } from './helpers/app.ts';
import { test, expect } from './helpers/fixtures.ts';
import { gridOf, pointIn, type Grid } from './helpers/geometry.ts';
import { decodePng, pixelAt } from './helpers/png-decode.ts';
import { BACKGROUND, canvasHash, canvasPixels, expectColor, pngHash } from './helpers/pixels.ts';

// 期待する画像は、blueprint の計算式(e2e/helpers/geometry.ts)と、フィクスチャの仕様(ページの色)から求める
const TWELVE_A4 = Array.from({ length: 12 }, () => A4);
const MIXED = [A4, A4_LANDSCAPE, A3];
// pdf.js の色の丸めで ±1〜2 ずれうる
const TOLERANCE = 3;

/** 各ページの内側の 1 点の色が、そのページの色であることを、画面の canvas で確かめる。 */
async function expectPageColors(page: Page, grid: Grid, pageCount: number): Promise<void> {
  const points = Array.from({ length: pageCount }, (_, i) => pointIn(grid.page(i), 0.8, 0.2));
  const colors = await canvasPixels(page, points);
  colors.forEach((color, i) => expectColor(color, pageColor(i), TOLERANCE, `${i + 1} ページ目`));
}

test('PDF を選ぶと、全ページを行方向に並べた 1 枚の画像がプレビューされる', async ({ page, shot }) => {
  await page.goto('/');
  await shot('初期表示');
  await openAndWait(page, 'colored-12.pdf');
  await shot('描画完了');
  const grid = gridOf(TWELVE_A4, 10, 2);
  await expect(ui(page).canvas).toHaveJSProperty('width', grid.width);
  await expect(ui(page).canvas).toHaveJSProperty('height', grid.height);
  await expect(ui(page).columns).toHaveValue('10');
  await expect(ui(page).status).toHaveText('');
  await expectPageColors(page, grid, 12);
});

test('ページは、セルの位置にちょうど収まり、隙間・外周・空きセルは背景色のまま', async ({ page }) => {
  await page.goto('/');
  await openAndWait(page, 'colored-12.pdf');
  const grid = gridOf(TWELVE_A4, 10, 2);
  const first = grid.page(0);
  const probes = {
    firstPageTopLeft: { x: first.x, y: first.y },
    justOutsideLeft: { x: first.x - 1, y: first.y },
    justOutsideAbove: { x: first.x, y: first.y - 1 },
    firstPageBottomRight: { x: first.x + first.width - 1, y: first.y + first.height - 1 },
    justOutsideRight: { x: first.x + first.width, y: first.y },
    justOutsideBelow: { x: first.x, y: first.y + first.height },
    gapBetweenPages: { x: first.x + first.width + 16, y: first.y + 400 },
    outerMarginTopLeft: { x: 3, y: 3 },
    outerMarginBottomRight: { x: grid.width - 4, y: grid.height - 4 },
    // 12 ページを 10 列に並べると、2 行目の 11・12 ページ目の右(セル 12〜19)が空く
    emptyCell: pointIn(grid.cell(12), 0.5, 0.5),
    lastEmptyCell: pointIn(grid.cell(19), 0.5, 0.5),
  };
  const colors = await canvasPixels(page, Object.values(probes));
  const byName = Object.fromEntries(Object.keys(probes).map((name, i) => [name, colors[i]!]));
  expectColor(byName.firstPageTopLeft!, pageColor(0), TOLERANCE, '1 ページ目の左上の画素');
  expectColor(byName.firstPageBottomRight!, pageColor(0), TOLERANCE, '1 ページ目の右下の画素');
  for (const name of ['justOutsideLeft', 'justOutsideAbove', 'justOutsideRight', 'justOutsideBelow', 'gapBetweenPages', 'outerMarginTopLeft', 'outerMarginBottomRight', 'emptyCell', 'lastEmptyCell']) {
    expectColor(byName[name]!, BACKGROUND, 0, name);
  }
});

test('ダウンロードした PNG は、プレビューの canvas と全ての画素が一致する(同じ 1 枚の画像)', async ({ page, keepPng }) => {
  await page.goto('/');
  await openAndWait(page, 'mixed-sizes.pdf');
  const { fileName, data } = await downloadPng(page);
  await keepPng('ダウンロードした画像', data);
  const grid = gridOf(MIXED, 3, 2);
  const png = decodePng(data);
  expect({ width: png.width, height: png.height }).toEqual({ width: grid.width, height: grid.height });
  expect({ width: png.width, height: png.height, sha256: pngHash(png) }).toEqual(await canvasHash(page));
  expect(png.opaque, 'PNG は不透明').toBe(true);
  expect(fileName).toBe('mixed-sizes-3cols.png');
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('ダウンロードした PNG では、各ページの色と位置が期待どおりで、全体が不透明', async ({ page }) => {
  await page.goto('/');
  await openAndWait(page, 'colored-12.pdf');
  const { data } = await downloadPng(page);
  const grid = gridOf(TWELVE_A4, 10, 2);
  const png = decodePng(data);
  expect({ width: png.width, height: png.height }).toEqual({ width: grid.width, height: grid.height });
  expect(png.opaque, 'PNG は不透明').toBe(true);
  for (let i = 0; i < 12; i += 1) {
    const { x, y } = pointIn(grid.page(i), 0.8, 0.2);
    expectColor(pixelAt(png, x, y), pageColor(i), TOLERANCE, `PNG の ${i + 1} ページ目`);
  }
  expectColor(pixelAt(png, 3, 3), BACKGROUND, 0, 'PNG の外周の余白');
});

test('サイズの違うページは、セルの中央に、縮小せずに置かれる(blueprint の例 2 と同じ考え方)', async ({ page, shot }) => {
  await page.goto('/');
  await openAndWait(page, 'mixed-sizes.pdf');
  await shot('サイズの違うページ');
  const grid = gridOf(MIXED, 3, 2);
  await expect(ui(page).canvas).toHaveJSProperty('width', grid.width);
  await expectPageColors(page, grid, 3);
  const landscape = grid.page(1);
  const outside = await canvasPixels(page, [{ x: landscape.x + 10, y: landscape.y - 10 }]);
  expectColor(outside[0]!, BACKGROUND, 0, '横向きのページの上の余白(セルの中で、ページの外)');
});

test('画面に合わせた倍率で表示される(全体がプレビュー領域に収まり、上限は 100%)', async ({ page }) => {
  await page.goto('/');
  await openAndWait(page, 'colored-12.pdf');
  const grid = gridOf(TWELVE_A4, 10, 2);
  const area = await ui(page).preview.evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight, dpr: window.devicePixelRatio }));
  const zoom = Math.min((area.width / grid.width) * area.dpr, (area.height / grid.height) * area.dpr, 1);
  await expect(ui(page).zoomLevel).toHaveText(`${Math.round(zoom * 100)}%`);
  const box = await ui(page).stage.boundingBox();
  expect(box!.width).toBeCloseTo((grid.width * zoom) / area.dpr, 0);
  expect(box!.height).toBeCloseTo((grid.height * zoom) / area.dpr, 0);
});

test('ファイルを 1 つだけプレビュー領域にドロップしても、読み込まれる', async ({ page, shot }) => {
  await page.goto('/');
  await dropFiles(page, ['single-page.pdf']);
  await expectRendered(page);
  await shot('ドロップして読み込んだ');
  const grid = gridOf([A4], 1, 2);
  await expect(ui(page).canvas).toHaveJSProperty('width', grid.width);
  await expect(ui(page).columns).toHaveValue('1');
});

test('同じファイルを続けて選んでも、もう一度読み込む(ダウンロードが、いったん無効になってから、有効に戻る)', async ({ page }) => {
  await page.goto('/');
  await openAndWait(page, 'single-page.pdf');
  const seen = await page.evaluateHandle(() => {
    const button = document.querySelector<HTMLButtonElement>('#download')!;
    const log: boolean[] = [];
    new MutationObserver(() => log.push(button.disabled)).observe(button, { attributes: true, attributeFilter: ['disabled'] });
    return log;
  });
  await chooseFile(page, 'single-page.pdf');
  await expectRendered(page);
  const log = (await seen.jsonValue()) as boolean[];
  expect(log, 'いったん無効になった').toContain(true);
  expect(log.at(-1), '最後は有効に戻った').toBe(false);
});
