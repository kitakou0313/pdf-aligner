import { inflateSync } from 'node:zlib';

/** RGBA の色(各成分は 0〜255)。 */
export type Rgba = readonly [number, number, number, number];

/** 復号した PNG。rgba は、全画素の RGBA を行順に並べたもの。opaque は、全ての画素が不透明かどうか。 */
export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly opaque: boolean;
  readonly rgba: Buffer;
}

interface Header {
  readonly width: number;
  readonly height: number;
  readonly channels: 3 | 4;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOR_TYPE_RGB = 2;
const COLOR_TYPE_RGBA = 6;

/** PNG のチャンクを、先頭から順に取り出す(CRC は確かめない。E2E で、Chrome が作ったファイルを読むための最小の実装)。 */
function chunksOf(png: Buffer): { type: string; data: Buffer }[] {
  const chunks: { type: string; data: Buffer }[] = [];
  for (let offset = SIGNATURE.length; offset + 8 <= png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return chunks;
}

/** IHDR の内容を読む。対応するのは、8 ビットの RGB と RGBA で、インターレースなし。 */
function parseHeader(data: Buffer | undefined): Header {
  if (!data) throw new Error('PNG に IHDR がありません');
  const [bitDepth, colorType, , , interlace] = data.subarray(8, 13);
  const supported = bitDepth === 8 && (colorType === COLOR_TYPE_RGB || colorType === COLOR_TYPE_RGBA) && interlace === 0;
  if (!supported) throw new Error(`対応していない PNG の形式です(ビット深度 ${bitDepth}、色の種類 ${colorType}、インターレース ${interlace})`);
  return { width: data.readUInt32BE(0), height: data.readUInt32BE(4), channels: colorType === COLOR_TYPE_RGB ? 3 : 4 };
}

/** Paeth 予測(PNG の仕様どおり)。 */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** フィルタ種別に応じた、i 番目の成分の予測値(a: 左、b: 上、c: 左上)。 */
function predict(type: number, a: number, b: number, c: number): number {
  const predictors: Record<number, number> = { 0: 0, 1: a, 2: b, 3: (a + b) >> 1 };
  if (type === 4) return paeth(a, b, c);
  if (!(type in predictors)) throw new Error(`未知の PNG フィルタ種別です: ${type}`);
  return predictors[type] as number;
}

/** 1 行の、フィルタを外す(out に、復元した値を書き込む)。prev は 1 つ上の復元済みの行。 */
function unfilterRow(type: number, filtered: Buffer, prev: Buffer, out: Buffer, bpp: number): void {
  for (let i = 0; i < out.length; i += 1) {
    const a = i >= bpp ? (out[i - bpp] as number) : 0;
    const c = i >= bpp ? (prev[i - bpp] as number) : 0;
    out[i] = ((filtered[i] as number) + predict(type, a, prev[i] as number, c)) & 0xff;
  }
}

/** 圧縮を解いたデータ(行ごとに、フィルタ種別 1 バイト + 画素)から、フィルタを外した画素の列を作る。 */
function unfilter(raw: Buffer, header: Header): Buffer {
  const stride = header.width * header.channels;
  const pixels = Buffer.alloc(stride * header.height);
  for (let y = 0; y < header.height; y += 1) {
    const start = y * (stride + 1);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    unfilterRow(raw[start] as number, raw.subarray(start + 1, start + 1 + stride), prev, pixels.subarray(y * stride, (y + 1) * stride), header.channels);
  }
  return pixels;
}

/** 画素の列を RGBA にそろえる(RGB なら alpha を 255 にする)。全画素が不透明かも返す。 */
function toRgba(pixels: Buffer, channels: 3 | 4): { rgba: Buffer; opaque: boolean } {
  if (channels === 4) return { rgba: pixels, opaque: pixels.every((value, i) => i % 4 !== 3 || value === 255) };
  const rgba = Buffer.alloc((pixels.length / 3) * 4, 255);
  for (let i = 0; i < pixels.length / 3; i += 1) pixels.copy(rgba, i * 4, i * 3, i * 3 + 3);
  return { rgba, opaque: true };
}

/** PNG の大きさ(IHDR の幅と高さ)だけを読む。画素は復号しないので、巨大な画像でも軽い。 */
export function readPngSize(png: Buffer): { width: number; height: number } {
  if (!png.subarray(0, SIGNATURE.length).equals(SIGNATURE)) throw new Error('PNG ではありません');
  const ihdr = chunksOf(png).find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('PNG に IHDR がありません');
  return { width: ihdr.data.readUInt32BE(0), height: ihdr.data.readUInt32BE(4) };
}

/** PNG(8 ビットの RGB か RGBA。インターレースなし)を復号する。 */
export function decodePng(png: Buffer): DecodedPng {
  if (!png.subarray(0, SIGNATURE.length).equals(SIGNATURE)) throw new Error('PNG ではありません');
  const chunks = chunksOf(png);
  const header = parseHeader(chunks.find((c) => c.type === 'IHDR')?.data);
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const pixels = unfilter(inflateSync(idat), header);
  return { width: header.width, height: header.height, ...toRgba(pixels, header.channels) };
}

/** (x, y) の画素の色(RGBA)。範囲外は例外にする。 */
export function pixelAt(png: DecodedPng, x: number, y: number): Rgba {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= png.width || y >= png.height) {
    throw new RangeError(`画像(${png.width} × ${png.height})の外の座標です: (${x}, ${y})`);
  }
  const at = (y * png.width + x) * 4;
  return [png.rgba[at], png.rgba[at + 1], png.rgba[at + 2], png.rgba[at + 3]] as unknown as Rgba;
}
