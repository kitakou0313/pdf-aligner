import type { Page } from '@playwright/test';
import { A4 } from '../tests/fixtures/spec.ts';
import { openAndWait, ui } from './helpers/app.ts';
import { commitColumns } from './helpers/render-watch.ts';
import { test, expect } from './helpers/fixtures.ts';
import { gridOf } from './helpers/geometry.ts';
import { imagePointAt, labelPercent, metrics, previewBox, scrollOf, scrollTo } from './helpers/zoom.ts';

const TWELVE_A4 = Array.from({ length: 12 }, () => A4);

/** ブラウザの中で、Ctrl あり・なしの wheel イベントを発生させ、既定の動作が止められたか(defaultPrevented)をそれぞれ返す。 */
function dispatchWheels(el: HTMLElement): { withCtrl: boolean; withoutCtrl: boolean } {
  /** Ctrl の有無を指定して wheel イベントを発生させ、既定の動作が止められたかを返す。 */
  const fire = (ctrlKey: boolean): boolean => {
    const event = new WheelEvent('wheel', { ctrlKey, deltaY: -10, cancelable: true, bubbles: true });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { withCtrl: fire(true), withoutCtrl: fire(false) };
}

/** 12 ページ(12252 × 3464 px。プレビュー領域より大きい)を開いて、100% にした状態にする。 */
async function openAtActualSize(page: Page): Promise<void> {
  await page.goto('/');
  await openAndWait(page, 'colored-12.pdf');
  await ui(page).zoomLevel.click();
}

test.describe('ボタンでの拡縮(密度 1)', () => {
  test('＋ / − は、1 回で 1.25 倍 / 1/1.25 倍。倍率の表示と、実際の大きさが一致する', async ({ page, shot }) => {
    await page.goto('/');
    await openAndWait(page, 'single-page.pdf');
    const fit = await metrics(page);
    await ui(page).zoomIn.click();
    const bigger = await metrics(page);
    expect(bigger.zoom / fit.zoom).toBeCloseTo(1.25, 3);
    expect(await labelPercent(page)).toBe(Math.round(bigger.zoom * 100));
    await shot('1 段階拡大');
    await ui(page).zoomOut.click();
    await ui(page).zoomOut.click();
    expect((await metrics(page)).zoom / fit.zoom).toBeCloseTo(0.8, 3);
  });

  test('倍率は、上限 800% と、下限(10% と全体が収まる倍率の小さい方)で止まる', async ({ page, shot }) => {
    await page.goto('/');
    await openAndWait(page, 'single-page.pdf');
    for (let i = 0; i < 20; i += 1) await ui(page).zoomIn.click();
    await expect(ui(page).zoomLevel).toHaveText('800%');
    await shot('上限 800%');
    for (let i = 0; i < 30; i += 1) await ui(page).zoomOut.click();
    await expect(ui(page).zoomLevel).toHaveText('10%');
  });

  test('巨大な画像では、全体が収まる倍率が 10% を下回っても、そこまで下げられる(fit の倍率が下限)', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'many-pages-150.pdf');
    const fit = await metrics(page);
    expect(fit.zoom, '150 ページの全体が収まる倍率は 10% を下回る').toBeLessThan(0.1);
    await ui(page).zoomOut.click();
    expect((await metrics(page)).zoom).toBeCloseTo(fit.zoom, 4);
    await ui(page).zoomIn.click();
    expect((await metrics(page)).zoom / fit.zoom).toBeCloseTo(1.25, 3);
  });

  test('「100%」を押すと、画像の 1 px が画面の 1 px になる(表示の大きさ = 画像の大きさ)', async ({ page, shot }) => {
    await openAtActualSize(page);
    const m = await metrics(page);
    expect(m.stage.width).toBeCloseTo(m.image.width, 3);
    expect(m.stage.height).toBeCloseTo(m.image.height, 3);
    await expect(ui(page).zoomLevel).toHaveText('100%');
    await shot('100%');
  });

  test('「画面に合わせる」で、全体が領域に収まる倍率(fit)に戻る', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    const fit = await metrics(page);
    await ui(page).zoomLevel.click();
    await ui(page).zoomFit.click();
    const back = await metrics(page);
    expect(back.zoom).toBeCloseTo(fit.zoom, 6);
    const box = await previewBox(page);
    expect(back.stage.width).toBeLessThanOrEqual(box.width + 0.5);
    expect(back.stage.height).toBeLessThanOrEqual(box.height + 0.5);
  });
});

