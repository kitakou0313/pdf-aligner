import { describe, expect, it } from 'vitest';
import { gridOf, pointIn } from '../../e2e/helpers/geometry.ts';

const A4 = { width: 595, height: 842 };
const A4_LANDSCAPE = { width: 842, height: 595 };

/** 同じ大きさのページが count 枚並ぶ配列を作る。 */
function repeat(size: { width: number; height: number }, count: number): { width: number; height: number }[] {
  return Array.from({ length: count }, () => size);
}

// E2E の期待値を作る gridOf が、blueprint の数値例と一致することを確かめる。
// これが、E2E の期待値が「アプリの実装ではなく blueprint に基づく」ことの保証になる。
describe('gridOf(blueprint の数値例)', () => {
  it('例 1: A4 縦 5 ページ、列数 2、倍率 2 → 2476 × 5180 px。各ページの左上の座標', () => {
    const grid = gridOf(repeat(A4, 5), 2, 2);
    expect([grid.width, grid.height, grid.rows]).toEqual([2476, 5180, 3]);
    const corners = [0, 1, 2, 3, 4].map((i) => [grid.page(i).x, grid.page(i).y]);
    expect(corners).toEqual([[32, 32], [1254, 32], [32, 1748], [1254, 1748], [32, 3464]]);
  });

  it('例 2: A4 縦と A4 横、列数 2、倍率 2 → 3464 × 1748 px。縦向きは (279, 32)、横向きは (1748, 279)', () => {
    const grid = gridOf([A4, A4_LANDSCAPE], 2, 2);
    expect([grid.width, grid.height]).toEqual([3464, 1748]);
    expect(grid.page(0)).toEqual({ x: 279, y: 32, width: 1190, height: 1684 });
    expect(grid.page(1)).toEqual({ x: 1748, y: 279, width: 1684, height: 1190 });
  });

  it('例 6: A4 を 150 ページ、列数 10、倍率 2 → 12252 × 25772 px', () => {
    const grid = gridOf(repeat(A4, 150), 10, 2);
    expect([grid.width, grid.height]).toEqual([12252, 25772]);
  });

  it('セルは、全ページの最大の幅 × 最大の高さ。ページはその中央に置かれる', () => {
    const grid = gridOf([A4, A4_LANDSCAPE], 2, 2);
    expect(grid.cell(0)).toEqual({ x: 32, y: 32, width: 1684, height: 1684 });
    expect(grid.cell(1)).toEqual({ x: 1748, y: 32, width: 1684, height: 1684 });
  });

  it('端数は、座標を四捨五入、画像の大きさを切り上げで、整数にする', () => {
    const grid = gridOf([{ width: 100.3, height: 50.2 }], 1, 2);
    expect([grid.width, grid.height]).toEqual([Math.ceil(64 + 200.6), Math.ceil(64 + 100.4)]);
  });
});

describe('pointIn', () => {
  it('矩形の中の点を、左上を 0、右下を 1 とした割合で指定し、整数の座標にする', () => {
    expect(pointIn({ x: 10, y: 20, width: 100, height: 50 }, 0.5, 0.5)).toEqual({ x: 60, y: 45 });
    expect(pointIn({ x: 10, y: 20, width: 100, height: 50 }, 0.8, 0.2)).toEqual({ x: 90, y: 30 });
  });
});
