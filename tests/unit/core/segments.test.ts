import { describe, expect, it } from 'vitest';
import { computeLayout } from '../../../src/core/layout.ts';
import {
  effectiveColumns,
  followedStart,
  segmentIndexOf,
  segmentLabel,
  segmentPageCount,
  segmentRange,
  segmentsOf,
  type Segment,
} from '../../../src/core/segments.ts';
import { A4, repeat } from './helpers/pages.ts';

/** 区切りの候補 2〜pageCount の、全ての部分集合(昇順)を列挙する。 */
function allSeparatorSets(pageCount: number): number[][] {
  const candidates = Array.from({ length: Math.max(pageCount - 1, 0) }, (_, index) => index + 2);
  return Array.from({ length: 2 ** candidates.length }, (_, mask) => candidates.filter((_page, bit) => (mask >> bit) & 1));
}

/** {start, end} を、短く書く。 */
function seg(start: number, end: number): Segment {
  return { start, end };
}

describe('segmentsOf(区切りから、セグメント(1 始まりのページ番号の範囲)を作る)', () => {
  it.each([
    [20, [5, 8], [seg(1, 4), seg(5, 7), seg(8, 20)]],
    [20, [], [seg(1, 20)]],
    [20, [5, 12], [seg(1, 4), seg(5, 11), seg(12, 20)]],
    [20, [2, 3], [seg(1, 1), seg(2, 2), seg(3, 20)]],
    [20, [20], [seg(1, 19), seg(20, 20)]],
    [1, [], [seg(1, 1)]],
    [2, [2], [seg(1, 1), seg(2, 2)]],
  ])('%i ページ、区切り %j', (pageCount, separators, expected) => {
    expect(segmentsOf(pageCount, separators)).toEqual(expected);
  });

  it('区切りに指定したページは、新しいセグメントの先頭になる(前のセグメントの末尾ではない)', () => {
    const [first, second] = segmentsOf(10, [5]);
    expect(first?.end).toBe(4);
    expect(second?.start).toBe(5);
  });

  it('網羅(総ページ数 1〜8 の、全ての区切りの部分集合)で、全ページがちょうど 1 つのセグメントに、順序を保って入る', () => {
    for (let pageCount = 1; pageCount <= 8; pageCount += 1) {
      for (const separators of allSeparatorSets(pageCount)) {
        const segments = segmentsOf(pageCount, separators);
        const pages = segments.flatMap(({ start, end }) => Array.from({ length: end - start + 1 }, (_, i) => start + i));
        expect(pages, `n=${pageCount} 区切り=${separators}`).toEqual(Array.from({ length: pageCount }, (_, i) => i + 1));
        expect(segments).toHaveLength(separators.length + 1);
        expect(segments.slice(1).map((s) => s.start)).toEqual(separators);
        expect(segments.every((s) => s.start <= s.end), '空のセグメントがない').toBe(true);
      }
    }
  });

  it.each([
    ['1 ページ目', 20, [1]],
    ['0', 20, [0]],
    ['総ページ数を超える', 20, [21]],
    ['昇順でない', 20, [8, 5]],
    ['重複', 20, [5, 5]],
    ['小数', 20, [5.5]],
    ['総ページ数が 0', 0, []],
  ])('正規化されていない区切り(%s)は、例外にする', (_label, pageCount, separators) => {
    expect(() => segmentsOf(pageCount, separators)).toThrow(RangeError);
  });
});

describe('segmentIndexOf(ページを含むセグメントの番号)', () => {
  it('網羅: 全ページ、全ての区切りで、返したセグメントがそのページを含む', () => {
    for (let pageCount = 1; pageCount <= 8; pageCount += 1) {
      for (const separators of allSeparatorSets(pageCount)) {
        const segments = segmentsOf(pageCount, separators);
        for (let page = 1; page <= pageCount; page += 1) {
          const found = segments[segmentIndexOf(segments, page)] as Segment;
          expect(found.start <= page && page <= found.end, `n=${pageCount} 区切り=${separators} p.${page}`).toBe(true);
        }
      }
    }
  });

  it.each([0, 21, 1.5])('範囲外のページ %s は、例外にする', (page) => {
    expect(() => segmentIndexOf(segmentsOf(20, [5]), page)).toThrow(RangeError);
  });
});

