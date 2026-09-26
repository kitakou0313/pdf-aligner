import type { Layout } from '../core/layout.ts';
import { BACKGROUND_COLOR } from '../core/limits.ts';
import type { Point, Size } from '../core/zoom.ts';
import { requireElement } from './dom.ts';
import { bindDragPan, bindWheelZoom, type WheelZoomListener } from './pan-zoom.ts';

/** プレビュー領域の更新口。出力画像(canvas)は、プレビューとダウンロードで同じ 1 枚を使う。 */
export interface Preview {
  readonly canvas: HTMLCanvasElement;
  /** 最終の出力画像の 2D コンテキスト(描き終えたページが、ここへ転送される)。 */
  context(): CanvasRenderingContext2D;
  /** 出力画像の大きさを、レイアウトに合わせ、背景で塗って、表示する(以前の内容は消える)。 */
  prepare(layout: Layout): void;
  /** 画像を表示する(false のときは、ドロップの案内を表示し、画像のメモリを手放す)。 */
  showImage(visible: boolean): void;
  /** 画像の大きさ(px)。表示していないときは null。 */
  imageSize(): Size | null;
  /** 見た目の拡大率(CSS の scale)を変える。画素には手を加えない。 */
  setScale(cssScale: number): void;
  /** スクロール領域の、見えている大きさ(CSS px)。 */
  viewportSize(): Size;
  /** 今のスクロール位置(CSS px)。 */
  scrollPosition(): Point;
  /** スクロール位置を設定する(動ける範囲に、ブラウザが収める)。 */
  scrollTo(position: Point): void;
  /** スクロール領域の大きさが変わったときに呼ばれる関数を登録する。 */
  onViewportChange(listener: () => void): void;
  /** Ctrl+ホイール(ピンチを含む)のときに呼ばれる関数を登録する。 */
  onWheelZoom(listener: WheelZoomListener): void;
}

/** プレビュー領域の DOM 要素と、その表示の更新。 */
class PreviewView implements Preview {
  readonly canvas: HTMLCanvasElement;
  private readonly area: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly placeholder: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D;
  private image: Size | null = null;
  private appliedScale = '';

  /** root の中の要素を取り出し、不透明な 2D コンテキストを用意して、ドラッグでの移動を結びつける。 */
  constructor(root: ParentNode) {
    this.area = requireElement(root, '#preview');
    this.stage = requireElement(root, '#stage');
    this.placeholder = requireElement(root, '#placeholder');
    this.canvas = requireElement(root, '#canvas');
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('canvas の 2D コンテキストを取得できません');
    this.ctx = ctx;
    bindDragPan(this.area);
  }

  /** 最終の出力画像の 2D コンテキスト。 */
  context(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /** 出力画像の大きさを合わせて、背景で塗り、表示する。 */
  prepare(layout: Layout): void {
    this.canvas.width = layout.width;
    this.canvas.height = layout.height;
    this.ctx.fillStyle = BACKGROUND_COLOR;
    this.ctx.fillRect(0, 0, layout.width, layout.height);
    this.image = { width: layout.width, height: layout.height };
    this.appliedScale = '';
    this.showImage(true);
  }

  /** 画像かドロップの案内のどちらかを表示する。画像を隠すときは、canvas を縮めてメモリを手放す。 */
  showImage(visible: boolean): void {
    this.stage.hidden = !visible;
    this.placeholder.hidden = visible;
    if (visible) return;
    [this.canvas.width, this.canvas.height, this.image, this.appliedScale] = [0, 0, null, ''];
  }

  /** 画像の大きさ(px)。 */
  imageSize(): Size | null {
    return this.image;
  }

  /** 画像の見た目の大きさを、拡大率に合わせる(領域の大きさと、CSS の scale)。同じ設定の繰り返しは省く。 */
  setScale(cssScale: number): void {
    const key = `${this.image?.width}x${this.image?.height}@${cssScale}`;
    if (!this.image || key === this.appliedScale) return;
    this.appliedScale = key;
    this.stage.style.width = `${this.image.width * cssScale}px`;
    this.stage.style.height = `${this.image.height * cssScale}px`;
    this.canvas.style.transform = `scale(${cssScale})`;
  }

  /** スクロール領域の、見えている大きさ。 */
  viewportSize(): Size {
    return { width: this.area.clientWidth, height: this.area.clientHeight };
  }

  /** 今のスクロール位置。 */
  scrollPosition(): Point {
    return { x: this.area.scrollLeft, y: this.area.scrollTop };
  }

  /** スクロール位置を設定する。 */
  scrollTo(position: Point): void {
    this.area.scrollTo(position.x, position.y);
  }

  /** スクロール領域の大きさの変化を監視する。 */
  onViewportChange(listener: () => void): void {
    new ResizeObserver(() => listener()).observe(this.area);
  }

  /** Ctrl+ホイールを、拡縮の通知にする。 */
  onWheelZoom(listener: WheelZoomListener): void {
    bindWheelZoom(this.area, listener);
  }
}

/** プレビュー領域を、index.html の要素に結びつけて、更新口を返す。 */
export function createPreview(root: ParentNode): Preview {
  return new PreviewView(root);
}
