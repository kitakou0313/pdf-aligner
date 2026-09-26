import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const ORIGIN = `http://localhost:${PORT}`;

// E2E は、ビルド成果物を vite preview で配信して実行する(Worker やアセットのパスが本番と同じになる)。
// ブラウザは Playwright 同梱の Chromium(ヘッドレス)。既存のサーバーは再利用せず、毎回ビルドし直す。
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  globalSetup: './e2e/global-setup.ts',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: { baseURL: ORIGIN },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npm run preview -- --host localhost --port ${PORT} --strictPort`,
    url: ORIGIN,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