test.describe('fit と固定(ウィンドウの大きさの変化)', () => {
  test('fit のときは、ウィンドウの大きさに合わせて、倍率を合わせ直す', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    const before = await metrics(page);
    await page.setViewportSize({ width: 640, height: 720 });
    await expect.poll(async () => (await metrics(page)).zoom).toBeLessThan(before.zoom * 0.6);
    const after = await metrics(page);
    const box = await previewBox(page);
    expect(after.stage.width).toBeLessThanOrEqual(box.width + 0.5);
  });

  test('固定のときは、ウィンドウの大きさが変わっても、倍率を保つ', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    await ui(page).zoomIn.click();
    const before = await metrics(page);
    await page.setViewportSize({ width: 640, height: 500 });
    await page.waitForTimeout(200);
    expect((await metrics(page)).zoom).toBeCloseTo(before.zoom, 6);
  });
});

test.describe('Ctrl+ホイール・ピンチ、ホイール、ドラッグ', () => {
  test('Ctrl+ホイールで、カーソルの下の画像上の点を動かさずに拡大する', async ({ page, shot }) => {
    await openAtActualSize(page);
    await scrollTo(page, 3000, 0);
    const box = await previewBox(page);
    const pointer = { x: box.x + 500, y: box.y + 200 };
    const before = await metrics(page);
    const anchor = imagePointAt(before, pointer);
    await page.mouse.move(pointer.x, pointer.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    const after = await metrics(page);
    expect(after.zoom / before.zoom, 'deltaY -100 で exp(0.2) 倍').toBeCloseTo(Math.exp(0.2), 2);
    const now = imagePointAt(after, pointer);
    expect(Math.abs(now.x - anchor.x), 'カーソルの下の点(横)').toBeLessThan(2);
    expect(Math.abs(now.y - anchor.y), 'カーソルの下の点(縦)').toBeLessThan(2);
    await shot('Ctrl+ホイールで拡大');
  });

  test('Ctrl+ホイールで縮小もできる。ブラウザ自体のズーム(ページ全体の拡縮)は起きない', async ({ page }) => {
    await openAtActualSize(page);
    const box = await previewBox(page);
    await page.mouse.move(box.x + 400, box.y + 200);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 100);
    await page.keyboard.up('Control');
    expect((await metrics(page)).zoom).toBeCloseTo(Math.exp(-0.2), 2);
    expect(await page.evaluate(() => window.devicePixelRatio), 'ページ全体の拡縮は起きていない').toBe(1);
  });

  test('Ctrl+ホイール(ピンチを含む)は、ブラウザの既定の動作(ページ全体の拡縮)を止める。Ctrl なしのホイールは止めない(スクロールのため)', async ({ page }) => {
    await openAtActualSize(page);
    // ヘッドレスのブラウザは、Ctrl+ホイールでページ全体を拡縮しないので、既定の動作が止められたか(defaultPrevented)を直接見る
    const prevented = await ui(page).preview.evaluate(dispatchWheels);
    expect(prevented).toEqual({ withCtrl: true, withoutCtrl: false });
  });

  test('Ctrl なしのホイールは、拡縮せずに、スクロールする', async ({ page }) => {
    await openAtActualSize(page);
    const box = await previewBox(page);
    await page.mouse.move(box.x + 400, box.y + 200);
    await page.mouse.wheel(0, 200);
    await expect.poll(async () => (await scrollOf(page)).y).toBeGreaterThan(0);
    await expect(ui(page).zoomLevel).toHaveText('100%');
  });

  test('ドラッグで、動かした分だけ、逆向きにスクロールする(つかんで動かす)', async ({ page, shot }) => {
    await openAtActualSize(page);
    await scrollTo(page, 1000, 500);
    const start = await scrollOf(page);
    const box = await previewBox(page);
    await page.mouse.move(box.x + 600, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 500, box.y + 250, { steps: 5 });
    await shot('ドラッグ中');
    await page.mouse.up();
    const end = await scrollOf(page);
    expect(end.x - start.x).toBeCloseTo(100, 0);
    expect(end.y - start.y).toBeCloseTo(50, 0);
  });

  test('ボタンを離したあとは、マウスを動かしてもスクロールしない', async ({ page }) => {
    await openAtActualSize(page);
    await scrollTo(page, 1000, 0);
    const box = await previewBox(page);
    await page.mouse.move(box.x + 600, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 550, box.y + 300);
    await page.mouse.up();
    const after = await scrollOf(page);
    await page.mouse.move(box.x + 300, box.y + 300, { steps: 3 });
    expect(await scrollOf(page)).toEqual(after);
  });
});

