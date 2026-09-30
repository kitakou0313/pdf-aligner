import { readFile } from 'node:fs/promises';
import { expect, type Locator, type Page } from '@playwright/test';
import { fixturePath } from './pdf-files.ts';

// 描画の完了を待つ上限。実際の Google Chrome では、150 ページ(約 2.7 億 px)の描画に 35 秒以上かかり、
// 並列で走る他のテストと重なるとさらに延びるので、遅い環境でも誤って失敗しないよう、余裕を持たせる
export const RENDER_TIMEOUT_MS = 240_000;

// 画面の主な要素(index.html の ID)
const SELECTORS = {
  pick: '#pick',
  columns: '#columns',
  separators: '#separators',
  segment: '#segment',
  status: '#status',
  zoomOut: '#zoom-out',
  zoomLevel: '#zoom-level',
  zoomIn: '#zoom-in',
  zoomFit: '#zoom-fit',
  download: '#download',
  downloadAll: '#download-all',
  downloadPdf: '#download-pdf',
  downloadAllPdf: '#download-all-pdf',
  thumbnails: '#thumbnails',
  preview: '#preview',
  stage: '#stage',
  canvas: '#canvas',
} as const;

/** 画面の主な要素を、名前で取り出せるようにする。 */
export function ui(page: Page): Record<keyof typeof SELECTORS, Locator> {
  const entries = Object.entries(SELECTORS).map(([name, selector]) => [name, page.locator(selector)]);
  return Object.fromEntries(entries) as Record<keyof typeof SELECTORS, Locator>;
}

/** ファイル選択で PDF(または他のファイル)を渡す。 */
export async function chooseFile(page: Page, name: string): Promise<void> {
  await page.setInputFiles('#file-input', fixturePath(name));
}

/** 描画が完了する(ダウンロードできるようになる)まで待つ。 */
export async function expectRendered(page: Page): Promise<void> {
  await expect(ui(page).download).toBeEnabled({ timeout: RENDER_TIMEOUT_MS });
}

/** PDF を選び、描画が完了するまで待つ。 */
export async function openAndWait(page: Page, name: string): Promise<void> {
  await chooseFile(page, name);
  await expectRendered(page);
}

/**
 * CPU を rate 倍遅くする(CDP のエミュレーション)。描画の途中の状態を、実行する環境の速さに関係なく捉えるために使う。
 * 「まだ終わっていない」ことを前提にするテストが、速い環境で、確認する前に描画が終わってしまうのを防ぐ。
 */
export async function throttleCpu(page: Page, rate: number): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate });
}

/** ダウンロードボタンを押して、保存されたファイル名と中身(PNG)を受け取る。 */
export async function downloadPng(page: Page): Promise<{ fileName: string; data: Buffer }> {
  const [download] = await Promise.all([page.waitForEvent('download'), ui(page).download.click()]);
  return { fileName: download.suggestedFilename(), data: await readFile(await download.path()) };
}

/** ドロップするファイル(名前、種類、内容を base64 にしたもの)。 */
interface DroppedFile {
  readonly name: string;
  readonly type: string;
  readonly base64: string;
}

/**
 * ブラウザの中で、ファイルを target(セレクタ)にドロップしたことにする(ドロップのイベントを発生させる)。
 * ブラウザの既定の動作(ファイルを開いて画面が遷移する)が止められたか(defaultPrevented)を返す。
 */
function dispatchDrop({ items, target }: { items: DroppedFile[]; target: string }): boolean {
  const transfer = new DataTransfer();
  for (const { name, type, base64 } of items) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    transfer.items.add(new File([bytes], name, { type }));
  }
  const drop = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
  document.querySelector(target)?.dispatchEvent(drop);
  return drop.defaultPrevented;
}

/** 指定したファイルを、target(既定はプレビュー領域)へドロップする。ブラウザの既定の動作が止められたかを返す。 */
export async function dropFiles(page: Page, names: readonly string[], target = '#preview'): Promise<boolean> {
  /** ファイルを読み、ドロップする形(名前、種類、base64)にする。 */
  const read = async (name: string): Promise<DroppedFile> => ({
    name,
    type: name.endsWith('.pdf') ? 'application/pdf' : 'text/plain',
    base64: (await readFile(fixturePath(name))).toString('base64'),
  });
  return page.evaluate(dispatchDrop, { items: await Promise.all(names.map(read)), target });
}
