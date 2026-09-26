import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import type { PageSource } from '../core/compose.ts';
import type { PageSize, Placement } from '../core/layout.ts';

/** 最終の出力画像(canvas)を提供するもの。描き終えたページは、ここの 2D コンテキストへ転送される。 */
export interface RenderSurface {
  context(): CanvasRenderingContext2D;
}

/** pdf.js のページの供給元。作業用の canvas を手放すための release を持つ。 */
export interface PdfPageSource extends PageSource {
  release(): void;
}

type Matrix = [number, number, number, number, number, number];

/** ページを配置の矩形にちょうど収める拡大(横と縦。配置は整数に丸められているので、少し異なりうる)。平行移動はしない。 */
export function pageTransform(size: PageSize, placement: Placement): Matrix {
  return [placement.width / size.width, 0, 0, placement.height / size.height, 0, 0];
}

/** 作業用の canvas を、配置の大きさにする(同じ大きさなら何もしない。大きさの設定は、内容を消して再確保するため)。 */
function fitCanvas(canvas: HTMLCanvasElement, placement: Placement): void {
  if (canvas.width !== placement.width) canvas.width = placement.width;
  if (canvas.height !== placement.height) canvas.height = placement.height;
}

/** pdf.js の描画が終わるまで待つ。その間に中断されたら、描画を取り消す(待ちは、取り消しの例外で終わる)。 */
async function untilDone(task: RenderTask, signal: AbortSignal): Promise<void> {
  /** 中断されたら、pdf.js の描画を取り消す。 */
  const cancel = (): void => task.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await task.promise;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

/** ページを、作業用の canvas に、倍率 1 の表示領域と配置に収める変換で描く(背景は pdf.js が白で塗る)。 */
async function paintPage(page: PDFPageProxy, placement: Placement, scratch: HTMLCanvasElement, signal: AbortSignal): Promise<void> {
  const viewport = page.getViewport({ scale: 1 });
  fitCanvas(scratch, placement);
  const task = page.render({ canvas: scratch, viewport, transform: pageTransform(viewport, placement) });
  await untilDone(task, signal);
}

/** 描き終えた作業用の canvas を、最終の canvas の配置の位置へ、等倍で転送する。 */
function transfer(target: CanvasRenderingContext2D, scratch: HTMLCanvasElement, at: Placement): void {
  target.drawImage(scratch, 0, 0, at.width, at.height, at.x, at.y, at.width, at.height);
}

/** 画面に載せない、作業用の canvas を作る。 */
function createScratchCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}

/**
 * pdf.js の文書から、ページの供給元を作る。1 ページずつ、使い回す 1 枚の作業用 canvas に描き、
 * 描き終えたページだけを最終の canvas へ転送する。最終の canvas に直接描くと、pdf.js は
 * ブレンドモードのあるページで、描画先と同じ大きさの canvas を確保して全面に重ねてしまうため。
 * 転送するのは成功したページだけなので、失敗や中断は、最終の画像に何も残さない。
 */
export function createPageSource(
  doc: PDFDocumentProxy,
  sizes: readonly PageSize[],
  surface: RenderSurface,
  makeScratch: () => HTMLCanvasElement = createScratchCanvas,
): PdfPageSource {
  return new DocumentPageSource(doc, sizes, surface, makeScratch);
}

/** pdf.js の文書を、ページの供給元として使えるようにする実装。作業用の canvas は、最初に必要になったときに作る。 */
class DocumentPageSource implements PdfPageSource {
  readonly pageCount: number;
  private scratch: HTMLCanvasElement | null = null;
  private readonly doc: PDFDocumentProxy;
  private readonly sizes: readonly PageSize[];
  private readonly surface: RenderSurface;
  private readonly makeScratch: () => HTMLCanvasElement;

  /** 文書、各ページの大きさ、最終の出力先、作業用の canvas の作り方から作る。 */
  constructor(doc: PDFDocumentProxy, sizes: readonly PageSize[], surface: RenderSurface, makeScratch: () => HTMLCanvasElement) {
    [this.doc, this.sizes, this.surface, this.makeScratch] = [doc, sizes, surface, makeScratch];
    this.pageCount = sizes.length;
  }

  /** n ページ目の大きさ(pt)。 */
  pageSize(index: number): PageSize {
    return this.sizes[index] as PageSize;
  }

  /** n ページ目(0 始まり)を描いて、最終の canvas へ転送する。中断されていたら、その時点で中断の例外を投げる。 */
  async renderPage(index: number, placement: Placement, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const page = await this.doc.getPage(index + 1);
    try {
      signal.throwIfAborted();
      const scratch = (this.scratch ??= this.makeScratch());
      await paintPage(page, placement, scratch, signal);
      transfer(this.surface.context(), scratch, placement);
    } finally {
      page.cleanup();
    }
  }

  /** 作業用の canvas を 0 × 0 に縮めて、メモリを手放す(作っていなければ何もしない)。 */
  release(): void {
    if (this.scratch) [this.scratch.width, this.scratch.height] = [0, 0];
  }
}
