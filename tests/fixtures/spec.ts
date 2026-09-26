/** RGB の色(各成分は 0〜255)。 */
export type Rgb = readonly [number, number, number];

/** ページの大きさ(pt)。 */
export interface PageSize {
  readonly width: number;
  readonly height: number;
}

export const A4: PageSize = { width: 595, height: 842 };
export const A4_LANDSCAPE: PageSize = { width: 842, height: 595 };
export const A3: PageSize = { width: 842, height: 1191 };

/** 暗号化したフィクスチャのユーザーパスワード。 */
export const ENCRYPTED_PASSWORD = 'secret';

/** フォント非埋め込みの日本語フィクスチャに書く文字列と、その Shift_JIS(16 進表記)。 */
export const CJK_TEXT = '日本語のテスト';
export const CJK_TEXT_SJIS_HEX = '93FA967B8CEA82CC836583588367';

// 各成分を 6 段階にした色から、灰色(R=G=B)を除いたもの。背景の灰色と取り違えないようにする
const LEVELS = [20, 60, 100, 140, 180, 220] as const;
// 隣り合うページの色が似すぎないよう、パレットを互いに素な歩幅で飛び飛びに使う
const STRIDE = 89;

/** 灰色を除いた全ての色(210 色)を、決まった順に並べる。 */
function buildPalette(): Rgb[] {
  const colors: Rgb[] = [];
  for (const r of LEVELS) for (const g of LEVELS) for (const b of LEVELS) {
    if (!(r === g && g === b)) colors.push([r, g, b]);
  }
  return colors;
}

const PALETTE = buildPalette();

/** ページの色を、互いに区別できる形で割り当てられる最大のページ数。 */
export const MAX_FIXTURE_PAGES = PALETTE.length;

/** ページ番号(0 始まり)に対応する単色を返す。全ページで異なり、灰色から離れている。 */
export function pageColor(index: number): Rgb {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_FIXTURE_PAGES) {
    throw new RangeError(`ページ番号が範囲外です: ${index}`);
  }
  return PALETTE[(index * STRIDE) % MAX_FIXTURE_PAGES] as Rgb;
}

/** 背景色の上に置く文字色を返す(暗い背景には白、明るい背景には黒)。 */
export function textColorFor([r, g, b]: Rgb): Rgb {
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 140 ? [0, 0, 0] : [255, 255, 255];
}
