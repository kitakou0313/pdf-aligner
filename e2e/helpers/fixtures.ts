import { test as base, expect, type Page } from '@playwright/test';
import { SCREENSHOT_ROOT } from '../global-setup.ts';
import { screenshotPath } from './artifacts.ts';
import { externalUrls } from './net-guard.ts';

type Shot = (step: string) => Promise<void>;

/** ブラウザが発行した全リクエストと WebSocket の URL を溜め、localhost 以外への通信を調べる記録係。 */
export class NetworkWatcher {
  private readonly seen: string[] = [];

  /** ページのコンテキスト(Worker を含む)のリクエストと WebSocket の記録を始める。 */
  constructor(page: Page) {
    page.context().on('request', (request) => this.seen.push(request.url()));
    page.on('websocket', (socket) => this.seen.push(socket.url()));
  }

  /** 記録した全ての URL。 */
  urls(): string[] {
    return [...this.seen];
  }

  /** 記録した URL のうち、localhost 以外を指すもの。 */
  external(): string[] {
    return externalUrls(this.seen);
  }

  /** 記録を消す。外部への通信を意図して起こしたテストが、後始末の検査で失敗しないように使う。 */
  reset(): void {
    this.seen.length = 0;
  }
}

/**
 * 全テスト共通の fixture。
 * - net: 自動で有効になり、テストの終了時に「外部への通信がゼロ」であることを検査する(Q2)
 * - shot: 各ステップの画面を、実行ごとのディレクトリへ保存する(Q16)
 */
export const test = base.extend<{ net: NetworkWatcher; shot: Shot }>({
  net: [
    async ({ page }, use) => {
      const watcher = new NetworkWatcher(page);
      await use(watcher);
      expect(watcher.external(), '外部への通信が発生した').toEqual([]);
    },
    { auto: true },
  ],
  /** 呼ぶたびに、現在の画面を「実行ディレクトリ/テスト名/連番-ステップ名.png」として保存する関数を渡す。 */
  shot: async ({ page }, use, testInfo) => {
    let count = 0;
    const runId = process.env.E2E_RUN_ID ?? 'adhoc';
    await use(async (step) => {
      count += 1;
      const title = testInfo.titlePath.join(' ');
      await page.screenshot({ path: screenshotPath(SCREENSHOT_ROOT, runId, title, count, step) });
    });
  },
});

export { expect };