describe('followedStart(区切りを変えたとき、直前に表示していたセグメントの先頭ページを含む、新しいセグメントの先頭。blueprint の例 7)', () => {
  it.each([
    ['p.5–20 を表示中に、区切りへ 12 を足す', 5, [5, 12], 5],
    ['p.12–20 を表示中に、区切りを 5 だけにする', 12, [5], 5],
    ['p.5–11 を表示中に、区切りを 8 だけにする', 5, [8], 1],
    ['p.5–11 を表示中に、区切りをなくす', 5, [], 1],
  ])('%s', (_label, shownStart, separators, expected) => {
    expect(followedStart(shownStart, segmentsOf(20, separators))).toBe(expected);
  });

  it('網羅(総ページ数 1〜7 の、全ての旧区切りと新区切り): 新しい先頭は新しいセグメントの先頭で、旧先頭ページを含む', () => {
    for (let pageCount = 1; pageCount <= 7; pageCount += 1) {
      const sets = allSeparatorSets(pageCount);
      for (const before of sets) {
        for (const after of sets) {
          const next = segmentsOf(pageCount, after);
          for (const shown of segmentsOf(pageCount, before)) {
            const start = followedStart(shown.start, next);
            const found = next.find((s) => s.start === start) as Segment;
            expect(found, `n=${pageCount} ${before}→${after} 先頭 ${shown.start}`).toBeDefined();
            expect(found.start <= shown.start && shown.start <= found.end).toBe(true);
          }
        }
      }
    }
  });
});

describe('ラベルとページ数', () => {
  it('segmentLabel は「p.<開始>–<終了>(<番号>/<個数>)」(番号は 1 始まり。区切りなしの 1 個も同じ書式)', () => {
    expect(segmentLabel(seg(5, 11), 1, 3)).toBe('p.5–11(2/3)');
    expect(segmentLabel(seg(1, 20), 0, 1)).toBe('p.1–20(1/1)');
  });

  it('1 ページだけのセグメントも、同じ書式(p.5–5)', () => {
    expect(segmentLabel(seg(5, 5), 4, 6)).toBe('p.5–5(5/6)');
    expect(segmentRange(seg(5, 5))).toBe('p.5–5');
  });

  it('segmentRange は「p.<開始>–<終了>」', () => {
    expect(segmentRange(seg(8, 20))).toBe('p.8–20');
  });

  it('segmentPageCount は、範囲に含まれるページ数', () => {
    expect([segmentPageCount(seg(1, 4)), segmentPageCount(seg(8, 20)), segmentPageCount(seg(5, 5))]).toEqual([4, 13, 1]);
  });
});

describe('effectiveColumns(実際の列数 = 列数とセグメントのページ数の小さい方)と、セグメントごとのレイアウト(blueprint の例 8)', () => {
  it.each([
    [10, seg(1, 4), 4],
    [10, seg(5, 7), 3],
    [10, seg(8, 20), 10],
    [4, seg(4, 8), 4],
    [1, seg(4, 8), 1],
    [10, seg(5, 5), 1],
  ])('列数 %i、%j → %i', (columns, segment, expected) => {
    expect(effectiveColumns(columns, segment)).toBe(expected);
  });

  it('A4 縦 20 ページ、列数 10、区切り 5, 8、倍率 2 の、各セグメントの画像の大きさ', () => {
    const sizes = segmentsOf(20, [5, 8]).map((segment) => {
      const { width, height, rows } = computeLayout(repeat(A4, segmentPageCount(segment)), effectiveColumns(10, segment), 2);
      return { width, height, rows };
    });
    expect(sizes).toEqual([
      { width: 4920, height: 1748, rows: 1 },
      { width: 3698, height: 1748, rows: 1 },
      { width: 12252, height: 3464, rows: 2 },
    ]);
  });

  it('p.8–20 の元のページ 18(セグメントの中で 0 始まりの 10 番目)の左上は (32, 1748)', () => {
    const layout = computeLayout(repeat(A4, 13), 10, 2);
    const placement = layout.placements[18 - 8];
    expect([placement?.x, placement?.y]).toEqual([32, 1748]);
  });
});
