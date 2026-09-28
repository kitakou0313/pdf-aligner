import type { PageSize } from './layout.ts';

// 元PDFプレビュー(F11)の、サムネイル 1 枚の固定の幅(px)。Q8: サイドバーは固定幅で、リサイズはできない。
export const THUMBNAIL_WIDTH = 96;

/**
 * 元PDFプレビュー(F11)のサムネイルの高さ(px)を、ページの縦横比を保ったまま、固定の幅から求める。
 * 端数は四捨五入する。
 */
export function computeThumbnailHeight(pageSize: PageSize, width: number): number {
  return Math.round((width * pageSize.height) / pageSize.width);
}
