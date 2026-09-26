import type { PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it, vi } from 'vitest';
import { FALLBACK_PAGE_SIZE, readPageSizes } from '../../../src/pdf/page-sizes.ts';

interface FakePage {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  cleanup: () => void;
}

/** 指定した大きさ(scale に比例する)のページの偽物。 */
function pageOf(width: number, height: number): FakePage {
  return {
    /** 倍率に比例した表示領域を返す。 */
    getViewport: ({ scale }) => ({ width: width * scale, height: height * scale }),
    cleanup: vi.fn(),
  };
}

/** n ページ目(1 始まり)を返す関数から、文書の偽物を作る。 */
function docOf(getPage: (pageNumber: number) => Promise<FakePage>, numPages: number): PDFDocumentProxy {
  return { numPages, getPage: vi.fn(getPage) } as unknown as PDFDocumentProxy;
}

describe('readPageSizes(全ページの大きさ(pt。回転と表示範囲を反映)を、倍率 1 の表示領域から読む)', () => {
  it('各ページの幅と高さを、ページ順に返す', async () => {
    const pages = [pageOf(595, 842), pageOf(842, 595), pageOf(842, 1191)];
    const doc = docOf(async (n) => pages[n - 1] as FakePage, 3);
    expect(await readPageSizes(doc)).toEqual([
      { width: 595, height: 842 },
      { width: 842, height: 595 },
      { width: 842, height: 1191 },
    ]);
  });

  it('倍率 1 の表示領域を使う(pdf.js の getViewport は、回転と表示範囲を反映する)', async () => {
    const page = pageOf(100, 200);
    const spy = vi.spyOn(page, 'getViewport');
    await readPageSizes(docOf(async () => page, 1));
    expect(spy).toHaveBeenCalledWith({ scale: 1 });
  });

  it('読み終えたページは cleanup して、メモリを持ち続けない', async () => {
    const pages = [pageOf(10, 10), pageOf(10, 10)];
    await readPageSizes(docOf(async (n) => pages[n - 1] as FakePage, 2));
    for (const page of pages) expect(page.cleanup).toHaveBeenCalledOnce();
  });

  it('ページを取得できなかったときは、そのページだけ、最初に読めたページの大きさにする(他のページのセルの大きさに影響しない)', async () => {
    const dims: Record<number, [number, number]> = { 1: [300, 400], 3: [500, 100] };
    const doc = docOf(async (n) => (n === 2 ? Promise.reject(new Error('broken page')) : pageOf(...(dims[n] as [number, number]))), 3);
    const sizes = await readPageSizes(doc);
    expect(sizes).toEqual([{ width: 300, height: 400 }, { width: 300, height: 400 }, { width: 500, height: 100 }]);
  });

  it('先頭のページが取得できないときも、後ろで最初に読めたページの大きさにする', async () => {
    const doc = docOf(async (n) => (n === 1 ? Promise.reject(new Error('broken page')) : pageOf(200, 300)), 3);
    expect(await readPageSizes(doc)).toEqual([{ width: 200, height: 300 }, { width: 200, height: 300 }, { width: 200, height: 300 }]);
  });

  it('全てのページの大きさが読めないときだけ、代替の大きさ(US レター)にする', async () => {
    const doc = docOf(async () => Promise.reject(new Error('broken')), 2);
    expect(await readPageSizes(doc)).toEqual([FALLBACK_PAGE_SIZE, FALLBACK_PAGE_SIZE]);
  });

  it.each([
    ['幅が 0', 0, 100],
    ['高さが 0', 100, 0],
    ['負の値', -5, 100],
    ['NaN', Number.NaN, 100],
    ['無限大', 100, Number.POSITIVE_INFINITY],
  ])('大きさが不正(%s)なページも、読めなかったものとして扱う(レイアウトの計算を壊さない)', async (_label, width, height) => {
    const sizes = await readPageSizes(docOf(async () => pageOf(width, height), 1));
    expect(sizes).toEqual([FALLBACK_PAGE_SIZE]);
  });

  it('大きさが不正なページがあっても、他のページの大きさを、そのページの大きさで置き換えない', async () => {
    const doc = docOf(async (n) => (n === 1 ? pageOf(0, 0) : pageOf(250, 350)), 2);
    expect(await readPageSizes(doc)).toEqual([{ width: 250, height: 350 }, { width: 250, height: 350 }]);
  });

  it('代替の大きさは、レイアウトが受け付ける正の有限の数(US レター)', () => {
    expect(FALLBACK_PAGE_SIZE).toEqual({ width: 612, height: 792 });
  });

  it('0 ページの文書は、空の配列', async () => {
    expect(await readPageSizes(docOf(async () => pageOf(1, 1), 0))).toEqual([]);
  });
});
