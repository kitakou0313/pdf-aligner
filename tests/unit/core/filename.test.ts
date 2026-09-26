import { describe, expect, it } from 'vitest';
import { downloadFileName, FALLBACK_BASE_NAME } from '../../../src/core/filename.ts';

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
