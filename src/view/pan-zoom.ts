import type { Point } from '../core/zoom.ts';

/** Ctrl+ホイール(トラックパッドのピンチを含む)の通知。pointer は、領域の左上からの位置(CSS px)。 */
export type WheelZoomListener = (deltaY: number, deltaMode: number, pointer: Point) => void;

/** イベントの位置を、領域(area)の左上からの位置(CSS px)にする。 */
function pointerIn(area: HTMLElement, event: MouseEvent): Point {
  const rect = area.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/**
 * Ctrl+ホイールを、拡縮の通知にする(Chrome では、トラックパッドのピンチも、Ctrl つきの wheel として届く)。
 * このときは、ブラウザ自体の拡縮を止める。Ctrl なしの通常のホイールは、そのままスクロールになる。
 */
export function bindWheelZoom(area: HTMLElement, listener: WheelZoomListener): void {
  area.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      listener(event.deltaY, event.deltaMode, pointerIn(area, event));
    },
    { passive: false },
  );
}

/** ドラッグの開始時の、ポインタの位置とスクロール位置。 */
interface DragOrigin {
  readonly pointer: Point;
  readonly scroll: Point;
}

/** 領域をドラッグして、スクロールする(移動)。スクロールバーの上から始めたドラッグは、バーの操作に任せる。 */
class DragPan {
  private origin: DragOrigin | null = null;
  private readonly area: HTMLElement;

  /** 対象の領域から作る。 */
  constructor(area: HTMLElement) {
    this.area = area;
  }

  /** ポインタのイベントを結びつける。 */
  bind(): void {
    this.area.addEventListener('pointerdown', (event) => this.begin(event));
    this.area.addEventListener('pointermove', (event) => this.move(event));
    this.area.addEventListener('pointerup', (event) => this.end(event));
    this.area.addEventListener('pointercancel', (event) => this.end(event));
  }

  /** 主ボタンで(スクロールバー以外を)押したら、ドラッグを始める。 */
  private begin(event: PointerEvent): void {
    const { x, y } = pointerIn(this.area, event);
    if (event.button !== 0 || x >= this.area.clientWidth || y >= this.area.clientHeight) return;
    this.area.setPointerCapture(event.pointerId);
    this.origin = { pointer: { x: event.clientX, y: event.clientY }, scroll: { x: this.area.scrollLeft, y: this.area.scrollTop } };
    this.area.classList.add('panning');
  }

  /** ドラッグ中は、動かした分だけ逆向きにスクロールする(つかんだ点が、ポインタについてくる)。 */
  private move(event: PointerEvent): void {
    if (!this.origin) return;
    this.area.scrollLeft = this.origin.scroll.x - (event.clientX - this.origin.pointer.x);
    this.area.scrollTop = this.origin.scroll.y - (event.clientY - this.origin.pointer.y);
  }

  /** ボタンを離す、またはキャンセルされたら、ドラッグを終える。 */
  private end(event: PointerEvent): void {
    if (!this.origin) return;
    this.origin = null;
    this.area.releasePointerCapture(event.pointerId);
    this.area.classList.remove('panning');
  }
}

/** 領域をドラッグして移動できるようにする。 */
export function bindDragPan(area: HTMLElement): void {
  new DragPan(area).bind();
}
