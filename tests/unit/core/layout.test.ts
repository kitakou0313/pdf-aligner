import { describe, expect, it } from 'vitest';
import { computeLayout, planLayout, type Layout, type PageSize, type Placement } from '../../../src/core/layout.ts';
import { CHROME_CANVAS_LIMITS, TARGET_SCALE } from '../../../src/core/limits.ts';
import { A3, A4, A4_LANDSCAPE, repeat } from './helpers/pages.ts';

/** 2 つの矩形の内部が重なるかを判定する。 */
function overlaps(a: Placement, b: Placement): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** i 番目のセルの左上の座標(blueprint の計算式どおり)を返す。 */
function cellOrigin(layout: Layout, index: number): { x: number; y: number } {
  const row = Math.floor(index / layout.columns);
  const col = index % layout.columns;
  return {
    x: layout.gap + col * (layout.cellWidth + layout.gap),
    y: layout.gap + row * (layout.cellHeight + layout.gap),
  };
}

describe('computeLayout: blueprint の例 1(A4 縦 5 ページ、列数 2、倍率 2)', () => {
  const layout = computeLayout(repeat(A4, 5), 2, 2);

  it('画像の大きさは 2476 × 5180 px', () => {
    expect([layout.width, layout.height]).toEqual([2476, 5180]);
  });

  it('セル 1190 × 1684、隙間 32、3 行 2 列', () => {
    expect([layout.cellWidth, layout.cellHeight, layout.gap]).toEqual([1190, 1684, 32]);
    expect([layout.columns, layout.rows, layout.scale]).toEqual([2, 3, 2]);
  });

  it('各ページの左上の座標は、行方向(左から右、上から下)に並ぶ', () => {
    const origins = layout.placements.map((p) => [p.x, p.y]);
    expect(origins).toEqual([[32, 32], [1254, 32], [32, 1748], [1254, 1748], [32, 3464]]);
  });

  it('ページの番号は 0 始まりで、描画の大きさは 1190 × 1684。空きセルには配置しない', () => {
    expect(layout.placements.map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
    expect(layout.placements.every((p) => p.width === 1190 && p.height === 1684)).toBe(true);
  });
});

describe('computeLayout: blueprint の例 2(A4 縦と A4 横、列数 2、倍率 2)', () => {
  const layout = computeLayout([A4, A4_LANDSCAPE], 2, 2);

  it('画像の大きさは 3464 × 1748 px。セルは 1684 × 1684', () => {
    expect([layout.width, layout.height]).toEqual([3464, 1748]);
    expect([layout.cellWidth, layout.cellHeight]).toEqual([1684, 1684]);
  });

  it('縦のページは横方向に、横のページは縦方向に、247 px ずらして中央に置く', () => {
    expect(layout.placements).toEqual([
      { index: 0, x: 279, y: 32, width: 1190, height: 1684 },
      { index: 1, x: 1748, y: 279, width: 1684, height: 1190 },
    ]);
  });

  it('右端と下端の余白は、どちらも 32 px', () => {
    expect(layout.width - (1748 + 1684)).toBe(32);
    expect(layout.height - (32 + 1684)).toBe(32);
  });
});

describe('computeLayout: blueprint の例 4 と例 6', () => {
  it('1 ページだけなら、画像の大きさは 1254 × 1748 px', () => {
    const layout = computeLayout([A4], 1, 2);
    expect([layout.width, layout.height]).toEqual([1254, 1748]);
  });

  it('A4 の 150 ページ、列数 10: 1 倍で 6126 × 12886、2 倍で 12252 × 25772', () => {
    const pages = repeat(A4, 150);
    expect([computeLayout(pages, 10, 1).width, computeLayout(pages, 10, 1).height]).toEqual([6126, 12886]);
    expect([computeLayout(pages, 10, 2).width, computeLayout(pages, 10, 2).height]).toEqual([12252, 25772]);
  });

  it('列数がページ数と同じなら、1 行に全て並ぶ', () => {
    const layout = computeLayout(repeat(A4, 4), 4, 2);
    expect(layout.rows).toBe(1);
    expect(layout.placements.every((p) => p.y === 32)).toBe(true);
  });
});

describe('computeLayout: 端数のある倍率', () => {
  it('倍率 1.5 の A4 は、幅 892.5 を 893 に丸めて描き、画像の大きさは切り上げる(941 × 1311)', () => {
    const layout = computeLayout([A4], 1, 1.5);
    expect([layout.width, layout.height]).toEqual([941, 1311]);
    expect(layout.placements[0]).toEqual({ index: 0, x: 24, y: 24, width: 893, height: 1263 });
  });

  it('画像の大きさは、正確な値の切り上げになる(浮動小数点の誤差で 1 px 増えない)', () => {
    for (let k = 10; k <= 200; k += 1) {
      for (const columns of [1, 2, 3, 5]) {
        const layout = computeLayout(repeat(A4, 6), columns, k / 100);
        const rows = Math.ceil(6 / columns);
        const exactW = (k * (32 + columns * 595 + 16 * (columns - 1))) / 100;
        const exactH = (k * (32 + rows * 842 + 16 * (rows - 1))) / 100;
        expect([layout.width, layout.height], `k=${k} columns=${columns}`).toEqual([Math.ceil(exactW), Math.ceil(exactH)]);
      }
    }
  });
});

describe('computeLayout: どの入力でも成り立つ性質', () => {
  const PAGE_SETS: PageSize[][] = [
    repeat(A4, 7),
    [A4, A4_LANDSCAPE, A3, A4, A4_LANDSCAPE, A3, A4],
    [{ width: 100, height: 300 }, { width: 400, height: 50 }, { width: 250, height: 250 }, { width: 33, height: 77 }],
  ];
  const SCALES = [0.37, 1, 1.5, 2];

  /** 全ての組み合わせ(ページの集合、列数、倍率)について、検査を実行する。 */
  function forEachCombination(check: (layout: Layout, pages: PageSize[]) => void): void {
    for (const pages of PAGE_SETS) {
      for (let columns = 1; columns <= pages.length; columns += 1) {
        for (const scale of SCALES) check(computeLayout(pages, columns, scale), pages);
      }
    }
  }

  it('全てのページが、画像の内側に収まる', () => {
    forEachCombination((layout) => {
      for (const p of layout.placements) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + p.width).toBeLessThanOrEqual(layout.width);
        expect(p.y + p.height).toBeLessThanOrEqual(layout.height);
      }
    });
  });

  it('どのページも、互いに重ならない', () => {
    forEachCombination((layout) => {
      const list = layout.placements;
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) expect(overlaps(list[i]!, list[j]!)).toBe(false);
      }
    });
  });

  it('i 番目のページは、行方向の順で決まる i 番目のセルの中にあり、中央に置かれる', () => {
    forEachCombination((layout) => {
      layout.placements.forEach((p, i) => {
        const cell = cellOrigin(layout, i);
        expect(p.index).toBe(i);
        expect(p.x).toBeGreaterThanOrEqual(cell.x - 1);
        expect(p.y).toBeGreaterThanOrEqual(cell.y - 1);
        expect(Math.abs(p.x - cell.x - (cell.x + layout.cellWidth - (p.x + p.width)))).toBeLessThanOrEqual(2);
        expect(Math.abs(p.y - cell.y - (cell.y + layout.cellHeight - (p.y + p.height)))).toBeLessThanOrEqual(2);
      });
    });
  });

  it('配置の数は、ページ数と同じ', () => {
    forEachCombination((layout, pages) => expect(layout.placements).toHaveLength(pages.length));
  });
});

