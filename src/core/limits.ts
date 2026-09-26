/** canvas の大きさの上限(1 辺の長さと面積。単位は px)。 */
export interface CanvasLimits {
  readonly maxSide: number;
  readonly maxArea: number;
}

// Chrome の canvas の上限として認識している値。実測は M5 で行い、blueprint の F3 に追記して確定する
export const CHROME_CANVAS_LIMITS: CanvasLimits = { maxSide: 32767, maxArea: 268_435_456 };

// 目標の倍率(PDF の 1 pt を 2 px にする)
export const TARGET_SCALE = 2;

// ページ間の隙間と外周の余白の幅(倍率 1 のときの px)。実際の幅は倍率に比例する
export const GAP_AT_1X = 16;
