import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, pixelAt, readPngSize } from '../../e2e/helpers/png-decode.ts';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG のチャンク(長さ、種類、データ、CRC)を作る。 */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

/** IHDR チャンクを作る(ビット深度 8、インターレースなし。色の種類と圧縮は引数)。 */
function ihdr(width: number, height: number, colorType: number, bitDepth = 8, interlace = 0): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.set([bitDepth, colorType, 0, 0, interlace], 8);
  return chunk('IHDR', data);
}

/** Paeth 予測(PNG の仕様どおり)。 */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** 1 行を、指定したフィルタ(0〜4)で符号化する(仕様の定義から書いた、復号とは独立な符号化)。 */
function filterRow(type: number, row: number[], above: number[], bpp: number): number[] {
  const out = row.map((value, i) => {
    const left = i >= bpp ? (row[i - bpp] as number) : 0;
    const up = above[i] as number;
    const upLeft = i >= bpp ? (above[i - bpp] as number) : 0;
    const predictors = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, upLeft)];
    return (value - (predictors[type] as number) + 256) % 256;
  });
  return [type, ...out];
}

/** 画素(行ごとの成分の配列)から、指定したフィルタの列で符号化した PNG を作る。 */
function makePng(rows: number[][], colorType: 2 | 6, filters: number[]): Buffer {
  const channels = colorType === 2 ? 3 : 4;
  const width = (rows[0] as number[]).length / channels;
  const zero = new Array<number>((rows[0] as number[]).length).fill(0);
  const filtered = rows.flatMap((row, y) => filterRow(filters[y % filters.length] as number, row, y > 0 ? (rows[y - 1] as number[]) : zero, channels));
  const idat = chunk('IDAT', deflateSync(Buffer.from(filtered)));
  return Buffer.concat([SIGNATURE, ihdr(width, rows.length, colorType), idat, chunk('IEND', Buffer.alloc(0))]);
}

const RGB_ROWS = [
  [255, 0, 0, 0, 255, 0, 0, 0, 255],
  [10, 20, 30, 40, 50, 60, 70, 80, 90],
  [200, 100, 50, 25, 12, 6, 3, 1, 0],
  [1, 2, 3, 250, 251, 252, 128, 129, 130],
];

describe('decodePng(E2E で、ダウンロードした PNG の画素を読むための復号)', () => {
  it('RGB(8 ビット)の大きさと画素を読む。alpha はないので不透明として扱う', () => {
    const png = decodePng(makePng(RGB_ROWS, 2, [0]));
    expect([png.width, png.height, png.opaque]).toEqual([3, 4, true]);
    expect(pixelAt(png, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(png, 2, 0)).toEqual([0, 0, 255, 255]);
    expect(pixelAt(png, 1, 1)).toEqual([40, 50, 60, 255]);
  });

  it.each([1, 2, 3, 4])('フィルタ %i(Sub、Up、Average、Paeth)で符号化された PNG も、元の画素に戻る', (filter) => {
    const png = decodePng(makePng(RGB_ROWS, 2, [filter]));
    expect(png.rgba).toEqual(decodePng(makePng(RGB_ROWS, 2, [0])).rgba);
  });

  it('行ごとに違うフィルタが混ざっていても、元の画素に戻る', () => {
    const png = decodePng(makePng(RGB_ROWS, 2, [4, 1, 3, 2]));
    expect(png.rgba).toEqual(decodePng(makePng(RGB_ROWS, 2, [0])).rgba);
  });

  it('RGBA を読む。alpha がすべて 255 なら不透明、1 つでも違えば不透明ではない', () => {
    const opaque = [[1, 2, 3, 255, 4, 5, 6, 255]];
    const translucent = [[1, 2, 3, 255, 4, 5, 6, 254]];
    expect(decodePng(makePng(opaque, 6, [0])).opaque).toBe(true);
    const png = decodePng(makePng(translucent, 6, [0]));
    expect(png.opaque).toBe(false);
    expect(pixelAt(png, 1, 0)).toEqual([4, 5, 6, 254]);
  });

  it('IDAT が複数に分かれていても読める', () => {
    const whole = makePng(RGB_ROWS, 2, [0]);
    const data = deflateSync(Buffer.from(RGB_ROWS.flatMap((row) => [0, ...row])));
    const split = Buffer.concat([
      SIGNATURE,
      ihdr(3, 4, 2),
      chunk('IDAT', data.subarray(0, 10)),
      chunk('IDAT', data.subarray(10)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    expect(decodePng(split).rgba).toEqual(decodePng(whole).rgba);
  });

  it('PNG でないデータ、対応しない形式(パレット、16 ビット、インターレース)は、例外にする', () => {
    expect(() => decodePng(Buffer.from('not a png'))).toThrow(/PNG/);
    const pal = Buffer.concat([SIGNATURE, ihdr(1, 1, 3), chunk('IEND', Buffer.alloc(0))]);
    expect(() => decodePng(pal)).toThrow(/対応/);
    const deep = Buffer.concat([SIGNATURE, ihdr(1, 1, 2, 16), chunk('IEND', Buffer.alloc(0))]);
    expect(() => decodePng(deep)).toThrow(/対応/);
    const interlaced = Buffer.concat([SIGNATURE, ihdr(1, 1, 2, 8, 1), chunk('IEND', Buffer.alloc(0))]);
    expect(() => decodePng(interlaced)).toThrow(/対応/);
  });

  it('未知のフィルタ種別は、例外にする', () => {
    const bad = Buffer.concat([
      SIGNATURE,
      ihdr(1, 1, 2),
      chunk('IDAT', deflateSync(Buffer.from([9, 1, 2, 3]))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    expect(() => decodePng(bad)).toThrow(/フィルタ/);
  });
});

describe('readPngSize(画素を復号せずに、大きさだけを読む。巨大な PNG の確認用)', () => {
  it('IHDR から、幅と高さを読む', () => {
    expect(readPngSize(makePng(RGB_ROWS, 2, [0]))).toEqual({ width: 3, height: 4 });
  });

  it('IDAT がなくても(IHDR だけでも)読める。大きな値(65,535 × 23,761)も読める', () => {
    const png = Buffer.concat([SIGNATURE, ihdr(65_535, 23_761, 2)]);
    expect(readPngSize(png)).toEqual({ width: 65_535, height: 23_761 });
  });

  it('PNG でないデータは、例外にする', () => {
    expect(() => readPngSize(Buffer.from('not a png at all, really'))).toThrow(/PNG/);
    expect(() => readPngSize(SIGNATURE)).toThrow(/IHDR/);
  });
});

describe('pixelAt', () => {
  it('範囲外の座標は、例外にする', () => {
    const png = decodePng(makePng(RGB_ROWS, 2, [0]));
    expect(() => pixelAt(png, 3, 0)).toThrow(RangeError);
    expect(() => pixelAt(png, 0, 4)).toThrow(RangeError);
    expect(() => pixelAt(png, -1, 0)).toThrow(RangeError);
  });
});