test.describe('列数の変更・新しい PDF と、倍率・スクロール位置', () => {
  test('固定のときに列数を変えると、倍率は維持し、スクロール位置は左上に戻る', async ({ page }) => {
    await openAtActualSize(page);
    await scrollTo(page, 2000, 300);
    expect((await scrollOf(page)).x).toBeGreaterThan(1000);
    await commitColumns(page, '4');
    const grid = gridOf(TWELVE_A4, 4, 2);
    await expect(ui(page).canvas).toHaveJSProperty('width', grid.width);
    await expect(ui(page).download).toBeEnabled();
    expect(await scrollOf(page)).toEqual({ x: 0, y: 0 });
    await expect(ui(page).zoomLevel).toHaveText('100%');
  });

  test('fit のときに列数を変えると、新しい画像の全体が収まる倍率に合わせ直す', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    await commitColumns(page, '2');
    await expect(ui(page).download).toBeEnabled();
    const m = await metrics(page);
    const box = await previewBox(page);
    expect(m.stage.height).toBeLessThanOrEqual(box.height + 0.5);
    expect(m.stage.width).toBeLessThanOrEqual(box.width + 0.5);
    expect(Math.max(m.stage.width / box.width, m.stage.height / box.height)).toBeGreaterThan(0.99);
  });

  test('新しい PDF を選ぶと、固定だった倍率も、fit(画面に合わせる)に戻る', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    await ui(page).zoomLevel.click();
    await openAndWait(page, 'single-page.pdf');
    const m = await metrics(page);
    const box = await previewBox(page);
    expect(m.zoom, '1 ページの画像は、領域に収まる倍率(100% 以下)').toBeLessThan(1);
    expect(Math.max(m.stage.width / box.width, m.stage.height / box.height)).toBeCloseTo(1, 1);
  });
});

/**
 * 画面の密度を、実行中に変える(CDP のエミュレーション)。エミュレーションでは、密度だけの変化に対する
 * matchMedia の通知が、描画のフレームが進むまで届かない(実機の画面の移動とは違う)ので、
 * ステータス行の高さを変えて、プレビュー領域の大きさの変化(ブラウザのズームで起きる変化)も起こす。
 * ここで確かめるのは「倍率の再計算が、覚えていた密度ではなく、現在の密度を読む」こと。
 * matchMedia による検知そのものは、tests/unit/view/viewport.test.ts が確かめる。
 */
async function changeDeviceScaleFactor(page: Page, deviceScaleFactor: number): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor, mobile: false });
  await ui(page).status.evaluate((el) => void (el.style.minHeight = '40px'));
}

test.describe('画面の密度が、実行中に変わる', () => {
  test('固定のときは、倍率(画像ピクセル基準)を保ち、CSS の拡大率だけを変える', async ({ page }) => {
    await openAtActualSize(page);
    expect((await metrics(page)).cssScale).toBeCloseTo(1, 6);
    await changeDeviceScaleFactor(page, 2);
    await expect.poll(async () => (await metrics(page)).cssScale).toBeCloseTo(0.5, 6);
    expect((await metrics(page)).zoom).toBeCloseTo(1, 6);
    await expect(ui(page).zoomLevel).toHaveText('100%');
  });

  test('fit のときは、新しい密度で、全体が収まる倍率(画像ピクセル基準。上限 100%)を求め直す', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    const before = await metrics(page);
    await changeDeviceScaleFactor(page, 2);
    await expect(ui(page).zoomLevel).toHaveText(`${Math.round(Math.min(before.zoom * 2, 1) * 100)}%`);
    const after = await metrics(page);
    expect(after.stage.width, 'CSS px での見た目の大きさ(領域に収まる)は変わらない').toBeCloseTo(before.stage.width, 0);
  });
});

test.describe('画面の密度(devicePixelRatio)が 2', () => {
  test.use({ deviceScaleFactor: 2 });

  test('「100%」は、画像の 1 px が物理 1 px(CSS の拡大率 0.5)。画像のピクセルがそのまま見える', async ({ page, shot }) => {
    await openAtActualSize(page);
    const m = await metrics(page);
    expect(m.dpr).toBe(2);
    expect(m.cssScale).toBeCloseTo(0.5, 6);
    expect(m.stage.width).toBeCloseTo(m.image.width / 2, 3);
    await shot('密度 2 で 100%');
  });

  test('fit の倍率は、画像ピクセル基準(密度 2 では、CSS px 基準の 2 倍)。上限は 100%', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    const m = await metrics(page);
    const box = await previewBox(page);
    const expected = Math.min((box.width / m.image.width) * 2, (box.height / m.image.height) * 2, 1);
    expect(m.zoom).toBeCloseTo(expected, 4);
  });

  test('小さい画像は、fit でも 100% を超えない(拡大しない)', async ({ page }) => {
    await page.goto('/');
    await page.setViewportSize({ width: 2400, height: 2400 });
    await openAndWait(page, 'single-page.pdf');
    await expect(ui(page).zoomLevel).toHaveText('100%');
  });
});
