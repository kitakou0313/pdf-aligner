import { expect, test } from './helpers/fixtures.ts';

test('ページが開き、見出しが表示される', async ({ page, shot }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('pdf-aligner');
  await expect(page.getByRole('heading', { name: 'pdf-aligner' })).toBeVisible();
  await shot('初期表示');
});

test('ビルド成果物に、通信を同一オリジンだけに絞る CSP が入っている', async ({ page }) => {
  await page.goto('/');
  const meta = page.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(meta).toHaveAttribute('content', /connect-src 'self'/);
});

test('起動しただけでは、コンソールのエラーも外部への通信も起きない', async ({ page, net }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
  expect(net.urls().length, '通信の記録が空(検査が空振りしている)').toBeGreaterThan(0);
});
