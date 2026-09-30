import { expect, type Page } from '@playwright/test';
import { expectRendered, ui } from './app.ts';
import { a4Grid, expectImage, expectSegmentPages, type SavedFile } from './split.ts';

/** ブラウザの中で、File.prototype.arrayBuffer の failAt 回目(1 始まり)の呼び出しだけ失敗させる(PDF を切り出すために、ファイルを読み直す処理を失敗させるため)。 */
function installReadFailure(failAt: number): void {
  const original = File.prototype.arrayBuffer;
  let calls = 0;
  /** failAt 回目の呼び出しだけ、読み込みに失敗する(拒否される)。 */
  File.prototype.arrayBuffer = function () {
    calls += 1;
    return calls === failAt ? Promise.reject(new Error('読み込めない')) : original.call(this);
  };
}

/** PDF を開いたあとの、ファイルの読み直しの failAt 回目(1 始まり)を失敗させる。PDF を開く処理は、呼び出しの数に含めない(この関数は、開いた後に呼ぶ)。 */
export async function failFileReadAt(page: Page, failAt: number): Promise<void> {
  await page.evaluate(installReadFailure, failAt);
}

/**
 * 保存された PDF を、別のタブでこのアプリに読み込んで、各ページが、元の PDF の first ページ目(0 始まり)から
 * count ページ分であることを確かめる(保存された PDF が、PDF として読めて、ページ数・並び・見た目が元のページと同じことの確認)。
 * 列数は columns(区切りなしで読み込んだときの既定: ページ数と 10 の小さい方)。
 */
export async function expectSavedPages(page: Page, saved: SavedFile, first: number, count: number): Promise<void> {
  const viewer = await page.context().newPage();
  await viewer.goto('/');
  await viewer.setInputFiles('#file-input', { name: saved.fileName, mimeType: 'application/pdf', buffer: saved.data });
  await expectRendered(viewer);
  const grid = a4Grid(count, Math.min(10, count));
  await expectImage(viewer, grid);
  await expectSegmentPages(viewer, grid, first, count);
  await expect(ui(viewer).status, 'ページが壊れていない').toHaveText('');
  await viewer.close();
}
