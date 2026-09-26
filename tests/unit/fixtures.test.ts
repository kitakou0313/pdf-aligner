import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from '@cantoo/pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, buildFixtures } from '../fixtures/build.ts';
import { writeFixtures } from '../fixtures/write.ts';
import { CJK_TEXT, CJK_TEXT_SJIS_HEX, ENCRYPTED_PASSWORD } from '../fixtures/spec.ts';

type Size = [number, number];
const A4: Size = [595, 842];
const A4_LANDSCAPE: Size = [842, 595];
const A3: Size = [842, 1191];

/** 同じ大きさのページが count 枚並ぶ期待値を作る。 */
function repeat(size: Size, count: number): Size[] {
  return Array.from({ length: count }, () => size);
}

/** PDF のバイト列を読み込み、各ページの [幅, 高さ] を返す。 */
async function pageSizes(bytes: Uint8Array, password?: string): Promise<Size[]> {
  const doc = await PDFDocument.load(bytes, password === undefined ? {} : { password });
  return doc.getPages().map((p): Size => [p.getWidth(), p.getHeight()]);
}

/** 16 進表記の文字列を、バイト列にする。 */
function bytesFromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

/** バイト列を、ASCII 文字列として読む(構造の確認用)。 */
function asText(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

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

describe('生成されるフィクスチャの一覧', () => {
  it('Q14 で決めた種類が、全て揃っている', () => {
    expect([...fixtures.keys()].sort()).toEqual([
      'broken-garbage.pdf',
      'broken-truncated.pdf',
      'cjk-non-embedded.pdf',
      'colored-12.pdf',
      'encrypted.pdf',
      'many-pages-150.pdf',
      'mixed-sizes.pdf',
      'not-a-pdf.txt',
      'single-page.pdf',
      'zero-pages.pdf',
    ]);
  });
});

describe('ページ数と各ページの大きさ', () => {
  const CASES: [string, Size[]][] = [
    ['colored-12.pdf', repeat(A4, 12)],
    ['mixed-sizes.pdf', [A4, A4_LANDSCAPE, A3]],
    ['many-pages-150.pdf', repeat(A4, 150)],
    ['single-page.pdf', [A4]],
    ['zero-pages.pdf', []],
    ['cjk-non-embedded.pdf', [A4]],
  ];

  it.each(CASES)('%s が、仕様どおりである', async (name, expected) => {
    expect(await pageSizes(get(name))).toEqual(expected);
  });
});

describe('異常系のフィクスチャ', () => {
  it('encrypted.pdf は暗号化されており、パスワードがあれば 3 ページ読める', async () => {
    const doc = await PDFDocument.load(get('encrypted.pdf'), { ignoreEncryption: true });
    expect(doc.isEncrypted).toBe(true);
    expect(await pageSizes(get('encrypted.pdf'), ENCRYPTED_PASSWORD)).toEqual(repeat(A4, 3));
  });

  it('encrypted.pdf は、パスワードなしでは読み込めない', async () => {
    await expect(PDFDocument.load(get('encrypted.pdf'))).rejects.toThrow();
  });

  it('broken-garbage.pdf は、PDF の見出しだけで、中身がオブジェクトではない', async () => {
    expect(asText(get('broken-garbage.pdf')).startsWith('%PDF-')).toBe(true);
    expect(asText(get('broken-garbage.pdf'))).not.toContain(' obj');
  });

  it('broken-truncated.pdf は、colored-12.pdf の先頭部分だけで、末尾の構造(startxref)がない', () => {
    const full = get('colored-12.pdf');
    const cut = get('broken-truncated.pdf');
    expect(cut.length).toBeLessThan(full.length);
    expect(cut).toEqual(full.slice(0, cut.length));
    expect(asText(cut)).not.toContain('startxref');
  });

  it('not-a-pdf.txt は、PDF の見出しで始まらない', () => {
    expect(asText(get('not-a-pdf.txt')).startsWith('%PDF')).toBe(false);
  });
});

describe('cjk-non-embedded.pdf(フォント非埋め込みの日本語)', () => {
  it('Type0 フォントと 90ms-RKSJ-H の CMap を使い、フォントのデータを埋め込んでいない', () => {
    const text = asText(get('cjk-non-embedded.pdf'));
    expect(text).toContain('/Subtype /Type0');
    expect(text).toContain('/Encoding /90ms-RKSJ-H');
    expect(text).not.toMatch(/\/FontFile/);
  });

  it('本文の 16 進文字列は、Shift_JIS として読むと CJK_TEXT になる', () => {
    expect(new TextDecoder('shift_jis').decode(bytesFromHex(CJK_TEXT_SJIS_HEX))).toBe(CJK_TEXT);
    expect(asText(get('cjk-non-embedded.pdf'))).toContain(`<${CJK_TEXT_SJIS_HEX}> Tj`);
  });
});

describe('再現性', () => {
  it('暗号化以外は、2 回生成しても同じバイト列になる', async () => {
    const again = await buildFixtures();
    for (const [name, bytes] of fixtures) {
      if (name !== 'encrypted.pdf') expect(again.get(name), name).toEqual(bytes);
    }
  });

  it('FIXTURE_NAMES は、生成される全てのファイル名と同じ順序で一致する', () => {
    expect([...fixtures.keys()]).toEqual([...FIXTURE_NAMES]);
  });
});

describe('writeFixtures(PDF は git 管理外なので、テストの開始時に生成して書き出す)', () => {
  const made: string[] = [];

  /** 空の一時ディレクトリを作り、後始末の対象に加える。 */
  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'pdf-aligner-fixtures-'));
    made.push(dir);
    return dir;
  }

  afterAll(async () => {
    await Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('全てのフィクスチャを指定したディレクトリに書き出し、名前の一覧を返す(暗号化以外は生成結果と同じ)', async () => {
    const dir = await tempDir();
    expect((await writeFixtures(dir)).sort()).toEqual([...FIXTURE_NAMES].sort());
    for (const [name, bytes] of fixtures) {
      if (name === 'encrypted.pdf') continue;
      expect(new Uint8Array(await readFile(join(dir, name))), name).toEqual(bytes);
    }
  });

  it('存在しないディレクトリも作る', async () => {
    const dir = join(await tempDir(), 'nested', 'fixtures');
    await writeFixtures(dir);
    expect((await readFile(join(dir, 'not-a-pdf.txt'))).length).toBeGreaterThan(0);
  });

  it('既存のファイルは、最新の内容で上書きする(古い内容が残らない)', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'single-page.pdf'), 'stale');
    await writeFixtures(dir);
    expect(new Uint8Array(await readFile(join(dir, 'single-page.pdf')))).toEqual(get('single-page.pdf'));
  });

  it('書き出した encrypted.pdf は、暗号化されており、パスワードで読める', async () => {
    const dir = await tempDir();
    await writeFixtures(dir);
    const bytes = new Uint8Array(await readFile(join(dir, 'encrypted.pdf')));
    expect(await pageSizes(bytes, ENCRYPTED_PASSWORD)).toEqual(repeat(A4, 3));
  });
});
