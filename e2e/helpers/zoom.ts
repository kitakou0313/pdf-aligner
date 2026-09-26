import type { Page } from '@playwright/test';
import { ui } from './app.ts';

/** 今の表示の、実測値。cssScale は画像 1 px あたりの CSS px、zoom は画像ピクセル基準の倍率(1 が 100%)。 */
export interface Metrics {
  readonly zoom: number;
  readonly cssScale: number;
  readonly dpr: number;
  readonly image: { width: number; height: number };
  readonly stage: { x: number; y: number; width: number; height: number };
}

/** 画像の大きさ(canvas の属性)、表示の大きさ(stage の実測)、画面の密度から、今の倍率を求める。 */
export async function metrics(page: Page): Promise<Metrics> {
  const image = await ui(page).canvas.evaluate((c: HTMLCanvasElement) => ({ width: c.width, height: c.height }));
  const stage = (await ui(page).stage.boundingBox())!;
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const cssScale = stage.width / image.width;
  return { zoom: cssScale * dpr, cssScale, dpr, image, stage };
}

/** プレビュー領域の、スクロール位置(CSS px)。 */
export async function scrollOf(page: Page): Promise<{ x: number; y: number }> {
  return ui(page).preview.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }));
}

/** プレビュー領域を、指定した位置までスクロールする。 */
export async function scrollTo(page: Page, x: number, y: number): Promise<void> {
  await ui(page).preview.evaluate((el, pos) => el.scrollTo(pos.x, pos.y), { x, y });
}

/** プレビュー領域の、見えている大きさ(スクロールバーを除く)と、画面上の位置(CSS px)。 */
export async function previewBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return ui(page).preview.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: el.clientWidth, height: el.clientHeight };
  });
}

/** 倍率の表示(例: 「125%」)の数値の部分。 */
export async function labelPercent(page: Page): Promise<number> {
  return Number.parseInt((await ui(page).zoomLevel.innerText()).replace('%', ''), 10);
}

/** 画面(クライアント座標)の点の下にある、画像上の点(画像の px)。 */
export function imagePointAt(m: Metrics, client: { x: number; y: number }): { x: number; y: number } {
  return { x: (client.x - m.stage.x) / m.cssScale, y: (client.y - m.stage.y) / m.cssScale };
}
