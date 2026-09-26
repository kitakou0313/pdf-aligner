import { expect, type JSHandle, type Page } from '@playwright/test';
import { RENDER_TIMEOUT_MS, ui } from './app.ts';

/** 列数の欄に値を入れて、フォーカスを外して確定する(範囲への丸めの規則が働く)。 */
export async function commitColumns(page: Page, text: string): Promise<void> {
  await ui(page).columns.fill(text);
  await ui(page).columns.blur();
}

/** ステータス行の文言の変化を、ページの中で記録し続ける(記録は、あとで jsonValue で取り出す)。 */
export async function watchStatus(page: Page): Promise<JSHandle<string[]>> {
  return page.evaluateHandle(() => {
    const status = document.querySelector('#status')!;
    const log: string[] = [];
    const options = { childList: true, subtree: true, characterData: true };
    new MutationObserver(() => log.push(status.textContent ?? '')).observe(status, options);
    return log;
  });
}

/** 出力画像の準備(canvas の width 属性の設定)のたびに、そのときの width を、ページの中で記録し続ける。 */
export async function watchCanvasWidth(page: Page): Promise<JSHandle<number[]>> {
  return page.evaluateHandle(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
    const widths: number[] = [];
    new MutationObserver(() => widths.push(canvas.width)).observe(canvas, { attributes: true, attributeFilter: ['width'] });
    return widths;
  });
}

/** ステータス行の、いまの「描画中 N/M ページ」の N(描画中でなければ -1)。 */
export async function currentProgress(page: Page): Promise<number> {
  const match = /描画中 (\d+)\/\d+ ページ/.exec(await ui(page).status.innerText());
  return match ? Number(match[1]) : -1;
}

/** 「描画中 N/M ページ」の N が、min 以上になるまで待って、そのときの N を返す(描画の途中を捉えるため)。 */
export async function waitForProgress(page: Page, min: number): Promise<number> {
  await expect.poll(() => currentProgress(page), { intervals: [10], timeout: RENDER_TIMEOUT_MS }).toBeGreaterThanOrEqual(min);
  return currentProgress(page);
}

/** 進捗の記録(ステータス行の文言の列)から、「描画中 N/M ページ」の N だけを取り出す。 */
export function progressOf(log: readonly string[]): number[] {
  return log.flatMap((text) => {
    const match = /描画中 (\d+)\/\d+ ページ/.exec(text);
    return match ? [Number(match[1])] : [];
  });
}
