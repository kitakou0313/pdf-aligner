import { describe, expect, it } from 'vitest';
import { composePages } from '../../../src/core/compose.ts';
import { computeLayout, type PageSize, type Placement } from '../../../src/core/layout.ts';
import { windowSource } from '../../../src/core/window-source.ts';
import { FakeSource, type Behavior } from './helpers/fake-source.ts';
import { A3, A4, A4_LANDSCAPE, repeat } from './helpers/pages.ts';

const SIGNAL = new AbortController().signal;
const PLACEMENT: Placement = { index: 0, x: 1, y: 2, width: 3, height: 4 };

/** ページ i の幅が 100 + i の、互いに大きさが違う count ページ(窓が、正しいページを見せているかを、大きさで確かめる)。 */
function distinctSizes(count: number): PageSize[] {
  return Array.from({ length: count }, (_, index) => ({ width: 100 + index, height: 200 }));
}

describe('windowSource(元のページ供給元の、first ページ目から count ページだけを見せる。ページの番号は窓の中で 0 から数える)', () => {
  it('ページ数は窓の大きさ。n 番目のページの大きさは、元の first + n 番目', () => {
    const source = windowSource(new FakeSource(distinctSizes(12)), 3, 4);
    expect(source.pageCount).toBe(4);
    expect([0, 1, 2, 3].map((index) => source.pageSize(index).width)).toEqual([103, 104, 105, 106]);
  });

  it('n 番目のページを描くと、元の first + n 番目のページを、同じ配置と中断の信号で描く', async () => {
    const seen: AbortSignal[] = [];
    /** 渡された中断の信号を記録する。 */
    const behavior: Behavior = async (_index, signal) => void seen.push(signal);
    const inner = new FakeSource(distinctSizes(12), behavior);
    await windowSource(inner, 3, 4).renderPage(2, PLACEMENT, SIGNAL);
    expect(inner.calls).toEqual([5]);
    expect(inner.placements).toEqual([PLACEMENT]);
    expect(seen).toEqual([SIGNAL]);
  });

  it('全ページの窓は、元と同じ(先頭から総ページ数)', () => {
    const sizes = [A4, A4_LANDSCAPE, A3];
    const source = windowSource(new FakeSource(sizes), 0, 3);
    expect([0, 1, 2].map((index) => source.pageSize(index))).toEqual(sizes);
  });

  it.each([
    ['first が負', -1, 3],
    ['count が 0', 2, 0],
    ['範囲の外まで及ぶ', 10, 3],
    ['first が小数', 1.5, 2],
    ['count が小数', 1, 1.5],
  ])('窓が正しくない(%s)ときは、例外にする', (_label, first, count) => {
    expect(() => windowSource(new FakeSource(repeat(A4, 12)), first, count)).toThrow(RangeError);
  });
});

describe('大きさが読めなかったページ(壊れたページ)の大きさ: 窓の中で最初に読めたページ → 元の代わりの大きさ(blueprint の F7)', () => {
  // 元の 5 ページ: 0 は A4(元の PDF 全体で最初に読めたページ)、1 は壊れたページ(代わりの大きさは A4)、2 は A3、3 は A4 横、4 は壊れたページ
  const sizes = [A4, A4, A3, A4_LANDSCAPE, A4];
  const broken = [1, 4];

  it('壊れたページは、そのページを含む窓で、最初に読めたページの大きさ(元の PDF 全体の代わりの大きさではない)', () => {
    const source = windowSource(new FakeSource(sizes, undefined, broken), 1, 3);
    expect(source.pageSize(0)).toEqual(A3);
    expect(source.pageSize(1)).toEqual(A3);
    expect(source.pageSize(2)).toEqual(A4_LANDSCAPE);
  });

  it('窓の中に読めるページがなければ、元の(PDF 全体の)代わりの大きさ', () => {
    const source = windowSource(new FakeSource(sizes, undefined, broken), 1, 1);
    expect(source.pageSize(0)).toEqual(A4);
  });

  it('窓の先頭から壊れたページが続くときも、その後ろで最初に読めたページの大きさを使う', () => {
    const both = windowSource(new FakeSource([A4, A4, A3], undefined, [0, 1]), 0, 3);
    expect(both.pageSize(0)).toEqual(A3);
    expect(both.pageSize(1)).toEqual(A3);
  });

  it('isReadable は、元の first + n 番目のページが読めたかを返す。読めたページの大きさは、そのまま', () => {
    const source = windowSource(new FakeSource(sizes, undefined, broken), 1, 3);
    expect([0, 1, 2].map((index) => source.isReadable(index))).toEqual([false, true, true]);
    expect(source.pageSize(1)).toEqual(A3);
  });

  it('壊れたページが、窓のセルの大きさを変えない(元の PDF 全体の代わりの大きさが A3 でも、A4 横だけの窓のセルは A4 横のまま)', () => {
    const inner = new FakeSource([A3, A4_LANDSCAPE, A3], undefined, [2]);
    const window = windowSource(inner, 1, 2);
    const layout = computeLayout([window.pageSize(0), window.pageSize(1)], 2, 2);
    expect([layout.cellWidth, layout.cellHeight]).toEqual([842 * 2, 595 * 2]);
  });
});

describe('composePages と組み合わせて、セグメントの範囲だけを描く', () => {
  it('元の first + n 番目のページを、順に描く。レイアウトは、窓の中のページだけで決まる(元の他のページの大きさに影響されない)', async () => {
    const inner = new FakeSource([A3, A3, A3, A4, A4, A4, A4, A3, A3]);
    const result = await composePages(windowSource(inner, 3, 4), { columns: 2, signal: SIGNAL });
    expect(inner.calls).toEqual([3, 4, 5, 6]);
    expect(result.layout).toEqual(computeLayout(repeat(A4, 4), 2, 2));
  });

  it('失敗したページの番号は、窓の中の番号(0 始まり)で返る(元の番号への変換は、呼び出す側の責務)', async () => {
    /** 元の 5 ページ目(0 始まりの 4)だけ、描画に失敗する。 */
    const behavior: Behavior = async (index) => {
      if (index === 4) throw new Error('broken');
    };
    const result = await composePages(windowSource(new FakeSource(repeat(A4, 9), behavior), 3, 4), { columns: 2, signal: SIGNAL });
    expect(result.failedPages).toEqual([1]);
  });

  it('進捗の総数は、窓のページ数', async () => {
    const totals: number[] = [];
    /** 進捗の総数を記録する。 */
    const onProgress = (_done: number, total: number): void => void totals.push(total);
    await composePages(windowSource(new FakeSource(repeat(A4, 9)), 3, 4), { columns: 2, signal: SIGNAL, onProgress });
    expect(new Set(totals)).toEqual(new Set([4]));
  });
});
