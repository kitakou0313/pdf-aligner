import { describe, expect, it } from 'vitest';
import { MAX_FIXTURE_PAGES, pageColor, textColorFor, type Rgb } from '../fixtures/spec.ts';

/** 色を、集合や比較に使える文字列にする。 */
function keyOf(color: Rgb): string {
  return color.join(',');
}

/** 0 から count 未満の番号の色を、全て返す。 */
function colorsUpTo(count: number): Rgb[] {
  return Array.from({ length: count }, (_, i) => pageColor(i));
}

describe('pageColor(ページ番号に対応する単色)', () => {
  it('150 ページ分の色が、全て異なる(ピクセル検証でページを特定するため)', () => {
    const keys = new Set(colorsUpTo(150).map(keyOf));
    expect(keys.size).toBe(150);
  });

  it('使える色の数は、150 ページを満たす', () => {
    expect(MAX_FIXTURE_PAGES).toBeGreaterThanOrEqual(150);
  });

  it('どの色も、灰色(R=G=B)から十分に離れている(背景の灰色と区別するため)', () => {
    for (const [r, g, b] of colorsUpTo(150)) {
      expect(Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b))).toBeGreaterThanOrEqual(40);
    }
  });

  it('各成分は 0〜255 の整数', () => {
    for (const color of colorsUpTo(150)) {
      for (const v of color) expect(Number.isInteger(v) && v >= 0 && v <= 255).toBe(true);
    }
  });

  it('同じ番号には、いつも同じ色を返す', () => {
    expect(pageColor(7)).toEqual(pageColor(7));
  });

  it('範囲外の番号は、例外にする', () => {
    expect(() => pageColor(-1)).toThrow(RangeError);
    expect(() => pageColor(MAX_FIXTURE_PAGES)).toThrow(RangeError);
    expect(() => pageColor(1.5)).toThrow(RangeError);
  });
});

describe('textColorFor(背景色の上に置く文字色)', () => {
  it('暗い背景には白を返す', () => {
    expect(textColorFor([20, 20, 60])).toEqual([255, 255, 255]);
  });

  it('明るい背景には黒を返す', () => {
    expect(textColorFor([220, 220, 180])).toEqual([0, 0, 0]);
  });
});
