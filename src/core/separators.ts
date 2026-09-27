// 区切りの項目として読める文字列(半角の 10 進の整数。符号、小数、指数、全角の数字は含まない)
const PAGE_TOKEN = /^\d+$/;

/** 入力欄の文字列を、半角のカンマで区切った項目にする(前後の空白は除く。空欄は項目なし)。 */
function itemsOf(raw: string): string[] {
  return raw.trim() === '' ? [] : raw.split(',').map((item) => item.trim());
}

/** 項目が、2〜総ページ数の整数のページ番号として読めるならその番号を、そうでなければ null を返す。 */
function pageOf(item: string, pageCount: number): number | null {
  if (!PAGE_TOKEN.test(item)) return null;
  const page = Number(item);
  return page >= 2 && page <= pageCount ? page : null;
}

/** 重複を 1 つにまとめ、昇順に並べる。 */
function ascending(pages: readonly number[]): number[] {
  return [...new Set(pages)].sort((a, b) => a - b);
}

/**
 * 確定したときの区切りの入力を、有効なページ番号だけの、昇順で重複のない配列にする(blueprint の F9)。
 * 半角の整数として読めない項目、2〜総ページ数の外の項目(1 ページ目を含む)は、エラーにせず捨てる。
 */
export function parseSeparators(raw: string, pageCount: number): number[] {
  const pages = itemsOf(raw).map((item) => pageOf(item, pageCount));
  return ascending(pages.filter((page): page is number => page !== null));
}

/**
 * 入力の途中で、すぐに反映してよい区切りを取り出す。全ての項目が有効なページ番号のとき(空欄を含む)だけ、
 * 昇順で重複のない配列を返す。無効な項目が 1 つでもあれば null(打っている途中かもしれないので、反映しない)。
 */
export function liveSeparators(raw: string, pageCount: number): number[] | null {
  const pages = itemsOf(raw).map((item) => pageOf(item, pageCount));
  return pages.includes(null) ? null : ascending(pages as number[]);
}

/** 2 つの区切りが、同じ並びかどうか。 */
export function sameSeparators(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** 区切りを、入力欄に書き戻す文字列(カンマと空白で区切る。区切りなしは空欄)にする。 */
export function formatSeparators(separators: readonly number[]): string {
  return separators.join(', ');
}
