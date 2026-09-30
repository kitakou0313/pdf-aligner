import { PDFDocument, PDFName, PDFRawStream, PDFArray, decodePDFRawStream } from '@pdfme/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { slicePages } from '../../../src/pdf/slice.ts';
import { buildFixtures } from '../../fixtures/build.ts';

type Size = [number, number];

let fixtures: Map<string, Uint8Array>;
beforeAll(async () => {
  fixtures = await buildFixtures();
});

/** 名前で、生成済みのフィクスチャを取り出す(なければテストを失敗させる)。 */
function get(name: string): Uint8Array {
  const bytes = fixtures.get(name);
  if (!bytes) throw new Error(`フィクスチャがありません: ${name}`);
  return bytes;
}

/** PDF のバイト列を読み込み、各ページの [幅, 高さ] を返す。 */
async function sizesOf(bytes: Uint8Array): Promise<Size[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page): Size => [page.getWidth(), page.getHeight()]);
}

/** ページの内容ストリーム(復号後)を連結して、文字列にする(ページの見た目を決める命令列。ページの同一性の確認用)。 */
function contentOf(doc: PDFDocument, index: number): string {
  const contents = doc.getPages()[index]!.node.get(PDFName.of('Contents'));
  const resolved = doc.context.lookup(contents);
  const streams = resolved instanceof PDFArray ? resolved.asArray().map((ref) => doc.context.lookup(ref)) : [resolved];
  return streams.map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream as PDFRawStream).decode())).join('\n');
}

/** PDF のバイト列を読み込み、各ページの内容ストリームを返す。 */
async function contentsOf(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((_page, index) => contentOf(doc, index));
}

describe('slicePages(元 PDF の連続したページを、新しい PDF として切り出す)', () => {
  it('ページ数は範囲の長さに一致し、各ページの大きさ・内容は、元の該当ページと同じ(colored-12 の p.4–8)', async () => {
    const source = get('colored-12.pdf');
    const sliced = await slicePages(source, { start: 4, end: 8 });
    expect(await sizesOf(sliced)).toHaveLength(5);
    expect(await contentsOf(sliced)).toEqual((await contentsOf(source)).slice(3, 8));
  });

  it('全ページの範囲は、ページ数も内容も元と同じ', async () => {
    const source = get('colored-12.pdf');
    const sliced = await slicePages(source, { start: 1, end: 12 });
    expect(await contentsOf(sliced)).toEqual(await contentsOf(source));
  });

  it('1 ページだけの範囲(先頭・末尾・途中)は、そのページだけになる', async () => {
    const source = await contentsOf(get('colored-12.pdf'));
    for (const page of [1, 7, 12]) {
      const sliced = await slicePages(get('colored-12.pdf'), { start: page, end: page });
      expect(await contentsOf(sliced)).toEqual([source[page - 1]]);
    }
  });

  it('性質: 区切りで分けた全セグメントのページ数の合計は総ページ数で、つなぐと元のページ列に戻る(重複・欠落なし)', async () => {
    const source = get('colored-12.pdf');
    const segments = [{ start: 1, end: 3 }, { start: 4, end: 8 }, { start: 9, end: 12 }];
    const parts = await Promise.all(segments.map((segment) => slicePages(source, segment).then(contentsOf)));
    expect(parts.flat()).toEqual(await contentsOf(source));
  });

  it('ページの大きさが混在する PDF でも、ページごとの大きさを保つ(mixed-sizes)', async () => {
    const source = get('mixed-sizes.pdf');
    const all = await sizesOf(source);
    const sliced = await slicePages(source, { start: 2, end: all.length });
    expect(await sizesOf(sliced)).toEqual(all.slice(1));
  });

  it('非埋め込みの日本語フォントを使うページも切り出せて、内容が同じ(cjk-non-embedded)', async () => {
    const source = get('cjk-non-embedded.pdf');
    const sliced = await slicePages(source, { start: 1, end: 1 });
    expect(await contentsOf(sliced)).toEqual((await contentsOf(source)).slice(0, 1));
  });

  it('出力は、PDF として読み直せて、新しい PDF のバイト列(先頭が %PDF-)', async () => {
    const sliced = await slicePages(get('single-page.pdf'), { start: 1, end: 1 });
    expect(new TextDecoder('latin1').decode(sliced.slice(0, 5))).toBe('%PDF-');
  });

  it('元のバイト列は書き換えない', async () => {
    const source = get('colored-12.pdf');
    const copy = source.slice();
    await slicePages(source, { start: 2, end: 5 });
    expect(source).toEqual(copy);
  });

  it.each([
    [0, 3],
    [1, 13],
    [5, 4],
    [1.5, 3],
  ])('範囲外・逆転・整数でない範囲 %i–%i は、例外にする', async (start, end) => {
    await expect(slicePages(get('colored-12.pdf'), { start, end })).rejects.toThrow(RangeError);
  });

  it.each(['broken-garbage.pdf', 'broken-truncated.pdf'])('読めない PDF(%s)は、例外で拒否する', async (name) => {
    await expect(slicePages(get(name), { start: 1, end: 1 })).rejects.toThrow();
  });
});
