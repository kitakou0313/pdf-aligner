import { cpus, platform } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { SCREENSHOT_ROOT } from '../global-setup.ts';

// 計測結果の保存先(e2e-artifacts/performance/<実行日時>/<名前>.json)。git の追跡対象外
const PERFORMANCE_ROOT = SCREENSHOT_ROOT.replace('screenshots', 'performance');

/** ブラウザの中で、ファイル選択(change)から、ダウンロードが有効になる(描画の完了)までの時間を測る準備をする。 */
function installRenderTimer(): void {
  const w = window as unknown as { __render: { start: number; end: number } };
  w.__render = { start: 0, end: 0 };
  document.addEventListener('change', () => (w.__render = { start: performance.now(), end: 0 }), true);
  const button = document.querySelector<HTMLButtonElement>('#download')!;
  const observer = new MutationObserver(() => {
    if (!button.disabled && w.__render.start > 0 && w.__render.end === 0) w.__render.end = performance.now();
  });
  observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
}

/** 描画の所要時間(ms)を測る準備をする(ファイル選択の直前に呼ぶ)。 */
export async function startRenderTimer(page: Page): Promise<void> {
  await page.evaluate(installRenderTimer);
}

/** 直近の、ファイル選択から描画の完了までの時間(ms)。まだ完了していなければ 0。 */
export async function renderMilliseconds(page: Page): Promise<number> {
  const { start, end } = await page.evaluate(() => (window as unknown as { __render: { start: number; end: number } }).__render);
  return end > 0 ? end - start : 0;
}

/** 計測の環境(ブラウザ、OS、CPU、画面の密度)。結果の数値を、あとで比べるときの手がかり。 */
export async function environmentOf(page: Page): Promise<Record<string, unknown>> {
  return {
    browser: page.context().browser()?.version(),
    platform: platform(),
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    devicePixelRatio: await page.evaluate(() => window.devicePixelRatio),
  };
}

/** 計測の結果を、実行ごとのディレクトリに JSON で保存する(閾値でテストを失敗させず、実測値を記録するだけ)。 */
export async function recordMeasurement(name: string, data: Record<string, unknown>): Promise<void> {
  const dir = `${PERFORMANCE_ROOT}/${process.env.E2E_RUN_ID ?? 'adhoc'}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/${name}.json`, JSON.stringify({ measuredAt: new Date().toISOString(), ...data }, null, 2));
}
