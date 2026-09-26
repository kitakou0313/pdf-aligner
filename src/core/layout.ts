import { CHROME_CANVAS_LIMITS, GAP_AT_1X, TARGET_SCALE, type CanvasLimits } from './limits.ts';

/** ページの大きさ(pt。回転と表示範囲を反映したもの)。 */
export interface PageSize {
  readonly width: number;
  readonly height: number;
}

/** 出力画像の上での、1 ページの描画位置と大きさ(px)。index は 0 始まり。 */
export interface Placement {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 全ページを並べた出力画像の設計図。 */
export interface Layout {
  readonly scale: number;
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly gap: number;
  readonly width: number;
  readonly height: number;
  readonly placements: readonly Placement[];
}

/** 上限に合わせて決めたレイアウトと、目標の倍率から縮小したかどうか。 */
export interface LayoutPlan {
  readonly layout: Layout;
  readonly shrunk: boolean;
}

interface Geometry {
  readonly scale: number;
  readonly gap: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
}

// 浮動小数点の誤差(整数のはずの値が僅かに超える)で、切り上げが 1 増えないようにする許容
const EPSILON = 1e-9;
// 上限に収まる倍率の探索: 最大の繰り返し回数と、上限ぎりぎりで再び超えないための安全率
const MAX_SHRINK_STEPS = 50;
const SAFETY = 1 - 1e-6;

/** 値が 0 より大きい有限の数であることを確かめる(そうでなければ RangeError)。 */
function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name}は 0 より大きい有限の数: ${value}`);
}

/** ページ、列数、倍率が正しいことを確かめる(そうでなければ RangeError)。 */
function validate(pages: readonly PageSize[], columns: number, scale: number): void {
  if (pages.length < 1) throw new RangeError('ページが 1 枚もありません');
  if (!Number.isInteger(columns) || columns < 1 || columns > pages.length) {
    throw new RangeError(`列数は 1〜${pages.length} の整数: ${columns}`);
  }
  assertPositive(scale, '倍率');
  for (const page of pages) {
    assertPositive(page.width, 'ページの幅');
    assertPositive(page.height, 'ページの高さ');
  }
}

/** 倍率から、セルの大きさと隙間(小数のまま)を求める。セルは全ページの最大の幅 × 最大の高さ。 */
function geometryOf(pages: readonly PageSize[], scale: number): Geometry {
  const maxWidth = pages.reduce((max, page) => Math.max(max, page.width), 0);
  const maxHeight = pages.reduce((max, page) => Math.max(max, page.height), 0);
  return { scale, gap: GAP_AT_1X * scale, cellWidth: maxWidth * scale, cellHeight: maxHeight * scale };
}

/** i 番目のセルの左上(小数のまま)を、行方向の順(左から右、上から下)で求める。 */
function cellOrigin(g: Geometry, index: number, columns: number): { x: number; y: number } {
  const row = Math.floor(index / columns);
  const col = index % columns;
  return { x: g.gap + col * (g.cellWidth + g.gap), y: g.gap + row * (g.cellHeight + g.gap) };
}

/** i 番目のページを、セルの中央に置いたときの配置(座標と大きさは四捨五入)を求める。 */
function placeAt(g: Geometry, index: number, page: PageSize, columns: number): Placement {
  const cell = cellOrigin(g, index, columns);
  const [w, h] = [page.width * g.scale, page.height * g.scale];
  const x = Math.round(cell.x + (g.cellWidth - w) / 2);
  const y = Math.round(cell.y + (g.cellHeight - h) / 2);
  return { index, x, y, width: Math.round(w), height: Math.round(h) };
}

/** 画像全体の大きさ(小数のまま): 外周の余白、セル、セル間の隙間の合計。 */
function rawCanvasSize(g: Geometry, columns: number, rows: number): { width: number; height: number } {
  const width = 2 * g.gap + columns * g.cellWidth + (columns - 1) * g.gap;
  const height = 2 * g.gap + rows * g.cellHeight + (rows - 1) * g.gap;
  return { width, height };
}

/** 切り上げる。浮動小数点の誤差で、ちょうど整数の値が 1 増えないようにする。 */
function ceilTolerant(value: number): number {
  return Math.ceil(value - EPSILON);
}

/** 全ページを、指定した列数と倍率で並べたレイアウトを計算する(範囲外の入力は RangeError)。 */
export function computeLayout(pages: readonly PageSize[], columns: number, scale: number): Layout {
  validate(pages, columns, scale);
  const g = geometryOf(pages, scale);
  const rows = Math.ceil(pages.length / columns);
  const raw = rawCanvasSize(g, columns, rows);
  const placements = pages.map((page, index) => placeAt(g, index, page, columns));
  const size = { width: ceilTolerant(raw.width), height: ceilTolerant(raw.height) };
  return { scale, columns, rows, cellWidth: g.cellWidth, cellHeight: g.cellHeight, gap: g.gap, ...size, placements };
}

/** 画像が上限を超えている割合を返す(1 以下なら収まっている)。 */
function overshoot(layout: Layout, limits: CanvasLimits): number {
  const side = Math.max(layout.width, layout.height) / limits.maxSide;
  return Math.max(side, Math.sqrt((layout.width * layout.height) / limits.maxArea));
}

/**
 * 上限に収まる最大に近い倍率を求める。目標の倍率から始め、超えていれば「超過率」で割って縮める。
 * 画像の大きさは倍率にほぼ比例するので、通常は 1〜2 回で収束する(切り上げによる 1 px の超過を吸収する)。
 */
function settleScale(pages: readonly PageSize[], columns: number, limits: CanvasLimits, start: number): number {
  let scale = start;
  for (let step = 0; step < MAX_SHRINK_STEPS; step += 1) {
    const ratio = overshoot(computeLayout(pages, columns, scale), limits);
    if (ratio <= 1) return scale;
    scale = (scale / ratio) * SAFETY;
  }
  throw new RangeError('上限に収まる倍率が見つかりません');
}

/** 上限が、1 px 以上の有限の数であることを確かめる(そうでなければ RangeError)。 */
function validateLimits(limits: CanvasLimits, target: number): void {
  for (const value of [limits.maxSide, limits.maxArea]) {
    if (!Number.isFinite(value) || value < 1) throw new RangeError(`canvas の上限が不正です: ${value}`);
  }
  assertPositive(target, '目標の倍率');
}

/** 目標の倍率で並べ、canvas の上限を超えるときは、収まる最大に近い倍率まで縮小したレイアウトを決める。 */
export function planLayout(
  pages: readonly PageSize[],
  columns: number,
  limits: CanvasLimits = CHROME_CANVAS_LIMITS,
  target: number = TARGET_SCALE,
): LayoutPlan {
  validateLimits(limits, target);
  validate(pages, columns, target);
  const scale = settleScale(pages, columns, limits, target);
  return { layout: computeLayout(pages, columns, scale), shrunk: scale < target };
}
