import { PDFDocument, StandardFonts, rgb, type PDFFont } from '@cantoo/pdf-lib';
import {
  A3,
  A4,
  A4_LANDSCAPE,
  CJK_TEXT_SJIS_HEX,
  ENCRYPTED_PASSWORD,
  pageColor,
  textColorFor,
  type PageSize,
  type Rgb,
} from './spec.ts';

type Builder = () => Promise<Uint8Array> | Uint8Array;

/** 同じ大きさのページが count 枚並ぶ配列を作る。 */
function repeat(size: PageSize, count: number): PageSize[] {
  return Array.from({ length: count }, () => size);
}

/** メタデータを固定して、同じ入力からは同じバイト列ができる空の PDF 文書を作る。 */
async function newDocument(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.setTitle('pdf-aligner test fixture');
  doc.setCreator('pdf-aligner');
  doc.setProducer('pdf-aligner fixtures');
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  return doc;
}

/** 0〜255 の色を、pdf-lib が受け取る 0〜1 の色に変換する。 */
function toPdfColor([r, g, b]: Rgb): ReturnType<typeof rgb> {
  return rgb(r / 255, g / 255, b / 255);
}

/** 1 ページを、単色の背景とページ番号(1 始まり)で描く。 */
function drawColoredPage(doc: PDFDocument, font: PDFFont, size: PageSize, index: number): void {
  const page = doc.addPage([size.width, size.height]);
  const color = pageColor(index);
  page.drawRectangle({ x: 0, y: 0, ...size, color: toPdfColor(color) });
  const text = { x: 40, y: size.height / 2 - 40, size: 120, font, color: toPdfColor(textColorFor(color)) };
  page.drawText(String(index + 1), text);
}

/** 各ページを単色で塗り、ページ番号を大きく書いた PDF 文書を作る。 */
async function coloredDocument(sizes: readonly PageSize[]): Promise<PDFDocument> {
  const doc = await newDocument();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  sizes.forEach((size, index) => drawColoredPage(doc, font, size, index));
  return doc;
}

/** 文書をバイト列にする。0 ページのときに白紙を足さず、オブジェクトストリームも使わない(構造を単純に保つ)。 */
function saveAsIs(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: false, addDefaultPage: false });
}

/** 色つき PDF のバイト列を作る。 */
async function coloredPdf(sizes: readonly PageSize[]): Promise<Uint8Array> {
  return saveAsIs(await coloredDocument(sizes));
}

/** ユーザーパスワード付きで暗号化した、3 ページの色つき PDF を作る。 */
async function encryptedPdf(): Promise<Uint8Array> {
  const doc = await coloredDocument(repeat(A4, 3));
  doc.encrypt({ userPassword: ENCRYPTED_PASSWORD, ownerPassword: 'owner-secret' });
  return saveAsIs(doc);
}

/** 色つき PDF の先頭 40% だけを残した、途中で切れた PDF を作る。 */
async function truncatedPdf(): Promise<Uint8Array> {
  const full = await coloredPdf(repeat(A4, 12));
  return full.slice(0, Math.floor(full.length * 0.4));
}

/** PDF の見出しだけがあり、中身が PDF の構造になっていないデータを作る。 */
function garbagePdf(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.7\n' + 'garbage '.repeat(200));
}

/** PDF ではないテキストファイルの中身を作る。 */
function notAPdf(): Uint8Array {
  return new TextEncoder().encode('This is not a PDF.\n');
}

/** 内容ストリームのオブジェクト本体を作る(ASCII のみなので /Length は文字数)。 */
function streamBody(content: string): string {
  return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
}

/** 相互参照表と trailer の文字列を作る(各行は 20 バイト。startxref は表の開始位置)。 */
function xrefAndTrailer(offsets: readonly number[], xrefStart: number): string {
  const size = offsets.length + 1;
  const rows = offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  const head = `xref\n0 ${size}\n0000000000 65535 f \n`;
  return `${head}${rows}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
}

/** 番号付きオブジェクトの本体を並べ、相互参照表と trailer を付けて PDF 1.4 を組み立てる。 */
function assemblePdf(bodies: readonly string[]): Uint8Array {
  let out = '%PDF-1.4\n';
  const offsets = bodies.map((body, i) => {
    const start = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return start;
  });
  out += xrefAndTrailer(offsets, out.length);
  return new TextEncoder().encode(out);
}

/** フォント非埋め込みの日本語(Type0 + 90ms-RKSJ-H)を使う 1 ページ PDF のオブジェクト本体を作る。 */
function cjkObjects(content: string): string[] {
  const font = '/HeiseiKakuGo-W5';
  return [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    streamBody(content),
    `<< /Type /Font /Subtype /Type0 /BaseFont ${font} /Encoding /90ms-RKSJ-H /DescendantFonts [6 0 R] >>`,
    `<< /Type /Font /Subtype /CIDFontType0 /BaseFont ${font} /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 7 0 R /DW 1000 >>`,
    `<< /Type /FontDescriptor /FontName ${font} /Flags 4 /FontBBox [-92 -250 1010 922] /ItalicAngle 0 /Ascent 752 /Descent -271 /CapHeight 737 /StemV 114 >>`,
  ];
}

/** 1 ページ目の色を背景にして、フォント非埋め込みの日本語を書いた PDF を作る。 */
function cjkPdf(): Uint8Array {
  const [r, g, b] = pageColor(0).map((v) => (v / 255).toFixed(4));
  const background = `q ${r} ${g} ${b} rg 0 0 595 842 re f Q`;
  const text = `BT /F1 48 Tf 1 0 0 1 40 400 Tm 0 g <${CJK_TEXT_SJIS_HEX}> Tj ET`;
  return assemblePdf(cjkObjects(`${background}\n${text}`));
}

// Q14 で決めたフィクスチャの一覧。名前と、その中身を作る関数の対応表
const BUILDERS: ReadonlyArray<readonly [string, Builder]> = [
  ['colored-12.pdf', () => coloredPdf(repeat(A4, 12))],
  ['mixed-sizes.pdf', () => coloredPdf([A4, A4_LANDSCAPE, A3])],
  ['many-pages-150.pdf', () => coloredPdf(repeat(A4, 150))],
  ['single-page.pdf', () => coloredPdf([A4])],
  ['zero-pages.pdf', () => coloredPdf([])],
  ['cjk-non-embedded.pdf', cjkPdf],
  ['encrypted.pdf', encryptedPdf],
  ['broken-garbage.pdf', garbagePdf],
  ['broken-truncated.pdf', truncatedPdf],
  ['not-a-pdf.txt', notAPdf],
];

/** 全てのフィクスチャを生成し、ファイル名とバイト列の対応表にして返す。 */
export async function buildFixtures(): Promise<Map<string, Uint8Array>> {
  const entries = await Promise.all(BUILDERS.map(async ([name, build]) => [name, await build()] as const));
  return new Map(entries);
}
