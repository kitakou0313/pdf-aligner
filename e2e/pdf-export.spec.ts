import type { Page } from '@playwright/test';
import { RENDER_TIMEOUT_MS, chooseFile, openAndWait, ui } from './helpers/app.ts';
import { test, expect } from './helpers/fixtures.ts';
import { failFileReadAt, expectSavedPages } from './helpers/pdf-export.ts';
import { commitColumns } from './helpers/render-watch.ts';
import { a4Grid, collectDownloads, commitSeparators, expectImage, holdToBlobAt, readSaved, releaseToBlob, selectSegment } from './helpers/split.ts';

/** colored-12(A4 縦 12 ページ)を、区切り 4, 9 で分けたときの、各セグメントの期待値(blueprint の例 10)。 */
const SEGMENTS = [
  { label: 'p.1–3', first: 0, count: 3, fileName: 'colored-12-p01-03.pdf' },
  { label: 'p.4–8', first: 3, count: 5, fileName: 'colored-12-p04-08.pdf' },
  { label: 'p.9–12', first: 8, count: 4, fileName: 'colored-12-p09-12.pdf' },
] as const;

/** colored-12 を開いて、列数 4、区切り 4, 9 にして、先頭のセグメントの描画が終わるまで待つ。 */
async function openSplit(page: Page): Promise<void> {
  await page.goto('/');
  await openAndWait(page, 'colored-12.pdf');
  await commitColumns(page, '4');
  await commitSeparators(page, '4, 9');
  await expectImage(page, a4Grid(3, 3));
}

/** 「すべてPDFをダウンロード」を押して、n 個のファイルが保存されるまで待ち、保存された順に返す。 */
async function downloadAllPdfs(page: Page, count: number) {
  const downloads = collectDownloads(page);
  await ui(page).downloadAllPdf.click();
  await expect.poll(() => downloads.length).toBe(count);
  return Promise.all(downloads.map(readSaved));
}

test.describe('PDF のボタンの有効・無効(blueprint の F12、「画面の状態と操作の可否」)', () => {
  test('PDF を読み込むまでは、どちらも無効。読み込むと「PDFをダウンロード」が有効で、「すべて」は区切りがあるときだけ有効', async ({ page, shot }) => {
    await page.goto('/');
    await expect(ui(page).downloadPdf).toBeDisabled();
    await expect(ui(page).downloadAllPdf).toBeDisabled();
    await openAndWait(page, 'colored-12.pdf');
    await expect(ui(page).downloadPdf).toBeEnabled();
    await expect(ui(page).downloadAllPdf, '区切りなしでは無効').toBeDisabled();
    await commitSeparators(page, '4, 9');
    await expect(ui(page).downloadAllPdf).toBeEnabled();
    await shot('区切りありで PDF のボタンが有効');
  });

  test('ボタンの文言は、PNG と PDF で 4 つに分かれている', async ({ page }) => {
    await page.goto('/');
    await expect(ui(page).download).toHaveText('PNGをダウンロード');
    await expect(ui(page).downloadAll).toHaveText('すべてPNGをダウンロード');
    await expect(ui(page).downloadPdf).toHaveText('PDFをダウンロード');
    await expect(ui(page).downloadAllPdf).toHaveText('すべてPDFをダウンロード');
  });

  test('画像の描画が終わっていなくても(描画中でも)、PDF のボタンは有効。PNG のボタンは描画が終わるまで無効', async ({ page, shot }) => {
    await page.goto('/');
    await chooseFile(page, 'many-pages-150.pdf');
    await expect(ui(page).downloadPdf).toBeEnabled({ timeout: RENDER_TIMEOUT_MS });
    await expect(ui(page).download, '画像はまだ描画中').toBeDisabled();
    await shot('描画中に PDF のボタンが有効');
    const [download] = await Promise.all([page.waitForEvent('download'), ui(page).downloadPdf.click()]);
    expect(download.suggestedFilename()).toBe('many-pages-150-p001-150.pdf');
  });
});

