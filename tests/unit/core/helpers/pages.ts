import type { PageSize } from '../../../../src/core/layout.ts';

export const A4: PageSize = { width: 595, height: 842 };
export const A4_LANDSCAPE: PageSize = { width: 842, height: 595 };
export const A3: PageSize = { width: 842, height: 1191 };

/** 同じ大きさのページが count 枚並ぶ配列を作る。 */
export function repeat(size: PageSize, count: number): PageSize[] {
  return Array.from({ length: count }, () => size);
}
