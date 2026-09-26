/** ページの大きさ(pt)。 */
export interface PageSizePt {
  readonly width: number;
  readonly height: number;
}

/** 出力画像の上の矩形(px)。 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 期待する画像の大きさと、各ページ・各セルの位置。 */
export interface Grid {
  readonly width: number;
  readonly height: number;
  readonly rows: number;
  page(index: number): Rect;
  cell(index: number): Rect;
}

// blueprint の「レイアウトの計算式」を、アプリの実装(src/core/layout.ts)とは独立に、そのまま書き下したもの。
// E2E の期待値の根拠は、実装ではなく blueprint の式と数値例にする(tests/unit/e2e-geometry.test.ts が、数値例との一致を確かめる)。
const GAP_AT_1X = 16;

/** blueprint の式による、列数 columns、倍率 scale の並べ方。 */
class BlueprintGrid implements Grid {
  readonly width: number;
  readonly height: number;
  readonly rows: number;
  private readonly cellWidth: number;
  private readonly cellHeight: number;
  private readonly gap: number;
  private readonly pages: readonly PageSizePt[];
  private readonly columns: number;
  private readonly scale: number;

  /** ページの大きさ(pt)の一覧、列数、倍率から、画像の大きさとセルの大きさを求める。 */
  constructor(pages: readonly PageSizePt[], columns: number, scale: number) {
    [this.pages, this.columns, this.scale] = [pages, columns, scale];
    this.cellWidth = Math.max(...pages.map((p) => p.width)) * scale;
    this.cellHeight = Math.max(...pages.map((p) => p.height)) * scale;
    this.gap = GAP_AT_1X * scale;
    this.rows = Math.ceil(pages.length / columns);
    this.width = Math.ceil(2 * this.gap + columns * this.cellWidth + (columns - 1) * this.gap);
    this.height = Math.ceil(2 * this.gap + this.rows * this.cellHeight + (this.rows - 1) * this.gap);
  }

  /** i 番目(0 始まり)のセルの位置と大きさ。行方向(左から右、上から下)の順。 */
  cell(index: number): Rect {
    const [row, col] = [Math.floor(index / this.columns), index % this.columns];
    const x = Math.round(this.gap + col * (this.cellWidth + this.gap));
    const y = Math.round(this.gap + row * (this.cellHeight + this.gap));
    return { x, y, width: this.cellWidth, height: this.cellHeight };
  }

  /** i 番目のページを、セルの中央に(縮小せずに)置いたときの位置と大きさ。 */
  page(index: number): Rect {
    const cell = this.cell(index);
    const size = this.pages[index] as PageSizePt;
    const [width, height] = [size.width * this.scale, size.height * this.scale];
    const x = Math.round(cell.x + (cell.width - width) / 2);
    const y = Math.round(cell.y + (cell.height - height) / 2);
    return { x, y, width, height };
  }
}

/** blueprint の式で、列数 columns、倍率 scale のときの、画像の大きさと各ページの位置を求める。 */
export function gridOf(pages: readonly PageSizePt[], columns: number, scale: number): Grid {
  return new BlueprintGrid(pages, columns, scale);
}

/** 矩形の中の点(左上を 0、右下を 1 とした割合で指定)を、画像上の整数の座標にする。 */
export function pointIn(rect: Rect, fx: number, fy: number): { x: number; y: number } {
  return { x: Math.floor(rect.x + rect.width * fx), y: Math.floor(rect.y + rect.height * fy) };
}
