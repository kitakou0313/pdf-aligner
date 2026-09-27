/** セグメント: 区切りで分けた、連続したページの範囲。どちらも 1 始まりのページ番号で、end を含む。 */
export interface Segment {
  readonly start: number;
  readonly end: number;
}

/** 総ページ数が 1 以上の整数で、区切りが 2〜総ページ数の整数(昇順・重複なし)か。正規化した区切りかどうかの判定に使う。 */
export function isValidSeparators(pageCount: number, separators: readonly number[]): boolean {
  if (!Number.isInteger(pageCount) || pageCount < 1) return false;
  return separators.every((page, index) => {
    const previous = separators[index - 1] ?? 1;
    return Number.isInteger(page) && page > previous && page <= pageCount;
  });
}

/** 総ページ数と区切りが正しいことを確かめる(そうでなければ RangeError)。 */
function assertSeparators(pageCount: number, separators: readonly number[]): void {
  if (isValidSeparators(pageCount, separators)) return;
  throw new RangeError(`総ページ数は 1 以上の整数で、区切りは 2〜総ページ数の昇順・重複なしの整数: ${pageCount}, [${separators.join(', ')}]`);
}

/**
 * 全ページを、区切りでセグメントに分ける。区切りに指定したページは、新しいセグメントの先頭になる。
 * 全ページがちょうど 1 つのセグメントに入り(重複も欠落もない)、セグメントは区切りの数 + 1 個になる。
 */
export function segmentsOf(pageCount: number, separators: readonly number[]): Segment[] {
  assertSeparators(pageCount, separators);
  const starts = [1, ...separators];
  return starts.map((start, index) => ({ start, end: (starts[index + 1] ?? pageCount + 1) - 1 }));
}

/** page(1 始まり)を含むセグメントの番号(0 始まり)を返す。ページが範囲外なら RangeError。 */
export function segmentIndexOf(segments: readonly Segment[], page: number): number {
  const index = segments.findIndex((segment) => segment.start <= page && page <= segment.end);
  if (!Number.isInteger(page) || index < 0) throw new RangeError(`ページが範囲外: ${page}`);
  return index;
}

/** 区切りを変えたときに表示するセグメントの先頭ページ: 直前に表示していたセグメントの先頭ページ(shownStart)を含む、新しいセグメントの先頭。 */
export function followedStart(shownStart: number, segments: readonly Segment[]): number {
  return (segments[segmentIndexOf(segments, shownStart)] as Segment).start;
}

/** セグメントのページ範囲の表記(p.<開始>–<終了>。1 ページだけでも同じ書式)。 */
export function segmentRange(segment: Segment): string {
  return `p.${segment.start}–${segment.end}`;
}

/** セレクタの選択肢の表記(p.<開始>–<終了>(<番号>/<個数>))。index は 0 始まりで、表記の番号は 1 始まり。 */
export function segmentLabel(segment: Segment, index: number, total: number): string {
  return `${segmentRange(segment)}(${index + 1}/${total})`;
}

/** セグメントに含まれるページ数。 */
export function segmentPageCount(segment: Segment): number {
  return segment.end - segment.start + 1;
}

/** セグメントの実際の列数: 列数と、セグメントのページ数の小さい方(総ページ数より多い列を作らない規則と同じ考え方)。 */
export function effectiveColumns(columns: number, segment: Segment): number {
  return Math.min(columns, segmentPageCount(segment));
}
