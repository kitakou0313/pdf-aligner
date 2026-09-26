import { CJK_TEXT } from '../tests/fixtures/spec.ts';
import { openAndWait, ui } from './helpers/app.ts';
import { test, expect } from './helpers/fixtures.ts';
import { gridOf } from './helpers/geometry.ts';
import { countBlackPixels } from './helpers/pixels.ts';

// フィクスチャ(cjk-non-embedded.pdf)は、A4 の 1 ページ。48 pt の黒い文字を、左下から (40, 400) に書いてある
const A4 = { width: 595, height: 842 };
const TEXT_TOP_PT = 842 - 400 - 48;

test('フォントを埋め込んでいない日本語 PDF は、CMap を同一オリジンから読み、警告なしで文字を描く', async ({ page, shot }) => {
  const responses: { url: string; status: number }[] = [];
  const problems: string[] = [];
  page.on('response', (response) => responses.push({ url: response.url(), status: response.status() }));
  page.on('console', (message) => ['error', 'warning'].includes(message.type()) && problems.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  await page.goto('/');
  await openAndWait(page, 'cjk-non-embedded.pdf');
  await shot(`描画結果 ${CJK_TEXT}`);
  const cmaps = responses.filter((r) => r.url.includes('/pdfjs/cmaps/'));
  expect(cmaps.map((r) => r.status), 'CMap を同一オリジンから読んだ').toEqual([200, 200]);
  expect(cmaps.map((r) => new URL(r.url).pathname)).toContain('/pdfjs/cmaps/90ms-RKSJ-H.bcmap');
  expect(problems, 'コンソールの警告・エラー').toEqual([]);
  await expect(ui(page).status).toHaveText('');
});

test('フォントを埋め込んでいない日本語 PDF で、文字の位置に、文字(黒い画素)が描かれている', async ({ page }) => {
  await page.goto('/');
  await openAndWait(page, 'cjk-non-embedded.pdf');
  const rect = gridOf([A4], 1, 2).page(0);
  // 7 文字 × 48 pt の範囲(倍率 2)。文字の形が正しいかは、スクリーンショットを人が見て判断する
  const text = { x: rect.x + 80, y: rect.y + TEXT_TOP_PT * 2, width: 336 * 2, height: 48 * 2 };
  const black = await countBlackPixels(page, text);
  expect(black, '文字の範囲にある黒い画素の数').toBeGreaterThan(2000);
  const blank = await countBlackPixels(page, { ...text, y: rect.y + 100 });
  expect(blank, '文字のない範囲には、黒い画素がない').toBe(0);
});
