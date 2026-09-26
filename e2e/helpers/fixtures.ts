import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { SCREENSHOT_ROOT } from '../global-setup.ts';
import { screenshotPath } from './artifacts.ts';
import { externalUrls } from './net-guard.ts';

type Shot = (step: string) => Promise<void>;
type KeepPng = (step: string, data: Buffer) => Promise<void>;

// テストごとの、成果物(スクリーンショット、ダウンロードした PNG)の連番
const stepCounts = new WeakMap<TestInfo, number>();

/** このテストの成果物の保存先(実行ディレクトリ/テスト名/連番-ステップ名.png)を返す。呼ぶたびに連番が進む。 */
function artifactPath(testInfo: TestInfo, step: string): string {
  const count = (stepCounts.get(testInfo) ?? 0) + 1;
  stepCounts.set(testInfo, count);
  const runId = process.env.E2E_RUN_ID ?? 'adhoc';
  return screenshotPath(SCREENSHOT_ROOT, runId, testInfo.titlePath.join(' '), count, step);
}

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
 * - keepPng: ダウンロードした PNG を、同じディレクトリへ保存する(連番はスクリーンショットと共通)
 */
export const test = base.extend<{ net: NetworkWatcher; shot: Shot; keepPng: KeepPng }>({
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
    await use(async (step) => {
      await page.screenshot({ path: artifactPath(testInfo, step) });
    });
  },
  /** ダウンロードした PNG を、スクリーンショットと同じ場所(連番も共通)に保存する関数を渡す。 */
  // eslint-disable-next-line no-empty-pattern -- Playwright は第 1 引数を分割代入で受け取る。依存する fixture がないので空にする
  keepPng: async ({}, use, testInfo) => {
    await use(async (step, data) => {
      const path = artifactPath(testInfo, step);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    });
  },
});

export { expect };
