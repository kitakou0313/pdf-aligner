import type { PageSize } from '../core/layout.ts';
import { ThumbnailController, type ThumbnailControllerDeps } from '../core/thumbnail-controller.ts';
import { THUMBNAIL_WIDTH, computeThumbnailHeight } from '../core/thumbnail-layout.ts';
import type { ThumbnailStatus } from '../core/thumbnail-state.ts';
import { requireElement } from './dom.ts';

/** 1 ページを canvas に描く関数(元PDFプレビューの外、pdf.js 側から渡す)。 */
export type ThumbnailRenderer = (index: number, canvas: HTMLCanvasElement, signal: AbortSignal) => Promise<void>;

/** 元PDFプレビュー(F11)の更新口。 */
export interface ThumbnailSidebar {
  /** 新しい文書に差し替える(プレースホルダーを作り直す)。ページ数が 0 なら空にする。 */
  setDocument(pageCount: number, pageSizeOf: (index: number) => PageSize, render: ThumbnailRenderer): void;
  /** 文書を閉じる(観測と進行中の描画をやめ、空にする)。 */
  clear(): void;
  /** 表示・非表示を切り替える(F11: 「読み込み中」の間だけ非表示)。 */
  setVisible(visible: boolean): void;
  /** 見えている範囲に、まだ生成していないページがないか(出力の描画の優先。F7 が使う)。 */
  isSettled(): boolean;
  /** isSettled() が変わるたびに呼ばれる。返り値で購読解除できる。 */
  onSettledChange(listener: (settled: boolean) => void): () => void;
}

/** 1 ページ分のセル: プレースホルダーの div と、描画されたら入る canvas(破棄されたら null に戻す)。 */
interface Cell {
  readonly element: HTMLDivElement;
  canvas: HTMLCanvasElement | null;
}

/** 元PDFプレビューの DOM 要素と、可視化に応じたサムネイルの表示・破棄。 */
class ThumbnailSidebarView implements ThumbnailSidebar {
  private readonly container: HTMLElement;
  private readonly observer: IntersectionObserver;
  private readonly controller: ThumbnailController;
  private readonly indexOf = new Map<Element, number>();
  private readonly settledListeners = new Set<(settled: boolean) => void>();
  private cells: Cell[] = [];
  /** controller.isSettled() の、直近の値(通知のたびに更新する)。 */
  private controllerSettled = true;
  /** 今の可視範囲を、まだ 1 度も観測できていない間は true(IntersectionObserver の初回通知は非同期なため。判明するまでは、安全側に倒して settled としない)。 */
  private settledKnown = true;
  /** 文書がないときの render(setDocument より前は、何もしない)。 */
  private render: ThumbnailRenderer = () => Promise.resolve();

