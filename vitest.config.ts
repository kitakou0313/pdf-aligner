import { defineConfig } from 'vitest/config';

// 単体テストの設定。E2E(e2e/)は Playwright が実行するので、ここでは対象外にする
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
