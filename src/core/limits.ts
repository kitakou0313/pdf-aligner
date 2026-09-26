/** canvas の大きさの上限(1 辺の長さと面積。単位は px)。 */
export interface CanvasLimits {
  readonly maxSide: number;
  readonly maxArea: number;
}

// Chrome の canvas の上限。Playwright 同梱の Chromium(macOS arm64)での実測(M5)で、辺は 65,535 px まで、
// 面積は 268,435,456 px(16,384 の 2 乗)ちょうどまで確保・描画・読み戻しができ、それを 1 px でも超えると確保に失敗する。
// 根拠と手順は blueprint の F3 に書いてある
export const CHROME_CANVAS_LIMITS: CanvasLimits = { maxSide: 65_535, maxArea: 268_435_456 };

// 目標の倍率(PDF の 1 pt を 2 px にする)
export const TARGET_SCALE = 2;

// ページ間の隙間と外周の余白の幅(倍率 1 のときの px)。実際の幅は倍率に比例する
export const GAP_AT_1X = 16;

// 出力画像の背景(薄いグレー。不透明)。隙間、外周の余白、空きセル、描画に失敗したページのセルの色
export const BACKGROUND_COLOR = 'rgb(230, 230, 230)';
