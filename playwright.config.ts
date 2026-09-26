import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const ORIGIN = `http://localhost:${PORT}`;

// 既定は Playwright 同梱の Chromium。E2E_BROWSER=chrome のときは、インストール済みの Google Chrome で実行する(npm run e2e:chrome)
const USE_INSTALLED_CHROME = process.env.E2E_BROWSER === 'chrome';
const BROWSER = USE_INSTALLED_CHROME
  ? { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }
  : { name: 'chromium', use: { ...devices['Desktop Chrome'] } };

// E2E は、ビルド成果物を vite preview で配信して実行する(Worker やアセットのパスが本番と同じになる)。
// 既存のサーバーは再利用せず、毎回ビルドし直す。
// 150 ページの描画は、約 1 GB の canvas を確保して数秒〜十数秒かかるので、同時に走らせる数を 2 に抑え、テストの時間の上限を長めにする
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  globalSetup: './e2e/global-setup.ts',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  timeout: 300_000,
  workers: 2,
  use: { baseURL: ORIGIN },
  projects: [BROWSER],
  webServer: {
    command: `npm run build && npm run preview -- --host localhost --port ${PORT} --strictPort`,
    url: ORIGIN,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
