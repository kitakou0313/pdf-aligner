// 倍率は「画像ピクセル基準」: 1(100%)は、画像の 1 px が物理画面の 1 px に当たる状態
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
// ＋ / − ボタンの 1 回で変わる倍率の比(M4 で操作感を見て調整しうる)
export const ZOOM_STEP = 1.25;

/** 幅と高さ(CSS px または画像の px)。 */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** 座標(CSS px)。 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** ズームのモード: fit は全体が収まる倍率に追従し、manual はユーザーが決めた倍率を保つ。 */
export type ZoomState = { readonly mode: 'fit' } | { readonly mode: 'manual'; readonly zoom: number };

/** ズームのモードを変える操作。 */
export type ZoomEvent = { readonly type: 'fit' } | { readonly type: 'set'; readonly zoom: number };

/** 値が 0 より大きい有限の数であることを確かめる(そうでなければ RangeError)。 */
function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name}は 0 より大きい有限の数: ${value}`);
}

/** 画像ピクセル基準の倍率を、CSS の transform: scale() に渡す拡大率にする(dpr は devicePixelRatio)。 */
export function cssScale(zoom: number, dpr: number): number {
  assertPositive(dpr, 'devicePixelRatio');
  return zoom / dpr;
}

/** 領域の大きさが 0 以上の有限の数であることを確かめる(0 は、非表示の間として許す)。 */
function assertViewport(viewport: Size): void {
  for (const value of [viewport.width, viewport.height]) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`領域の大きさが不正です: ${value}`);
  }
}

/** 画像全体が領域(CSS px)に収まる倍率を求める。上限は 100%(小さい画像を拡大しない)。 */
export function fitZoom(image: Size, viewport: Size, dpr: number): number {
  assertPositive(image.width, '画像の幅');
  assertPositive(image.height, '画像の高さ');
  assertPositive(dpr, 'devicePixelRatio');
  assertViewport(viewport);
  const cssFit = Math.min(viewport.width / image.width, viewport.height / image.height);
  return Math.min(cssFit * dpr, 1);
}

/** 倍率の範囲を返す。下限は 10% と「全体が収まる倍率」の小さい方(巨大な画像でも全体を見られる)。 */
export function zoomRange(fit: number): { min: number; max: number } {
  return { min: Math.min(MIN_ZOOM, fit), max: MAX_ZOOM };
}

/** 倍率を、範囲内に丸める(数でなければ RangeError)。 */
export function clampZoom(zoom: number, fit: number): number {
  if (Number.isNaN(zoom)) throw new RangeError('倍率が数ではありません');
  const { min, max } = zoomRange(fit);
  return Math.min(max, Math.max(min, zoom));
}

/** モードから、実際に使う倍率を決める(manual の倍率も、範囲が変わったときのために丸める)。 */
export function resolveZoom(state: ZoomState, fit: number): number {
  return state.mode === 'fit' ? fit : clampZoom(state.zoom, fit);
}

/** ＋(direction = 1)/ −(direction = -1)ボタンの 1 段階だけ、倍率を変える。 */
export function stepZoom(zoom: number, direction: 1 | -1, fit: number): number {
  return clampZoom(direction === 1 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP, fit);
}

/** 1 つの軸で、カーソルの下の画像上の点を動かさない、新しいスクロール位置を求める。 */
function anchoredScroll(scroll: number, pointer: number, oldCss: number, newCss: number): number {
  return ((scroll + pointer) / oldCss) * newCss - pointer;
}

/**
 * カーソル(pointer。領域の左上からの CSS px)の下にある画像上の点を動かさずに、拡大率を変えたときの、
 * 新しいスクロール位置を返す。縮小では負になりうるので、clampScroll で範囲に収める。
 */
export function scrollForZoomAt(scroll: Point, pointer: Point, oldCss: number, newCss: number): Point {
  assertPositive(oldCss, '変更前の拡大率');
  assertPositive(newCss, '変更後の拡大率');
  if (oldCss === newCss) return { x: scroll.x, y: scroll.y };
  return {
    x: anchoredScroll(scroll.x, pointer.x, oldCss, newCss),
    y: anchoredScroll(scroll.y, pointer.y, oldCss, newCss),
  };
}

/** 1 つの軸のスクロール位置を、0 〜 max に収める。 */
function clampAxis(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

/** スクロール位置を、動ける範囲(0 〜 内容 − 領域)に収める。内容が領域より小さい軸は 0。 */
export function clampScroll(scroll: Point, content: Size, viewport: Size): Point {
  return {
    x: clampAxis(scroll.x, Math.max(0, content.width - viewport.width)),
    y: clampAxis(scroll.y, Math.max(0, content.height - viewport.height)),
  };
}

/** ズームのモードを遷移させる。操作(set)で manual、「画面に合わせる」と新しい PDF の読み込み(fit)で fit。 */
export function reduceZoom(_state: ZoomState, event: ZoomEvent): ZoomState {
  return event.type === 'fit' ? { mode: 'fit' } : { mode: 'manual', zoom: event.zoom };
}
