import { readFile } from 'node:fs/promises';
import { expect, type Download, type Page } from '@playwright/test';
import { A4, pageColor } from '../../tests/fixtures/spec.ts';
import { expectRendered, ui } from './app.ts';
import { gridOf, pointIn, type Grid } from './geometry.ts';
import { BACKGROUND, canvasPixels, expectColor } from './pixels.ts';
import { pixelAt, type DecodedPng } from './png-decode.ts';

// pdf.js の色の丸めで ±1〜2 ずれうる
export const TOLERANCE = 3;

/** 区切りの欄に値を入れて、フォーカスを外して確定する(有効なページ番号だけに整えられて、書き戻される)。 */
export async function commitSeparators(page: Page, text: string): Promise<void> {
  await ui(page).separators.fill(text);
  await ui(page).separators.blur();
}

/** セグメントのセレクタの選択肢の文言を、上から順に取り出す。 */
export async function segmentLabels(page: Page): Promise<string[]> {
  return ui(page).segment.locator('option').allTextContents();
}

/** セグメントを、先頭ページ(選択肢の値)で選ぶ。 */
export async function selectSegment(page: Page, start: number): Promise<void> {
  await ui(page).segment.selectOption(String(start));
}

/** A4 縦を count 枚、列数 columns、倍率 2 で並べたときの、期待するレイアウト(blueprint の式)。 */
export function a4Grid(count: number, columns: number): Grid {
  return gridOf(Array.from({ length: count }, () => A4), columns, 2);
}

/** 画像の大きさが grid のとおりになり、描画が完了する(ダウンロードできる)まで待つ。 */
export async function expectImage(page: Page, grid: Grid): Promise<void> {
  await expect(ui(page).canvas).toHaveJSProperty('width', grid.width);
  await expect(ui(page).canvas).toHaveJSProperty('height', grid.height);
  await expectRendered(page);
}

/** 画面の canvas で、セグメントの i 番目のセルのページが、元の PDF の first + i ページ目(0 始まり)の色であることを確かめる。 */
export async function expectSegmentPages(page: Page, grid: Grid, first: number, count: number): Promise<void> {
  const points = Array.from({ length: count }, (_, i) => pointIn(grid.page(i), 0.8, 0.2));
  const colors = await canvasPixels(page, points);
  colors.forEach((color, i) => expectColor(color, pageColor(first + i), TOLERANCE, `元の ${first + i + 1} ページ目(セグメントの ${i + 1} 番目)`));
}

/** 画面の canvas で、指定したセル(0 始まりの番号)と外周の余白が、背景色のままであることを確かめる。 */
export async function expectBackground(page: Page, grid: Grid, cells: readonly number[]): Promise<void> {
  const points = [...cells.map((cell) => pointIn(grid.cell(cell), 0.5, 0.5)), { x: 3, y: 3 }, { x: grid.width - 4, y: grid.height - 4 }];
  for (const color of await canvasPixels(page, points)) expectColor(color, BACKGROUND, 0, '背景色のまま');
}

/** PNG の cell 番目のセルの色から、元のページ番号(0 始まり)を求める。pageCount 個のページの色のどれでもなければ null。 */
export function pageIndexAt(png: DecodedPng, grid: Grid, cell: number, pageCount: number): number | null {
  const { x, y } = pointIn(grid.page(cell), 0.8, 0.2);
  const pixel = pixelAt(png, x, y);
  /** index 番目のページの色と、画素の色が、許容差以内で一致するか。 */
  const matches = (index: number): boolean => pageColor(index).every((value, i) => Math.abs(value - (pixel[i] as number)) <= TOLERANCE);
  return Array.from({ length: pageCount }, (_, index) => index).find(matches) ?? null;
}

/** 保存されたファイル(名前と、中身)。 */
export interface SavedFile {
  readonly fileName: string;
  readonly data: Buffer;
}

/** ページで起きるダウンロードを、起きた順に集め続ける(返した配列は、ダウンロードが起きるたびに増える)。 */
export function collectDownloads(page: Page): Download[] {
  const downloads: Download[] = [];
  page.on('download', (download) => downloads.push(download));
  return downloads;
}

/** ダウンロードが終わるのを待って、保存されたファイルの名前と中身を読む。 */
export async function readSaved(download: Download): Promise<SavedFile> {
  return { fileName: download.suggestedFilename(), data: await readFile(await download.path()) };
}

/** ブラウザの中で、toBlob の holdAt 回目の呼び出しを、window.releaseToBlob が呼ばれるまで待たせる(その間、保存は始まらない)。 */
function installHold(holdAt: number): void {
  const original = HTMLCanvasElement.prototype.toBlob;
  let calls = 0;
  const gate = new Promise<void>((resolve) => Object.assign(window, { releaseToBlob: resolve }));
  /** holdAt 回目の呼び出しだけ、gate が開くまで待たせる。 */
  HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
    calls += 1;
    if (calls === holdAt) void gate.then(() => original.call(this, callback, type, quality));
    else original.call(this, callback, type, quality);
  };
}

/** ブラウザの中で、toBlob の failAt 回目の呼び出しだけ、PNG を生成できなかった(null)ことにする。 */
function installFail(failAt: number): void {
  const original = HTMLCanvasElement.prototype.toBlob;
  let calls = 0;
  /** failAt 回目の呼び出しだけ、null を返す(PNG を生成できなかった)。 */
  HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
    calls += 1;
    if (calls === failAt) callback(null);
    else original.call(this, callback, type, quality);
  };
}

/** toBlob の holdAt 回目(1 始まり)の呼び出しを、releaseToBlob を呼ぶまで待たせる(一括保存の途中の状態を、確実に捉えるため)。 */
export async function holdToBlobAt(page: Page, holdAt: number): Promise<void> {
  await page.evaluate(installHold, holdAt);
}

/** holdToBlobAt で待たせた保存を、再開させる。 */
export async function releaseToBlob(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { releaseToBlob: () => void }).releaseToBlob());
}

/** toBlob の failAt 回目(1 始まり)の呼び出しだけ、PNG を生成できなかったことにする。 */
export async function failToBlobAt(page: Page, failAt: number): Promise<void> {
  await page.evaluate(installFail, failAt);
}
