import type { PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { Placement } from '../../../src/core/layout.ts';
import { createPageSource, pageTransform, type RenderSurface } from '../../../src/pdf/source.ts';

const A4 = { width: 595, height: 842 };
const PLACEMENT: Placement = { index: 0, x: 32, y: 48, width: 1190, height: 1684 };

/** 外から解決・拒否できる Promise。 */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (reason: unknown) => void } {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 偽物の描画タスク(pdf.js の RenderTask)。promise の完了は渡した Promise で決め、cancel の呼び出しを記録する。 */
interface FakeTask {
  readonly promise: Promise<void>;
  readonly cancel: Mock;
}

/** 偽物のページ: 倍率 1 の表示領域は A4。render は、渡された描画タスクを返す。 */
interface FakePage {
  readonly getViewport: (params: { scale: number }) => { width: number; height: number };
  readonly render: Mock;
  readonly cleanup: Mock;
}

/** テストが観察する対象: 供給元と、偽物の pdf.js・canvas の記録。 */
interface Harness {
  readonly source: ReturnType<typeof createPageSource>;
  readonly finalCtx: { drawImage: Mock };
  readonly scratch: { width: number; height: number };
  readonly page: FakePage;
  readonly getPage: Mock;
  readonly task: FakeTask;
  readonly created: unknown[];
}

/** 倍率 scale で見た A4 の表示領域。 */
function a4Viewport({ scale }: { scale: number }): { width: number; height: number } {
  return { width: A4.width * scale, height: A4.height * scale };
}

/** 偽物のページを作る。 */
function fakePage(task: FakeTask): FakePage {
  return { getViewport: a4Viewport, render: vi.fn(() => task), cleanup: vi.fn() };
}

/** 偽物の作業用 canvas と、その作成の記録を作る(何回作られたかを数えるため)。 */
function fakeScratch(): { scratch: Harness['scratch']; created: unknown[]; make: () => HTMLCanvasElement } {
  const scratch = { width: 0, height: 0 };
  const created: unknown[] = [];
  /** 作業用 canvas を「作った」ことを記録して、同じ偽物を返す。 */
  const make = (): HTMLCanvasElement => (created.push(scratch), scratch as unknown as HTMLCanvasElement);
  return { scratch, created, make };
}

/** 偽物の 2D コンテキストを、最終の出力先として返す出力先にする。 */
function surfaceOf(ctx: { drawImage: Mock }): RenderSurface {
  return {
    /** 偽物のコンテキストを返す。 */
    context: () => ctx as unknown as CanvasRenderingContext2D,
  };
}

/** 偽物の pdf.js(文書、ページ、描画タスク)と、偽物の canvas を組み立てる。task の完了は、渡した Promise で決める。 */
function harness(taskPromise: Promise<void> = Promise.resolve(), pageCount = 3, unreadable: readonly number[] = []): Harness {
  const task: FakeTask = { promise: taskPromise, cancel: vi.fn() };
  const page = fakePage(task);
  const getPage = vi.fn(async () => page);
  const finalCtx = { drawImage: vi.fn() };
  const surface = surfaceOf(finalCtx);
  const { scratch, created, make } = fakeScratch();
  const sizes = { sizes: Array(pageCount).fill(A4), readable: Array.from({ length: pageCount }, (_, i) => !unreadable.includes(i)) };
  const source = createPageSource({ getPage } as unknown as PDFDocumentProxy, sizes, surface, make);
  return { source, finalCtx, scratch, page, getPage, task, created };
}

/** 中断されていない AbortSignal。 */
function freshSignal(): AbortSignal {
  return new AbortController().signal;
}

describe('pageTransform(ページを、配置の矩形にちょうど収める拡大)', () => {
  it('配置の大きさ ÷ 倍率 1 のページの大きさ を、横と縦の拡大率にする(平行移動はしない)', () => {
    expect(pageTransform(A4, PLACEMENT)).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('配置の大きさは整数に丸められているので、横と縦の拡大率は少しだけ違ってよい(矩形にちょうど収める)', () => {
    const [sx, , , sy] = pageTransform({ width: 595.28, height: 841.89 }, { ...PLACEMENT, width: 1191, height: 1684 });
    expect(sx).toBeCloseTo(1191 / 595.28, 12);
    expect(sy).toBeCloseTo(1684 / 841.89, 12);
  });
});

describe('createPageSource', () => {
  it('ページ数と、各ページの大きさを、渡された値のとおりに返す', () => {
    const { source } = harness(undefined, 5);
    expect(source.pageCount).toBe(5);
    expect(source.pageSize(4)).toEqual(A4);
  });

  it('大きさが読めたかどうかを、渡された値のとおりに返す(読めなかったページの大きさは、渡された代わりの大きさ)', () => {
    const { source } = harness(undefined, 4, [1, 3]);
    expect([0, 1, 2, 3].map((index) => source.isReadable(index))).toEqual([true, false, true, false]);
    expect(source.pageSize(1)).toEqual(A4);
  });

  it('作業用の canvas を配置の大きさにして、そこに(倍率 1 の表示領域と、矩形に収める変換で)描き、終わったら最終の canvas の配置の位置へ等倍で転送する', async () => {
    const h = harness();
    await h.source.renderPage(0, PLACEMENT, freshSignal());
    expect(h.getPage).toHaveBeenCalledWith(1);
    expect(h.scratch).toEqual({ width: 1190, height: 1684 });
    const params = h.page.render.mock.calls[0]?.[0];
    expect(params.canvas).toBe(h.scratch);
    expect(params.viewport).toEqual({ width: 595, height: 842 });
    expect(params.transform).toEqual([2, 0, 0, 2, 0, 0]);
    expect(h.finalCtx.drawImage).toHaveBeenCalledExactlyOnceWith(h.scratch, 0, 0, 1190, 1684, 32, 48, 1190, 1684);
  });

  it('ページ番号は 1 始まりで pdf.js に渡す', async () => {
    const h = harness();
    await h.source.renderPage(2, { ...PLACEMENT, index: 2 }, freshSignal());
    expect(h.getPage).toHaveBeenCalledWith(3);
  });

  it('描き終えたページは cleanup する', async () => {
    const h = harness();
    await h.source.renderPage(0, PLACEMENT, freshSignal());
    expect(h.page.cleanup).toHaveBeenCalledOnce();
  });

  it('作業用の canvas は、全ページで 1 つを使い回す', async () => {
    const h = harness();
    await h.source.renderPage(0, PLACEMENT, freshSignal());
    await h.source.renderPage(1, { ...PLACEMENT, index: 1, width: 800, height: 600 }, freshSignal());
    expect(h.created).toHaveLength(1);
    expect(h.scratch).toEqual({ width: 800, height: 600 });
  });

  it('release すると、作業用の canvas を 0 × 0 に縮めて、メモリを手放す(作っていなければ何もしない)', async () => {
    const h = harness();
    h.source.release();
    expect(h.created).toHaveLength(0);
    await h.source.renderPage(0, PLACEMENT, freshSignal());
    h.source.release();
    expect(h.scratch).toEqual({ width: 0, height: 0 });
  });

  it('描画に失敗したら、最終の canvas には何も転送せず(セルは背景のまま)、例外をそのまま投げ、cleanup はする', async () => {
    const h = harness(Promise.reject(new Error('render broke')));
    await expect(h.source.renderPage(0, PLACEMENT, freshSignal())).rejects.toThrow('render broke');
    expect(h.finalCtx.drawImage).not.toHaveBeenCalled();
    expect(h.page.cleanup).toHaveBeenCalledOnce();
  });

  it('ページを取得できなかったら、例外を投げる(呼び出し側が失敗したページとして記録する)', async () => {
    const h = harness();
    h.getPage.mockRejectedValueOnce(new Error('no such page'));
    await expect(h.source.renderPage(0, PLACEMENT, freshSignal())).rejects.toThrow('no such page');
    expect(h.finalCtx.drawImage).not.toHaveBeenCalled();
  });
});

describe('createPageSource: 中断', () => {
  it('すでに中断されているなら、pdf.js に何も頼まずに、中断の例外を投げる', async () => {
    const h = harness();
    const controller = new AbortController();
    controller.abort();
    await expect(h.source.renderPage(0, PLACEMENT, controller.signal)).rejects.toThrow();
    expect(h.getPage).not.toHaveBeenCalled();
  });

  it('ページの取得の間に中断されたら、描画を始めない', async () => {
    const h = harness();
    const controller = new AbortController();
    h.getPage.mockImplementationOnce(async () => {
      controller.abort();
      return h.page;
    });
    await expect(h.source.renderPage(0, PLACEMENT, controller.signal)).rejects.toThrow();
    expect(h.page.render).not.toHaveBeenCalled();
    expect(h.page.cleanup).toHaveBeenCalledOnce();
  });

  it('描画中に中断されたら、pdf.js の描画を取り消し、最終の canvas には何も転送しない', async () => {
    const pending = deferred();
    const h = harness(pending.promise);
    const controller = new AbortController();
    const running = h.source.renderPage(0, PLACEMENT, controller.signal);
    await vi.waitFor(() => expect(h.page.render).toHaveBeenCalled());
    h.task.cancel.mockImplementation(() => pending.reject(new Error('RenderingCancelled')));
    controller.abort();
    await expect(running).rejects.toThrow('RenderingCancelled');
    expect(h.task.cancel).toHaveBeenCalledOnce();
    expect(h.finalCtx.drawImage).not.toHaveBeenCalled();
    expect(h.page.cleanup).toHaveBeenCalledOnce();
  });

  it('描画が終わった後に中断されても、取り消しは呼ばれない(中断の監視は、描画の終わりで外す)', async () => {
    const h = harness();
    const controller = new AbortController();
    await h.source.renderPage(0, PLACEMENT, controller.signal);
    controller.abort();
    expect(h.task.cancel).not.toHaveBeenCalled();
  });
});
