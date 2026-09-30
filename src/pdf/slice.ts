import { PDFDocument } from '@pdfme/pdf-lib';
import { segmentPageCount, type Segment } from '../core/segments.ts';

/** セグメントが、総ページ数の範囲内の、整数の範囲であることを確かめる(そうでなければ RangeError)。 */
function assertRange(segment: Segment, pageCount: number): void {
  const { start, end } = segment;
  if (Number.isInteger(start) && Number.isInteger(end) && start >= 1 && start <= end && end <= pageCount) return;
  throw new RangeError(`ページの範囲が不正: p.${start}–${end}(総ページ数 ${pageCount})`);
}

/**
 * PDF のバイト列から、segment(1 始まり、end を含む)のページだけを、元のページのまま(ベクターのまま)
 * 切り出した、新しい PDF のバイト列を作る。ページの内容・回転・大きさ・そのページの注釈は引き継ぎ、
 * しおり・メタデータ・フォームなど文書レベルの情報は引き継がない。読めない PDF は、例外で拒否する。
 */
export async function slicePages(bytes: Uint8Array, segment: Segment): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes);
  assertRange(segment, source.getPageCount());
  const target = await PDFDocument.create();
  const indices = Array.from({ length: segmentPageCount(segment) }, (_, offset) => segment.start - 1 + offset);
  for (const page of await target.copyPages(source, indices)) target.addPage(page);
  return target.save();
}
