import {
  ZOOM_STEP,
  cssScale,
  fitZoom,
  formatZoomPercent,
  reduceZoom,
  resolveZoom,
  type Size,
  type ZoomState,
} from './zoom.ts';

/** 今の倍率の見え方: モード、倍率(画像ピクセル基準。1 が 100%)、CSS の拡大率、表示用の文字列。 */
export interface ZoomView {
  readonly mode: ZoomState['mode'];
  readonly zoom: number;
  readonly cssScale: number;
  readonly label: string;
}

/**
 * プレビューの倍率の状態。画像の大きさ、プレビュー領域の大きさ、画面の密度(devicePixelRatio)と、
 * ズームのモード(画面に合わせる = fit / 固定 = manual)から、今の倍率を求める。
 * 画像や領域が変わっても、fit なら倍率を合わせ直し、manual なら倍率を保つ(範囲の外に出たら丸めて表示する)。
 */
export class ZoomController {
  private state: ZoomState = { mode: 'fit' };
  private image: Size | null = null;
  private viewport: Size = { width: 0, height: 0 };
  private dpr = 1;

  /** 画像の大きさ(表示していないときは null)を設定する。 */
  setImage(image: Size | null): void {
    this.image = image;
  }

  /** プレビュー領域の大きさ(CSS px)を設定する。 */
  setViewport(viewport: Size): void {
    this.viewport = viewport;
  }

  /** 画面の密度(devicePixelRatio)を設定する。 */
  setDevicePixelRatio(dpr: number): void {
    this.dpr = dpr;
  }

  /** 「画面に合わせる」: 全体が領域に収まる倍率に自動で追従するモードにする。 */
  fit(): void {
    this.state = reduceZoom(this.state, { type: 'fit' });
  }

  /** 新しい PDF の読み込み: fit に戻す。 */
  reset(): void {
    this.fit();
  }

  /** 倍率を指定して、固定モードにする(範囲外の値は、表示のときに範囲内に丸める)。画像がないときは何もしない。 */
  zoomTo(zoom: number): void {
    if (Number.isNaN(zoom)) throw new RangeError('倍率が数ではありません');
    if (this.image) this.state = reduceZoom(this.state, { type: 'set', zoom });
  }

  /** ＋(direction = 1)/ −(-1): 今の倍率を 1 段階(ZOOM_STEP 倍)だけ動かして、固定モードにする。範囲は、表示のときに丸める。 */
  step(direction: 1 | -1): void {
    this.zoomBy(direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP);
  }

  /** 今の倍率に比(正の数)をかけて、固定モードにする(ホイール・ピンチ)。範囲外に出た分は溜めず、端の倍率から動く。 */
  zoomBy(factor: number): void {
    if (!(factor > 0)) throw new RangeError(`倍率の比は正の数: ${factor}`);
    const view = this.view();
    if (view) this.zoomTo(view.zoom * factor);
  }

  /** 「100%」: 画像の 1 px が物理画面の 1 px に当たる倍率にして、固定モードにする。 */
  actual(): void {
    this.zoomTo(1);
  }

  /** 今の倍率の見え方。画像がないときは null。 */
  view(): ZoomView | null {
    if (!this.image) return null;
    const zoom = resolveZoom(this.state, this.fitValue());
    return { mode: this.state.mode, zoom, cssScale: cssScale(zoom, this.dpr), label: formatZoomPercent(zoom) };
  }

  /** 全体が領域に収まる倍率(画像があるときだけ呼ぶ)。 */
  private fitValue(): number {
    return fitZoom(this.image as Size, this.viewport, this.dpr);
  }
}
