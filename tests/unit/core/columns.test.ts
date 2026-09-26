import { describe, expect, it } from 'vitest';
import { DEFAULT_COLUMNS, defaultColumns, normalizeColumns } from '../../../src/core/columns.ts';

describe('defaultColumns(blueprint の例 3: 10 と総ページ数の小さい方)', () => {
  it.each([
    [12, 10],
    [10, 10],
    [4, 4],
    [1, 1],
    [500, 10],
  ])('総ページ数 %i のとき %i', (pageCount, expected) => {
    expect(defaultColumns(pageCount)).toBe(expected);
  });

  it('既定の上限は 10', () => {
    expect(DEFAULT_COLUMNS).toBe(10);
  });

  it.each([0, -1, 1.5, Number.NaN])('総ページ数 %s は、例外にする', (pageCount) => {
    expect(() => defaultColumns(pageCount)).toThrow(RangeError);
  });
});

describe('normalizeColumns(フォーカスを外したときの入力値の丸め)', () => {
  const PAGE_COUNT = 12;
  const PREVIOUS = 3;

  it.each([
    ['5', 5, '範囲内の整数は、そのまま'],
    ['1', 1, '下限'],
    ['12', 12, '上限(総ページ数)'],
    ['15', 12, '総ページ数を超える値は、総ページ数に丸める'],
    ['0', 1, '0 は 1 に丸める'],
    ['-3', 1, '負の値は 1 に丸める'],
    ['3.6', 4, '小数は四捨五入する(切り上がる)'],
    ['3.4', 3, '小数は四捨五入する(切り下がる)'],
    ['3.5', 4, '小数は四捨五入する(ちょうど半分は切り上げ)'],
    ['0.4', 1, '四捨五入して 0 になる値も、1 に丸める'],
    ['12.4', 12, '四捨五入した結果が範囲内なら、そのまま'],
    ['12.6', 12, '四捨五入した結果が範囲を超えるなら、総ページ数に丸める'],
    [' 7 ', 7, '前後の空白は無視する'],
    ['1e1', 10, '指数表記も数として読む'],
  ])('%j → %i(%s)', (raw, expected) => {
    expect(normalizeColumns(raw, PAGE_COUNT, PREVIOUS)).toBe(expected);
  });

  it.each([
    ['', '空欄'],
    ['   ', '空白だけ'],
    ['abc', '数値でない文字列'],
    ['Infinity', '無限大'],
    ['NaN', 'NaN'],
    ['1,5', '数として読めない書式'],
  ])('%j(%s)は、直前の値に戻す', (raw) => {
    expect(normalizeColumns(raw, PAGE_COUNT, PREVIOUS)).toBe(PREVIOUS);
  });

  it('総ページ数が 1 なら、何を入力しても 1 になる', () => {
    expect(normalizeColumns('5', 1, 1)).toBe(1);
    expect(normalizeColumns('0', 1, 1)).toBe(1);
  });
});
