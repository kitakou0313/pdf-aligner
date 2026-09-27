import { effectiveColumns, type Segment } from './segments.ts';

// 元のファイル名が空(拡張子だけ)のときに使う名前
export const FALLBACK_BASE_NAME = 'aligned';

/** 列数が 1 以上の整数であることを確かめる(そうでなければ RangeError)。 */
function assertColumns(columns: number): void {
  if (!Number.isInteger(columns) || columns < 1) throw new RangeError(`列数は 1 以上の整数: ${columns}`);
}

/** 元のファイル名から、末尾の .pdf(大文字小文字は区別しない)を 1 つだけ除いた名前。空になるときは、代わりの名前。 */
function baseNameOf(originalName: string): string {
  return originalName.replace(/\.pdf$/i, '').trim() || FALLBACK_BASE_NAME;
}

/** ダウンロードする PNG のファイル名(<元の名前(.pdf なし)>-<列数>cols.png)を作る。 */
export function downloadFileName(originalName: string, columns: number): string {
  assertColumns(columns);
  return `${baseNameOf(originalName)}-${columns}cols.png`;
}

/** ページ番号を、総ページ数の桁数までゼロで埋める(名前順に並べると、ページ順になる)。 */
function padPage(page: number, pageCount: number): string {
  return String(page).padStart(String(pageCount).length, '0');
}

/**
 * セグメントの PNG のファイル名(<元の名前>-p<開始>-<終了>-<実際の列数>cols.png)を作る。
 * columns は、そのセグメントの実際の列数(画像の内容と名前が食い違わないようにする)。
 */
export function segmentFileName(originalName: string, segment: Segment, pageCount: number, columns: number): string {
  assertColumns(columns);
  const range = `p${padPage(segment.start, pageCount)}-${padPage(segment.end, pageCount)}`;
  return `${baseNameOf(originalName)}-${range}-${columns}cols.png`;
}

/**
 * index 番目のセグメントの画像を保存するときのファイル名。セグメントが 1 個(区切りなし)のときは、
 * 従来の名前(downloadFileName)のまま。2 個以上のときは、ページ範囲と、そのセグメントの実際の列数を入れる。
 */
export function imageFileName(originalName: string, columns: number, segments: readonly Segment[], index: number): string {
  const segment = segments[index];
  if (!segment) throw new RangeError(`セグメントの番号が範囲外: ${index}`);
  if (segments.length === 1) return downloadFileName(originalName, columns);
  const pageCount = (segments.at(-1) as Segment).end;
  return segmentFileName(originalName, segment, pageCount, effectiveColumns(columns, segment));
}
