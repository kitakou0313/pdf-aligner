// 列数の既定値の上限(総ページ数がこれより少なければ、総ページ数にする)
export const DEFAULT_COLUMNS = 10;

/** 総ページ数が 1 以上の整数であることを確かめる(そうでなければ RangeError)。 */
function assertPageCount(pageCount: number): void {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new RangeError(`総ページ数は 1 以上の整数: ${pageCount}`);
}

/** PDF を読み込んだときの列数(10 と総ページ数の小さい方)を返す。 */
export function defaultColumns(pageCount: number): number {
  assertPageCount(pageCount);
  return Math.min(DEFAULT_COLUMNS, pageCount);
}

/**
 * 列数の入力欄の文字列を、範囲内(1〜総ページ数)の整数にする。小数は四捨五入する。
 * 空欄や数として読めない文字列のときは、直前の値に戻す。
 */
export function normalizeColumns(raw: string, pageCount: number, previous: number): number {
  assertPageCount(pageCount);
  const text = raw.trim();
  const value = text === '' ? Number.NaN : Number(text);
  if (!Number.isFinite(value)) return previous;
  return Math.min(pageCount, Math.max(1, Math.round(value)));
}

/**
 * 入力の途中で、すぐに画像へ反映してよい値を取り出す。範囲内(1〜総ページ数)の整数だけを返し、
 * それ以外(空欄、範囲外、小数、入力の途中)は null。丸めて反映するのは、フォーカスを外したとき(normalizeColumns)。
 */
export function liveColumns(raw: string, pageCount: number): number | null {
  assertPageCount(pageCount);
  const text = raw.trim();
  const value = text === '' ? Number.NaN : Number(text);
  return Number.isInteger(value) && value >= 1 && value <= pageCount ? value : null;
}
