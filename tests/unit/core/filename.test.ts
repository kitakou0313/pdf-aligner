import { describe, expect, it } from 'vitest';
import { downloadFileName, FALLBACK_BASE_NAME, imageFileName, segmentFileName } from '../../../src/core/filename.ts';
import { segmentsOf } from '../../../src/core/segments.ts';

describe('downloadFileName(<元のファイル名(拡張子なし)>-<列数>cols.png)', () => {
  it.each([
    ['report.pdf', 10, 'report-10cols.png'],
    ['議事録.PDF', 4, '議事録-4cols.png'],
    ['scan.v2.pdf', 3, 'scan.v2-3cols.png'],
    ['Report.Pdf', 1, 'Report-1cols.png'],
    ['memo', 10, 'memo-10cols.png'],
    ['report.final', 2, 'report.final-2cols.png'],
    ['a.pdf.pdf', 5, 'a.pdf-5cols.png'],
    ['名前 with spaces.pdf', 12, '名前 with spaces-12cols.png'],
  ])('%j, 列数 %i → %j', (original, columns, expected) => {
    expect(downloadFileName(original, columns)).toBe(expected);
  });

  it('拡張子だけ・空のファイル名は、代わりの名前を使う', () => {
    expect(downloadFileName('.pdf', 3)).toBe(`${FALLBACK_BASE_NAME}-3cols.png`);
    expect(downloadFileName('', 3)).toBe(`${FALLBACK_BASE_NAME}-3cols.png`);
    expect(downloadFileName('   .pdf', 3)).toBe(`${FALLBACK_BASE_NAME}-3cols.png`);
  });

  it('必ず .png で終わる', () => {
    expect(downloadFileName('x.pdf', 7).endsWith('.png')).toBe(true);
  });

  it.each([0, -1, 1.5, Number.NaN])('列数 %s は、例外にする', (columns) => {
    expect(() => downloadFileName('a.pdf', columns)).toThrow(RangeError);
  });
});

describe('segmentFileName(<元の名前>-p<開始>-<終了>-<実際の列数>cols.png。ページ番号は総ページ数の桁数でゼロ埋め。blueprint の例 8)', () => {
  it.each([
    [20, 1, 4, 4, 'report-p01-04-4cols.png'],
    [20, 5, 7, 3, 'report-p05-07-3cols.png'],
    [20, 8, 20, 10, 'report-p08-20-10cols.png'],
    [120, 1, 4, 4, 'report-p001-004-4cols.png'],
    [120, 5, 99, 10, 'report-p005-099-10cols.png'],
    [120, 100, 120, 10, 'report-p100-120-10cols.png'],
  ])('総ページ数 %i、p.%i–%i、実際の列数 %i → %j', (pageCount, start, end, columns, expected) => {
    expect(segmentFileName('report.pdf', { start, end }, pageCount, columns)).toBe(expected);
  });

  it.each([
    [9, 'x-p5-7-3cols.png'],
    [10, 'x-p05-07-3cols.png'],
    [99, 'x-p05-07-3cols.png'],
    [100, 'x-p005-007-3cols.png'],
    [999, 'x-p005-007-3cols.png'],
    [1000, 'x-p0005-0007-3cols.png'],
  ])('ゼロ埋めの桁数の境界: 総ページ数 %i → %j', (pageCount, expected) => {
    expect(segmentFileName('x.pdf', { start: 5, end: 7 }, pageCount, 3)).toBe(expected);
  });

  it('元のファイル名の扱いは、downloadFileName と同じ(拡張子の除去、空のときの代わりの名前)', () => {
    expect(segmentFileName('議事録.PDF', { start: 2, end: 3 }, 20, 2)).toBe('議事録-p02-03-2cols.png');
    expect(segmentFileName('.pdf', { start: 2, end: 3 }, 20, 2)).toBe(`${FALLBACK_BASE_NAME}-p02-03-2cols.png`);
  });

  it.each([0, -1, 1.5, Number.NaN])('列数 %s は、例外にする', (columns) => {
    expect(() => segmentFileName('a.pdf', { start: 1, end: 2 }, 20, columns)).toThrow(RangeError);
  });
});

describe('imageFileName(表示中のセグメント、または一括保存の n 番目のセグメントの、保存するファイル名)', () => {
  it('区切りなし(セグメントが 1 個)のときは、既存の名前(<元の名前>-<列数>cols.png)のまま', () => {
    expect(imageFileName('report.pdf', 10, segmentsOf(20, []), 0)).toBe('report-10cols.png');
  });

  it('セグメントが 2 個以上のときは、ページ範囲と、そのセグメントの実際の列数(min(列数, ページ数))を入れる(blueprint の例 8)', () => {
    const segments = segmentsOf(20, [5, 8]);
    const names = segments.map((_segment, index) => imageFileName('report.pdf', 10, segments, index));
    expect(names).toEqual(['report-p01-04-4cols.png', 'report-p05-07-3cols.png', 'report-p08-20-10cols.png']);
  });

  it('総ページ数は、セグメントの最後のページから分かる(120 ページ、区切り 5, 100)', () => {
    const segments = segmentsOf(120, [5, 100]);
    const names = segments.map((_segment, index) => imageFileName('report.pdf', 10, segments, index));
    expect(names).toEqual(['report-p001-004-4cols.png', 'report-p005-099-10cols.png', 'report-p100-120-10cols.png']);
  });

  it.each([-1, 3, 1.5])('範囲外のセグメントの番号 %s は、例外にする', (index) => {
    expect(() => imageFileName('a.pdf', 10, segmentsOf(20, [5, 8]), index)).toThrow(RangeError);
  });

  it('性質: 全ページ 120 のときの名前は、セグメントごとに一意で、名前順に並べるとページ順になる(区切りが 1 個、いくつか、全ページ)', () => {
    const allPages = Array.from({ length: 119 }, (_, index) => index + 2);
    for (const separators of [[60], [5, 100], [2, 3, 10, 11, 99, 100, 101], allPages]) {
      const segments = segmentsOf(120, separators);
      const names = segments.map((_segment, index) => imageFileName('report.pdf', 10, segments, index));
      expect(new Set(names).size).toBe(names.length);
      expect([...names].sort()).toEqual(names);
    }
  });
});
