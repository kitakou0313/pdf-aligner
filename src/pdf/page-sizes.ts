import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageSize } from '../core/layout.ts';

// 1 ページも大きさが読めないときの代替(US レター。pdf.js の既定の用紙と同じ)
export const FALLBACK_PAGE_SIZE: PageSize = { width: 612, height: 792 };

/** 大きさが、レイアウトの計算に使える(正の有限の数)かどうか。 */
function isUsable(size: PageSize): boolean {
  return [size.width, size.height].every((value) => Number.isFinite(value) && value > 0);
}

/** 1 ページの大きさ(pt)を、倍率 1 の表示領域から読む。取得できないとき、大きさが不正なときは null。 */
async function sizeOf(doc: PDFDocumentProxy, pageNumber: number): Promise<PageSize | null> {
  try {
    const page = await doc.getPage(pageNumber);
    const { width, height } = page.getViewport({ scale: 1 });
    page.cleanup();
    return isUsable({ width, height }) ? { width, height } : null;
  } catch {
    return null;
  }
}

/** 全ページの大きさ(sizes)と、大きさが読めたページか(readable)。読めなかったページの大きさは、代わりの大きさ。 */
export interface PageSizeTable {
  readonly sizes: readonly PageSize[];
  readonly readable: readonly boolean[];
}

/**
 * 全ページの大きさ(pt)を、ページ順に読む。表示領域は回転と表示範囲(CropBox)を反映している。
 * 読めなかったページは、最初に読めたページの大きさにする(壊れたページが、他のページのセルの大きさを変えないため。
 * 1 ページも読めないときだけ、代替の大きさ)。そのページは、描画のときに同じ理由で失敗し、失敗したページとして記録される。
 * どのページが読めなかったかも返す(区切りで分けるときは、セグメントごとに、代わりの大きさを決め直すため)。
 */
export async function readPageSizes(doc: PDFDocumentProxy): Promise<PageSizeTable> {
  const read = await Promise.all(Array.from({ length: doc.numPages }, (_, index) => sizeOf(doc, index + 1)));
  const substitute = read.find((size) => size !== null) ?? FALLBACK_PAGE_SIZE;
  return { sizes: read.map((size) => size ?? substitute), readable: read.map((size) => size !== null) };
}
