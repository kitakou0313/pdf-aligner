import type { PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { renderThumbnailPage } from '../../../src/pdf/thumbnail-render.ts';

const A4 = { width: 595, height: 842 };

/** 偽物の描画タスク。promise の完了は渡した Promise で決め、cancel の呼び出しを記録する。 */
interface FakeTask {
  readonly promise: Promise<void>;
  readonly cancel: Mock;
}

/** 偽物のページ: 倍率 1 の表示領域は A4。render は、渡された描画タスクを返す。 */
interface FakePage {
  readonly getViewport: Mock;
  readonly render: Mock;
  readonly cleanup: Mock;
}

/** 偽物のページを作る(倍率をかけた表示領域を返す)。 */
function fakePage(task: FakeTask): FakePage {
  const getViewport = vi.fn(({ scale }: { scale: number }) => ({ width: A4.width * scale, height: A4.height * scale }));
  return { getViewport, render: vi.fn(() => task), cleanup: vi.fn() };
}

/** 偽物の canvas(幅・高さだけを持つ)。 */
function fakeCanvas(): { width: number; height: number } {
  return { width: 0, height: 0 };
}

/** 偽物の文書(getPage が偽物のページを返す)。 */
function fakeDoc(page: FakePage): { doc: PDFDocumentProxy; getPage: Mock } {
  const getPage = vi.fn(async () => page);
  return { doc: { getPage } as unknown as PDFDocumentProxy, getPage };
}

/** 中断されていない AbortSignal。 */
function freshSignal(): AbortSignal {
  return new AbortController().signal;
}

describe('renderThumbnailPage(1 ページを、指定した幅に収まるサムネイルとして canvas に描く。F11)', () => {
  it('ページの縦横比を保った倍率で、canvas の大きさを決めて描く', async () => {
    const task: FakeTask = { promise: Promise.resolve(), cancel: vi.fn() };
    const page = fakePage(task);
    const { doc } = fakeDoc(page);
    const canvas = fakeCanvas();
    await renderThumbnailPage(doc, 3, 100, canvas as unknown as HTMLCanvasElement, freshSignal());
    expect(canvas).toEqual({ width: 100, height: 142 }); // 100 * 842/595 ≈ 141.5 → 142
    const params = page.render.mock.calls[0]?.[0];
    expect(params.canvas).toBe(canvas);
    expect(params.viewport.width).toBeCloseTo(100, 9);
    expect(params.viewport.height).toBeCloseTo((100 * A4.height) / A4.width, 9);
  });

  it('ページ番号をそのまま pdf.js に渡す(呼び出し側が 1 始まりに揃える)', async () => {
    const task: FakeTask = { promise: Promise.resolve(), cancel: vi.fn() };
    const page = fakePage(task);
    const { doc, getPage } = fakeDoc(page);
    await renderThumbnailPage(doc, 5, 100, fakeCanvas() as unknown as HTMLCanvasElement, freshSignal());
    expect(getPage).toHaveBeenCalledWith(5);
  });

  it('描き終えたページは cleanup する', async () => {
    const task: FakeTask = { promise: Promise.resolve(), cancel: vi.fn() };
    const page = fakePage(task);
    const { doc } = fakeDoc(page);
    await renderThumbnailPage(doc, 1, 100, fakeCanvas() as unknown as HTMLCanvasElement, freshSignal());
    expect(page.cleanup).toHaveBeenCalledOnce();
  });

  it('描画に失敗しても、cleanup はして、例外をそのまま投げる', async () => {
    const task: FakeTask = { promise: Promise.reject(new Error('render broke')), cancel: vi.fn() };
    const page = fakePage(task);
    const { doc } = fakeDoc(page);
    await expect(renderThumbnailPage(doc, 1, 100, fakeCanvas() as unknown as HTMLCanvasElement, freshSignal())).rejects.toThrow('render broke');
    expect(page.cleanup).toHaveBeenCalledOnce();
  });

  it('すでに中断されているなら、pdf.js に何も頼まない', async () => {
    const controller = new AbortController();
    controller.abort();
    const { doc, getPage } = fakeDoc(fakePage({ promise: Promise.resolve(), cancel: vi.fn() }));
    await expect(renderThumbnailPage(doc, 1, 100, fakeCanvas() as unknown as HTMLCanvasElement, controller.signal)).rejects.toThrow();
    expect(getPage).not.toHaveBeenCalled();
  });

  it('描画中に中断されたら、pdf.js の描画を取り消す', async () => {
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((_res, rej) => (reject = rej));
    const cancel = vi.fn(() => reject(new Error('RenderingCancelled')));
    const page = fakePage({ promise, cancel });
    const { doc } = fakeDoc(page);
    const controller = new AbortController();
    const running = renderThumbnailPage(doc, 1, 100, fakeCanvas() as unknown as HTMLCanvasElement, controller.signal);
    await vi.waitFor(() => expect(page.render).toHaveBeenCalled());
    controller.abort();
    await expect(running).rejects.toThrow('RenderingCancelled');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
