import type { Page } from '@playwright/test';
import { A4, pageColor } from '../tests/fixtures/spec.ts';
import { chooseFile, downloadPng, expectRendered, openAndWait, throttleCpu, ui } from './helpers/app.ts';
import { test, expect } from './helpers/fixtures.ts';
import { readPngSize } from './helpers/png-decode.ts';
import { canvasPixels, expectColor } from './helpers/pixels.ts';
import { commitColumns, currentProgress, waitForProgress } from './helpers/render-watch.ts';
import { gridOf, pointIn } from './helpers/geometry.ts';
import { metrics } from './helpers/zoom.ts';

// F3 の実測値(Playwright 同梱の Chromium。canvas の 1 辺と面積の上限)
const MAX_SIDE = 65_535;
const MAX_AREA = 268_435_456;
// 1 倍のときの、A4 の 1 ページの大きさ(pt)と、隙間・余白(blueprint の計算式。例 6)
const PAGE_W = 595;
const PAGE_H = 842;
const GAP = 16;
const PAGES = 150;

test.setTimeout(300_000);

/** 1 倍のときの画像の大きさ(A4 を 150 ページ、列数 columns)。blueprint の式: W = 2g + c×cw + (c−1)×g。 */
function sizeAtOneX(columns: number): { width: number; height: number } {
  const rows = Math.ceil(PAGES / columns);
  return {
    width: 2 * GAP + columns * PAGE_W + (columns - 1) * GAP,
    height: 2 * GAP + rows * PAGE_H + (rows - 1) * GAP,
  };
}

/** 上限(辺と面積)に収まる、最大の倍率(目標 2 まで)。blueprint の F3 の式。 */
function expectedScale(columns: number): number {
  const { width, height } = sizeAtOneX(columns);
  return Math.min(2, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_AREA / (width * height)));
}

/** ステータス行の縮小の通知(実際の倍率と、画像の大きさ)を読む。なければ null。 */
async function shrinkNotice(page: Page): Promise<{ scale: string; width: number; height: number } | null> {
  const text = await ui(page).status.innerText();
  const match = /画像が大きいため縮小しました。実際の倍率 ([\d.]+)倍\(([\d,]+) × ([\d,]+) px\)/.exec(text);
  if (!match) return null;
  return { scale: match[1]!, width: Number(match[2]!.replaceAll(',', '')), height: Number(match[3]!.replaceAll(',', '')) };
}

/** 画面の canvas の大きさ。 */
async function canvasSize(page: Page): Promise<{ width: number; height: number }> {
  return ui(page).canvas.evaluate((c: HTMLCanvasElement) => ({ width: c.width, height: c.height }));
}

