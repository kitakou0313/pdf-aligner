import { describe, expect, it } from 'vitest';
import { BACKGROUND_COLOR, CHROME_CANVAS_LIMITS, GAP_AT_1X, TARGET_SCALE } from '../../../src/core/limits.ts';

describe('blueprint の定数(F2 レイアウト、F3 出力サイズ)', () => {
  it('目標の倍率は 2(PDF の 1 pt を 2 px にする)', () => {
    expect(TARGET_SCALE).toBe(2);
  });

  it('隙間と外周の余白は、倍率 1 のとき 16 px', () => {
    expect(GAP_AT_1X).toBe(16);
  });

  it('背景は、薄いグレー(RGB 230, 230, 230)の、不透明な色', () => {
    expect(BACKGROUND_COLOR).toBe('rgb(230, 230, 230)');
  });

  it('canvas の上限は、実測した値(blueprint の F3): 辺は 65,535 px、面積は 268,435,456 px(16,384 の 2 乗)', () => {
    expect(CHROME_CANVAS_LIMITS).toEqual({ maxSide: 65_535, maxArea: 268_435_456 });
  });
});
