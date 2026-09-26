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

/** 画像が領域より小さい軸で、画像を中央に置くための余白(領域の内側。大きい軸では 0)。 */
function centeringOffset(imageSize: number, viewportSize: number, css: number): number {
  return Math.max(0, (viewportSize - imageSize * css) / 2);
}

/** 拡縮の前後のスクロール位置を求めるための条件。pointer は、領域の左上からの位置(CSS px)。 */
export interface AnchoredZoom {
  readonly scroll: Point;
  readonly pointer: Point;
  readonly image: Size;
  readonly viewport: Size;
  readonly oldCss: number;
  readonly newCss: number;
}

/**
 * カーソルの下にある画像上の点を動かさずに、拡大率を oldCss から newCss に変えたときの、新しいスクロール位置。
 * 画像が領域より小さい軸は、画像が中央に置かれる(余白の分だけずれる)ので、その余白を差し引いて計算し、
 * 結果は動ける範囲(0 〜 画像 − 領域)に収める。
 */
export function zoomAnchoredScroll(args: AnchoredZoom): Point {
  const { scroll, pointer, image, viewport, oldCss, newCss } = args;
  const before = { x: centeringOffset(image.width, viewport.width, oldCss), y: centeringOffset(image.height, viewport.height, oldCss) };
  const after = { x: centeringOffset(image.width, viewport.width, newCss), y: centeringOffset(image.height, viewport.height, newCss) };
  const onImage = { x: pointer.x - before.x, y: pointer.y - before.y };
  const moved = scrollForZoomAt(scroll, onImage, oldCss, newCss);
  const shifted = { x: moved.x + after.x - before.x, y: moved.y + after.y - before.y };
  return clampScroll(shifted, { width: image.width * newCss, height: image.height * newCss }, viewport);
}

// Ctrl+ホイールとピンチ: deltaY 1 あたりの、拡縮の指数(ホイール 1 目盛りの 100 で、＋ / − ボタンに近い約 1.22 倍)。M4 で操作感を見て調整しうる
const WHEEL_ZOOM_SENSITIVITY = 0.002;
// deltaMode が行・ページのときの、ピクセルへの換算
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 400;
// 1 回のイベントでの拡縮の比の上限(急な大きな値で、画面が飛ばないように)
const WHEEL_MAX_FACTOR = 2;

/** wheel イベントの deltaY を、ピクセル単位にする(deltaMode: 0 ピクセル、1 行、2 ページ)。 */
function wheelPixels(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * WHEEL_LINE_PX;
  return deltaMode === 2 ? deltaY * WHEEL_PAGE_PX : deltaY;
}

/**
 * Ctrl+ホイールとトラックパッドのピンチ(Chrome では Ctrl つきの wheel)の 1 イベントでの、倍率にかける比。
 * 上に回す(deltaY が負)と拡大、下に回すと縮小。指数で表すので、同じ量の往復で元に戻る。1 回の比は 1/2〜2 に収める。
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const pixels = wheelPixels(deltaY, deltaMode);
  if (!Number.isFinite(pixels)) return 1;
  const factor = Math.exp(-pixels * WHEEL_ZOOM_SENSITIVITY);
  return Math.min(WHEEL_MAX_FACTOR, Math.max(1 / WHEEL_MAX_FACTOR, factor));
}

/** 倍率を、整数に四捨五入したパーセントの文字列にする(例: 0.154 → 15%)。 */
export function formatZoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

/** ズームのモードを遷移させる。操作(set)で manual、「画面に合わせる」と新しい PDF の読み込み(fit)で fit。 */
export function reduceZoom(_state: ZoomState, event: ZoomEvent): ZoomState {
  return event.type === 'fit' ? { mode: 'fit' } : { mode: 'manual', zoom: event.zoom };
}