test.describe('自動縮小(150 ページ。2 倍のままでは canvas の上限を超える)', () => {
  test('既定の列数(10)では、面積の上限に収まる最大の倍率まで縮小し、実際の倍率と画素数を通知する', async ({ page, shot }) => {
    await page.goto('/');
    await openAndWait(page, 'many-pages-150.pdf');
    await shot('縮小して描画');
    const size = await canvasSize(page);
    const notice = await shrinkNotice(page);
    expect(notice, '縮小の通知が出ている').not.toBeNull();
    expect({ width: notice!.width, height: notice!.height }, '通知の画素数は、実際の画像の大きさ').toEqual(size);
    expect(notice!.scale).toBe(expectedScale(10).toFixed(2));
    expect(size.width * size.height, '面積の上限に収まる').toBeLessThanOrEqual(MAX_AREA);
    expect(size.width * size.height, '収まる最大に近い(上限の 99.5% 以上)').toBeGreaterThan(MAX_AREA * 0.995);
    const one = sizeAtOneX(10);
    expect(Math.abs(size.width - one.width * expectedScale(10)), '幅が、式の値と 2 px 以内で一致').toBeLessThan(2);
    expect(Math.abs(size.height - one.height * expectedScale(10)), '高さが、式の値と 2 px 以内で一致').toBeLessThan(2);
  });

  test('縮小した画像でも、各ページが描かれ(色と位置が期待どおり)、上限ぎりぎりの大きさの PNG を生成できる', async ({ page, keepPng }) => {
    await page.goto('/');
    await openAndWait(page, 'many-pages-150.pdf');
    const size = await canvasSize(page);
    const grid = gridOf(Array.from({ length: PAGES }, () => A4), 10, size.width / sizeAtOneX(10).width);
    const indexes = [0, 9, 10, 149];
    const colors = await canvasPixels(page, indexes.map((i) => pointIn(grid.page(i), 0.8, 0.2)));
    indexes.forEach((index, i) => expectColor(colors[i]!, pageColor(index), 3, `${index + 1} ページ目`));
    const { fileName, data } = await downloadPng(page);
    expect(readPngSize(data), 'PNG の大きさは、縮小後の画像の大きさ').toEqual(size);
    expect(fileName).toBe('many-pages-150-10cols.png');
    await keepPng('縮小した画像', data);
  });

  test('縦一列(列数 1)では、辺の上限(65,535 px)で縮小する。通知も画像の大きさに一致する', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'many-pages-150.pdf');
    await commitColumns(page, '1');
    await expect(ui(page).download).toBeDisabled();
    await expectRendered(page);
    const size = await canvasSize(page);
    expect(size.height, '辺の上限以下で、上限に近い').toBeLessThanOrEqual(MAX_SIDE);
    expect(size.height).toBeGreaterThan(MAX_SIDE - 5);
    const notice = await shrinkNotice(page);
    expect(notice).toEqual({ scale: expectedScale(1).toFixed(2), ...size });
    expect(readPngSize((await downloadPng(page)).data)).toEqual(size);
  });

  test('列数を変えるたびに、縮小の通知(倍率と画素数)は、新しい画像に合わせて更新される', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'many-pages-150.pdf');
    const before = await shrinkNotice(page);
    await commitColumns(page, '150');
    await expect(ui(page).download).toBeDisabled();
    await expectRendered(page);
    const after = await shrinkNotice(page);
    expect(after!.scale, '横一列(列数 150): 辺の上限で縮小').toBe(expectedScale(150).toFixed(2));
    expect(after!.scale).not.toBe(before!.scale);
    expect({ width: after!.width, height: after!.height }).toEqual(await canvasSize(page));
  });

  test('縮小が要らない画像(12 ページ)では、通知は出ない', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    expect(await shrinkNotice(page)).toBeNull();
  });
});

test.describe('描画中の応答性(メインスレッドを長く止めない)', () => {
  test('150 ページの描画中に、メインスレッドが 1 秒以上止まることはない', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const w = window as unknown as { __maxGap: number };
      w.__maxGap = 0;
      let last = performance.now();
      setInterval(() => {
        const now = performance.now();
        w.__maxGap = Math.max(w.__maxGap, now - last);
        last = now;
      }, 10);
    });
    await chooseFile(page, 'many-pages-150.pdf');
    await expectRendered(page);
    const gap = await page.evaluate(() => (window as unknown as { __maxGap: number }).__maxGap);
    expect(gap, `タイマーの最大の遅れ(ms)`).toBeLessThan(1000);
  });

  test('元PDFプレビューをスクロールしながら描画しても、メインスレッドが1秒以上止まることはない(F7: 元PDFプレビュー優先)', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const w = window as unknown as { __maxGap: number };
      w.__maxGap = 0;
      let last = performance.now();
      setInterval(() => {
        const now = performance.now();
        w.__maxGap = Math.max(w.__maxGap, now - last);
        last = now;
      }, 10);
    });
    await chooseFile(page, 'many-pages-150.pdf');
    await ui(page).thumbnails.waitFor({ state: 'visible' });
    for (let step = 1; step <= 6; step += 1) {
      await page.waitForTimeout(300);
      await ui(page).thumbnails.evaluate((el, top) => void (el.scrollTop = top), step * 400);
    }
    await expectRendered(page);
    const gap = await page.evaluate(() => (window as unknown as { __maxGap: number }).__maxGap);
    expect(gap, `タイマーの最大の遅れ(ms)`).toBeLessThan(1000);
  });

  test('描画中でも、ズームの操作は(数秒以内に)反映される', async ({ page }) => {
    await page.goto('/');
    await throttleCpu(page, 4);
    await chooseFile(page, 'many-pages-150.pdf');
    await waitForProgress(page, 20);
    const before = await metrics(page);
    await ui(page).zoomIn.click();
    // 表示の文字は、小さな倍率では 1.25 倍しても同じ整数(3%)になるので、実際の表示の大きさで確かめる
    await expect.poll(async () => (await metrics(page)).zoom / before.zoom, { timeout: 5000 }).toBeCloseTo(1.25, 3);
    expect(await currentProgress(page), '操作が反映された後も、まだ描画中(描画中の操作だった)').toBeGreaterThanOrEqual(0);
    await throttleCpu(page, 1);
  });
});