test.describe('PDFをダウンロード(表示中のセグメントだけ。blueprint の F12、例 10。colored-12、区切り 4, 9)', () => {
  test('表示中のセグメントのページだけを、範囲つきの名前で保存する。保存した PDF は、元の該当ページと同じ見た目になる', async ({ page, shot }) => {
    await openSplit(page);
    await selectSegment(page, 4);
    await expectImage(page, a4Grid(5, 4));
    const [download] = await Promise.all([page.waitForEvent('download'), ui(page).downloadPdf.click()]);
    const saved = await readSaved(download);
    expect(saved.fileName).toBe('colored-12-p04-08.pdf');
    await expectSavedPages(page, saved, 3, 5);
    await shot('保存した後(表示中のセグメントはそのまま)');
    await expect(ui(page).segment).toHaveValue('4');
    await expect(ui(page).downloadPdf, '保存が終わると、ボタンが有効に戻る').toBeEnabled();
  });

  test('区切りなしのときは、全ページを 1 つの PDF として保存する(名前にページ範囲が入る)', async ({ page }) => {
    await page.goto('/');
    await openAndWait(page, 'colored-12.pdf');
    const [download] = await Promise.all([page.waitForEvent('download'), ui(page).downloadPdf.click()]);
    const saved = await readSaved(download);
    expect(saved.fileName).toBe('colored-12-p01-12.pdf');
    await expectSavedPages(page, saved, 0, 12);
  });

  test('PDF を保存しても、画像の描画と PNG の保存には影響しない(PNG は、そのまま保存できる)', async ({ page }) => {
    await openSplit(page);
    await Promise.all([page.waitForEvent('download'), ui(page).downloadPdf.click()]);
    const [png] = await Promise.all([page.waitForEvent('download'), ui(page).download.click()]);
    expect(png.suggestedFilename()).toBe('colored-12-p01-03-3cols.png');
  });
});

test.describe('すべてPDFをダウンロード(全セグメントを、1 ファイルずつ。blueprint の F12、例 10)', () => {
  test('全セグメントを、先頭から順に保存する。ページを合わせると、元の全ページがちょうど 1 度ずつ現れる', async ({ page, shot }) => {
    await openSplit(page);
    const saved = await downloadAllPdfs(page, 3);
    expect(saved.map((file) => file.fileName)).toEqual(SEGMENTS.map((segment) => segment.fileName));
    for (const [index, file] of saved.entries()) await expectSavedPages(page, file, SEGMENTS[index]!.first, SEGMENTS[index]!.count);
    expect(SEGMENTS.reduce((sum, segment) => sum + segment.count, 0), 'ページ数の合計は総ページ数').toBe(12);
    await shot('すべて保存した後');
    await expect(ui(page).downloadAllPdf).toBeEnabled();
    await expect(ui(page).status).toHaveText('');
  });

  test('PNG の一括保存中は、PDF のボタンが無効(終わると有効に戻る)', async ({ page, shot }) => {
    await openSplit(page);
    await holdToBlobAt(page, 1);
    await ui(page).downloadAll.click();
    await expect(ui(page).downloadAll).toHaveText('キャンセル');
    await expect(ui(page).downloadPdf).toBeDisabled();
    await expect(ui(page).downloadAllPdf).toBeDisabled();
    await shot('PNG の一括保存中');
    await releaseToBlob(page);
    await expect(ui(page).downloadAll).toHaveText('すべてPNGをダウンロード', { timeout: RENDER_TIMEOUT_MS });
    await expect(ui(page).downloadPdf).toBeEnabled();
    await expect(ui(page).downloadAllPdf).toBeEnabled();
  });
});

test.describe('PDF を書き出せなかったとき(blueprint の F12)', () => {
  test('途中の切り出しに失敗したら、そこで止まり、以降は保存しない。警告に、保存できた個数を出す。画像は影響を受けない', async ({ page, shot }) => {
    await openSplit(page);
    const downloads = collectDownloads(page);
    await failFileReadAt(page, 2);
    await ui(page).downloadAllPdf.click();
    await expect(ui(page).status).toHaveText('PDF を書き出せませんでした。3 個中 1 個を保存しました。');
    await shot('PDF を書き出せなかった');
    await page.waitForTimeout(700);
    expect((await Promise.all(downloads.map(readSaved))).map((file) => file.fileName)).toEqual([SEGMENTS[0].fileName]);
    await expect(ui(page).downloadAllPdf, '書き出しが終わったので、ボタンは有効に戻る').toBeEnabled();
    await expect(ui(page).download, '画像の PNG は、そのまま保存できる').toBeEnabled();
  });

  test('単体の書き出しに失敗したら、1 個中 0 個の警告。列数を変えると、警告は消える', async ({ page }) => {
    await openSplit(page);
    await failFileReadAt(page, 1);
    await ui(page).downloadPdf.click();
    await expect(ui(page).status).toHaveText('PDF を書き出せませんでした。1 個中 0 個を保存しました。');
    await commitColumns(page, '2');
    await expect(ui(page).status).not.toContainText('PDF を書き出せませんでした');
  });
});
