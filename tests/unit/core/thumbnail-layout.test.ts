import { describe, expect, it } from 'vitest';
import { computeThumbnailHeight } from '../../../src/core/thumbnail-layout.ts';
import { A3, A4, A4_LANDSCAPE } from './helpers/pages.ts';

describe('computeThumbnailHeight(ページの縦横比を保って、固定幅に収まる高さを求める。F11)', () => {
  it.each([
    ['正方形', { width: 100, height: 100 }, 100, 100],
    ['縦長(A4縦)', A4, 100, 142],
    ['横長(A4横)', A4_LANDSCAPE, 100, 71],
    ['さらに縦長(A3)', A3, 100, 141],
  ])('%s のページ、幅 %i → 高さ %i', (_label, pageSize, width, expected) => {
    expect(computeThumbnailHeight(pageSize, width)).toBe(expected);
  });

  it('四捨五入した整数にする', () => {
    expect(computeThumbnailHeight({ width: 3, height: 2 }, 10)).toBe(7); // 6.66… → 7
  });

  it('幅が広いほど、高さも大きくなる(四捨五入の誤差はあるが、ほぼ比例する)', () => {
    expect(computeThumbnailHeight(A4, 200)).toBeGreaterThan(computeThumbnailHeight(A4, 100));
  });

  it('混在したページの大きさでも、ページごとに異なる高さになる(mixed-sizes.pdf に対応)', () => {
    const heights = [A4, A4_LANDSCAPE, A3].map((size) => computeThumbnailHeight(size, 100));
    expect(new Set(heights).size).toBe(3);
  });
});