  /** root の中の要素を取り出し、可視化の監視と、状態機械(controller)を組み立てる。controller 側の settled も併せて購読する。 */
  constructor(root: ParentNode) {
    this.container = requireElement(root, '#thumbnails');
    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), { root: this.container });
    this.controller = new ThumbnailController(this.controllerDeps());
    this.controller.onSettledChange((settled) => this.onControllerSettledChange(settled));
  }

  /** 新しい文書に差し替える。古い内容を片付けてから、ページ数ぶんのプレースホルダーを作る。 */
  setDocument(pageCount: number, pageSizeOf: (index: number) => PageSize, render: ThumbnailRenderer): void {
    this.clear();
    this.render = render;
    this.controller.reset(pageCount);
    this.cells = Array.from({ length: pageCount }, (_, index) => this.buildCell(index, pageSizeOf(index)));
    this.markSettledUnknown();
  }

  /** 観測をやめ、進行中の描画を中断し、中身を空にする(文書がなくなるので、見えている範囲は settled として扱う)。 */
  clear(): void {
    this.observer.disconnect();
    this.settledKnown = true;
    this.controller.reset(0);
    /** 文書がない間の render(呼ばれるはずがないが、型のために用意する)。 */
    this.render = () => Promise.resolve();
    this.container.replaceChildren();
    this.indexOf.clear();
    this.cells = [];
  }

  /**
   * 表示・非表示を切り替える。非表示の間は要素に大きさがなく、可視化を検知できないため、
   * 表示に変えたときは、観測を登録し直して、今見えている範囲を検知させる。
   */
  setVisible(visible: boolean): void {
    const shown = visible && this.container.hidden;
    this.container.hidden = !visible;
    if (shown) this.reobserve();
  }

  /** 全セルの観測を、登録し直す(disconnect してから observe すると、初回の通知が保証される)。見えている範囲は、また不明に戻る。 */
  private reobserve(): void {
    this.observer.disconnect();
    for (const cell of this.cells) this.observer.observe(cell.element);
    this.markSettledUnknown();
  }

  /** 見えている範囲を「不明」に戻す(判明するまで isSettled() は false)。 */
  private markSettledUnknown(): void {
    const before = this.isSettled();
    this.settledKnown = false;
    this.notifySettled(before);
  }

  /** 最初の IntersectionObserver の通知が来たら、見えている範囲が判明したとみなす。 */
  private markSettledKnown(): void {
    if (this.settledKnown) return;
    const before = this.isSettled();
    this.settledKnown = true;
    this.notifySettled(before);
  }

  /** 見えている範囲が判明していて、かつ生成中のページが 1 つもないか。 */
  isSettled(): boolean {
    return this.settledKnown && this.controllerSettled;
  }

  /** isSettled() の値が変わるたびに呼ぶ。返り値を呼ぶと購読を解除する。 */
  onSettledChange(listener: (settled: boolean) => void): () => void {
    this.settledListeners.add(listener);
    return () => void this.settledListeners.delete(listener);
  }

  /** settled が、呼び出し前(before)から変わっていたら、購読者に知らせる。 */
  private notifySettled(before: boolean): void {
    const after = this.isSettled();
    if (after === before) return;
    for (const listener of [...this.settledListeners]) listener(after);
  }

  /** controller(1 ページずつの状態機械)側の settled が変わった。 */
  private onControllerSettledChange(settled: boolean): void {
    const before = this.isSettled();
    this.controllerSettled = settled;
    this.notifySettled(before);
  }

  /** コントローラが頼る外部(描画と、状態変化の反映)。 */
  private controllerDeps(): ThumbnailControllerDeps {
    return {
      /** index 番目のセルを描く。 */
      render: (index, signal) => this.renderCell(index, signal),
      /** index 番目のセルの状態が変わった。 */
      onChange: (index, status) => this.applyStatus(index, status),
    };
  }

  /** index 番目のセルへ、canvas を用意して描く(なければ作る。再試行なら作り直したもの)。 */
  private renderCell(index: number, signal: AbortSignal): Promise<void> {
    const cell = this.cells[index] as Cell;
    const canvas = (cell.canvas ??= document.createElement('canvas'));
    return this.render(index, canvas, signal);
  }

  /** 状態に応じて、セルの見た目(canvas の表示、失敗マーク)を更新する。 */
  private applyStatus(index: number, status: ThumbnailStatus): void {
    const cell = this.cells[index] as Cell;
    cell.element.dataset.status = status;
    cell.element.classList.toggle('thumb--failed', status === 'failed');
    if (status === 'rendered' && cell.canvas) cell.element.appendChild(cell.canvas);
    else this.detachCanvas(cell);
    if (status === 'pending') cell.canvas = null;
  }

  /** セルから canvas を外し、メモリを手放す(仮想化による破棄。Q7)。繋がっていなければ何もしない。 */
  private detachCanvas(cell: Cell): void {
    if (!cell.canvas?.isConnected) return;
    [cell.canvas.width, cell.canvas.height] = [0, 0];
    cell.element.removeChild(cell.canvas);
  }

  /** 可視化・不可視化の変化を、コントローラへ伝える。届いたら、見えている範囲が判明したとみなす。 */
  private onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const index = this.indexOf.get(entry.target);
      if (index === undefined) continue;
      if (entry.isIntersecting) this.controller.visible(index);
      else this.controller.invisible(index);
    }
    this.markSettledKnown();
  }

  /** 1 ページ分のプレースホルダー(固定幅、縦横比どおりの高さ、ページ番号のラベル)を作って、監視を始める。 */
  private buildCell(index: number, pageSize: PageSize): Cell {
    const element = document.createElement('div');
    element.className = 'thumb';
    element.dataset.status = 'pending';
    element.style.width = `${THUMBNAIL_WIDTH}px`;
    element.style.height = `${computeThumbnailHeight(pageSize, THUMBNAIL_WIDTH)}px`;
    element.appendChild(this.buildLabel(index));
    this.container.appendChild(element);
    this.indexOf.set(element, index);
    this.observer.observe(element);
    return { element, canvas: null };
  }

  /** ページ番号(1 始まり)のラベルを作る。 */
  private buildLabel(index: number): HTMLElement {
    const label = document.createElement('span');
    label.className = 'thumb-number';
    label.textContent = String(index + 1);
    return label;
  }
}

/** 元PDFプレビューを、index.html の要素に結びつけて、更新口を返す。 */
export function createThumbnailSidebar(root: ParentNode): ThumbnailSidebar {
  return new ThumbnailSidebarView(root);
}