describe('computeLayout: 不正な入力', () => {
  it('ページが 0 枚なら、例外にする', () => {
    expect(() => computeLayout([], 1, 2)).toThrow(RangeError);
  });

  it.each([0, -1, 1.5, Number.NaN, 4])('列数 %s は、範囲外(1〜ページ数の整数)として例外にする', (columns) => {
    expect(() => computeLayout(repeat(A4, 3), columns, 2)).toThrow(RangeError);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('倍率 %s は、例外にする', (scale) => {
    expect(() => computeLayout([A4], 1, scale)).toThrow(RangeError);
  });

  it.each([0, -5, Number.NaN])('ページの大きさに %s が含まれるなら、例外にする', (bad) => {
    expect(() => computeLayout([{ width: bad, height: 842 }], 1, 2)).toThrow(RangeError);
    expect(() => computeLayout([{ width: 595, height: bad }], 1, 2)).toThrow(RangeError);
  });
});

describe('planLayout(目標倍率と、canvas の上限からの自動縮小)', () => {
  const LIMITS = CHROME_CANVAS_LIMITS;

  /** 画像が、辺と面積の上限に収まっているかを判定する。 */
  function fits(layout: Layout, limits: { maxSide: number; maxArea: number }): boolean {
    const { width, height } = layout;
    return width <= limits.maxSide && height <= limits.maxSide && width * height <= limits.maxArea;
  }

  it('上限に収まるなら、目標の倍率(2 倍)のまま縮小しない', () => {
    const plan = planLayout(repeat(A4, 12), 5, LIMITS);
    expect(plan.layout.scale).toBe(TARGET_SCALE);
    expect(plan.shrunk).toBe(false);
  });

  it('面積の上限を超えるときは、上限に収まる最大に近い倍率まで縮小する(A4 の 150 ページ、列数 10)', () => {
    const plan = planLayout(repeat(A4, 150), 10, LIMITS);
    const analytic = Math.sqrt(LIMITS.maxArea / (6126 * 12886));
    expect(plan.shrunk).toBe(true);
    expect(fits(plan.layout, LIMITS)).toBe(true);
    expect(plan.layout.scale).toBeLessThanOrEqual(analytic);
    expect(plan.layout.scale).toBeGreaterThan(analytic * 0.999);
  });

  it('辺の上限を超えるときも縮小する(高さが 10312 px になる 12 ページ・1 列を、5000 px に収める)', () => {
    const limits = { maxSide: 5000, maxArea: 1e12 };
    const plan = planLayout(repeat(A4, 12), 1, limits);
    expect(plan.shrunk).toBe(true);
    expect(plan.layout.height).toBeLessThanOrEqual(5000);
    expect(plan.layout.height).toBeGreaterThan(4990);
  });

  it('ちょうど上限の大きさなら、縮小しない', () => {
    const plan = planLayout([A4], 1, { maxSide: 1748, maxArea: 1254 * 1748 });
    expect(plan.layout.scale).toBe(2);
    expect(plan.shrunk).toBe(false);
  });

  it('どんな組み合わせでも、結果は必ず上限に収まる。縮小したかは、倍率が目標を下回ったかで決まる', () => {
    const limitsList = [LIMITS, { maxSide: 3000, maxArea: 4_000_000 }, { maxSide: 500, maxArea: 90_000 }];
    for (const limits of limitsList) {
      for (const [pages, columns] of [[repeat(A4, 20), 4], [[A4, A4_LANDSCAPE, A3], 3], [repeat(A3, 33), 6]] as const) {
        const plan = planLayout(pages, columns, limits);
        expect(fits(plan.layout, limits)).toBe(true);
        expect(plan.shrunk).toBe(plan.layout.scale < TARGET_SCALE);
      }
    }
  });

  it('目標の倍率を指定できる', () => {
    expect(planLayout([A4], 1, LIMITS, 1).layout.scale).toBe(1);
  });

  it.each([{ maxSide: 0, maxArea: 100 }, { maxSide: 100, maxArea: 0 }, { maxSide: Number.NaN, maxArea: 100 }])(
    '不正な上限 %j は、例外にする',
    (limits) => {
      expect(() => planLayout([A4], 1, limits)).toThrow(RangeError);
    },
  );
});
