import type { Page } from '@playwright/test';
import { chooseFile, dropFiles, expectRendered, openAndWait, throttleCpu, ui } from './helpers/app.ts';
import { test, expect } from './helpers/fixtures.ts';
import { watchStatus } from './helpers/render-watch.ts';
import { commitSeparators, holdToBlobAt, releaseToBlob, selectSegment } from './helpers/split.ts';

/** 今、生成済み(rendered)のサムネイルの数。 */
function renderedCount(page: Page): Promise<number> {
  return ui(page).thumbnails.locator('.thumb[data-status="rendered"]').count();
}

/** 元PDFプレビューのセル(.thumb)の Locator。 */
function thumbs(page: Page) {
  return ui(page).thumbnails.locator('.thumb');
}

/** i 番目(0 始まり)のセルの、今の状態(data-status)。 */
async function statusOf(page: Page, index: number): Promise<string | null> {
  return thumbs(page).nth(index).getAttribute('data-status');
}

test.describe('元PDFプレビュー(F11: 区切りページ判断の補助のためのサムネイル一覧)', () => {
  test('読み込むまでは非表示。読み込むと、全ページぶんのサムネイルを、ページ番号つきで表示する', async ({ page, shot }) => {
    await page.goto('/');
    await expect(ui(page).thumbnails).toBeHidden();
    await openAndWait(page, 'colored-12.pdf');
    await expect(ui(page).thumbnails).toBeVisible();
    await expect(thumbs(page)).toHaveCount(12);
    await shot('元PDFプレビューの表示');
    const numbers = await thumbs(page).locator('.thumb-number').allTextContents();
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 1)));
  });

  test('区切りを入力してセグメントを切り替えても、常に PDF 全体の全ページを表示する(Q6)', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    await commitSeparators(page, '5, 9');
    await expect(thumbs(page)).toHaveCount(12);
    await selectSegment(page, 5);
    await expect(thumbs(page)).toHaveCount(12);
  });

  test('サムネイルをクリックしても、区切りやセグメントの選択は変わらない(Q2: 参照専用)', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    await commitSeparators(page, '5, 9');
    await thumbs(page).nth(6).click();
    await expect(ui(page).separators).toHaveValue('5, 9');
    await expect(ui(page).segment).toHaveValue('1');
  });

  test('ページの縦横比に合わせて、サムネイルの高さが決まる(mixed-sizes.pdf: A4縦・A4横・A3)', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'mixed-sizes.pdf');
    await expect(thumbs(page)).toHaveCount(3);
    const [portrait, landscape, a3] = await thumbs(page).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    // A4縦と A3 は、ISO 216 で縦横比が同じ(√2 : 1)なので高さもほぼ同じ。A4横だけが低い
    expect(landscape).toBeLessThan(portrait! * 0.8);
    expect(Math.abs(a3! - portrait!)).toBeLessThan(2);
  });

  test('1 ページの PDF は、サムネイル 1 件だけ', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'single-page.pdf');
    await expect(thumbs(page)).toHaveCount(1);
  });

  test('0 ページの PDF は、エラーだけを表示し、元PDFプレビューは表示しない', async ({ page }) => {
    await page.goto('/');
    await chooseFile(page, 'zero-pages.pdf');
    await expect(ui(page).status).toHaveText('ページがありません。');
    await expect(ui(page).thumbnails).toBeHidden();
  });

  test('読み込みに失敗したときは、元PDFプレビューを表示しない', async ({ page }) => {
    await page.goto('/');
    await chooseFile(page, 'encrypted.pdf');
    await expect(ui(page).status).toHaveText('パスワードで保護された PDF には対応していません。');
    await expect(ui(page).thumbnails).toBeHidden();
  });

  test.describe('一部のページの生成に失敗したとき(broken-page.pdf: 3 ページのうち 2 ページ目)', () => {
    test('失敗したページには失敗のマークを出し、他のページと区別できる(Q11)', async ({ page, shot }) => {
      await page.goto('/');
      await openAndWait(page, 'broken-page.pdf');
      await expect(thumbs(page)).toHaveCount(3);
      await expect.poll(() => statusOf(page, 1)).toBe('failed');
      await expect.poll(() => statusOf(page, 0)).toBe('rendered');
      await expect.poll(() => statusOf(page, 2)).toBe('rendered');
      await shot('2 ページ目のサムネイルが失敗');
      await expect(thumbs(page).nth(1)).toHaveClass(/thumb--failed/);
    });
  });

  test('元PDFプレビューが未確定の間は、出力の描画より優先し、専用の文言を出す。落ち着くと出力を描き始める(F7: 元PDFプレビュー優先)', async ({ page }) => {
    await page.goto('/');
    await throttleCpu(page, 4);
    await chooseFile(page, 'many-pages-150.pdf');
    await expect(thumbs(page)).toHaveCount(150);
    await expect(ui(page).status, '出力の描画より、元PDFプレビューを優先している').toHaveText('元PDFプレビューの表示を優先しています');
    await throttleCpu(page, 1);
    await expectRendered(page);
    await expect.poll(() => renderedCount(page), '落ち着いた後は、サムネイルも生成されている').toBeGreaterThan(0);
  });

  test('大きい PDF では、見えている範囲付近のページだけを生成し、スクロールすると増える(Q7: 遅延読み込み・仮想化)', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'many-pages-150.pdf');
    await expect(thumbs(page)).toHaveCount(150);
    await expect.poll(() => renderedCount(page)).toBeGreaterThan(0);
    const initial = await renderedCount(page);
    expect(initial, '150 ページ全部は、最初から生成しない').toBeLessThan(150);
    await ui(page).thumbnails.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect.poll(() => statusOf(page, 149), { timeout: 15_000 }).toBe('rendered');
  });

  test('一括保存中も、元PDFプレビューは表示・スクロールしたままにする(Q9: 参照専用のため無効化しない)', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    await commitSeparators(page, '4, 9');
    await holdToBlobAt(page, 1);
    await ui(page).downloadAll.click();
    await expect(ui(page).downloadAll).toHaveText('キャンセル');
    await expect(ui(page).thumbnails).toBeVisible();
    await expect(thumbs(page)).toHaveCount(12);
    await releaseToBlob(page);
    await expect(ui(page).downloadAll).toHaveText('すべてPNGをダウンロード');
  });

  test('一括保存中は、元PDFプレビューをスクロールしても、出力の描画は中断されない(F7: 一括保存中を除く)', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'many-pages-150.pdf');
    await commitSeparators(page, '40, 90');
    await throttleCpu(page, 4);
    const statusLog = await watchStatus(page);
    await ui(page).downloadAll.click();
    await expect(ui(page).downloadAll).toHaveText('キャンセル');
    await ui(page).thumbnails.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(ui(page).downloadAll).toHaveText('すべてPNGをダウンロード', { timeout: 240_000 });
    await throttleCpu(page, 1);
    const log = (await statusLog.jsonValue()) as string[];
    expect(log, '一括保存中は、元PDFプレビュー優先の文言を一度も出さない').not.toContain('元PDFプレビューの表示を優先しています');
  });

  test('別の PDF に差し替えると、元PDFプレビューも新しい内容に置き換わる', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    await expect(thumbs(page)).toHaveCount(12);
    await openAndWait(page, 'single-page.pdf');
    await expect(thumbs(page)).toHaveCount(1);
  });

  test('複数ファイルをドロップして拒否されたときは、表示中の元PDFプレビューをそのまま残す', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    await dropFiles(page, ['single-page.pdf', 'colored-12.pdf']);
    await expect(ui(page).status).toHaveText('PDF は 1 ファイルだけ指定してください。');
    await expect(thumbs(page)).toHaveCount(12);
  });
});
