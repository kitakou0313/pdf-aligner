import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { untilDone } from './source.ts';

/** ページの縦横比を保ったまま、指定した幅に収まる表示領域(pdf.js の viewport)を作る。 */
function thumbnailViewport(page: PDFPageProxy, targetWidth: number): ReturnType<PDFPageProxy['getViewport']> {
  const unscaled = page.getViewport({ scale: 1 });
  return page.getViewport({ scale: targetWidth / unscaled.width });
}

/** canvas を表示領域の大きさにして、ページを描く(最終の出力画像とは違い、canvas は小さいので直接描く。F11)。 */
async function paintThumbnail(page: PDFPageProxy, canvas: HTMLCanvasElement, targetWidth: number, signal: AbortSignal): Promise<void> {
  const viewport = thumbnailViewport(page, targetWidth);
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const task = page.render({ canvas, viewport });
  await untilDone(task, signal);
}

/** 元PDFプレビュー(F11)の 1 ページを、指定した幅に収まるサムネイルとして canvas に描く。 */
export async function renderThumbnailPage(doc: PDFDocumentProxy, pageNumber: number, targetWidth: number, canvas: HTMLCanvasElement, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const page = await doc.getPage(pageNumber);
  try {
    signal.throwIfAborted();
    await paintThumbnail(page, canvas, targetWidth, signal);
  } finally {
    page.cleanup();
  }
}
