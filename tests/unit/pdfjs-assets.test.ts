import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSET_FOLDERS } from '../../src/pdf/asset-paths.ts';
import { contentTypeOf, listAssetFiles, resolveAssetPath } from '../../tools/pdfjs-assets.ts';

const ROOT = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

describe('listAssetFiles(配信するファイルの一覧)', () => {
  const files = listAssetFiles(ROOT);

  it('CMap、標準フォント、wasm、ICC プロファイルのファイルを、フォルダ名つきの相対パス(スラッシュ区切り)で含む', () => {
    expect(files).toContain('cmaps/90ms-RKSJ-H.bcmap');
    expect(files).toContain('cmaps/Adobe-Japan1-UCS2.bcmap');
    expect(files).toContain('standard_fonts/FoxitSerif.pfb');
    expect(files).toContain('standard_fonts/LiberationSans-Regular.ttf');
    expect(files).toContain('wasm/jbig2.wasm');
    expect(files).toContain('wasm/openjpeg.wasm');
    expect(files).toContain('iccs/CGATS001Compat-v2-micro.icc');
  });

  it('配信するフォルダの外のファイル(build/ など)は含まない', () => {
    for (const file of files) expect(ASSET_FOLDERS).toContain(file.split('/')[0]);
  });

  it('付属のライセンス表記(LICENSE)も含む(配布物にライセンスを同梱するため)', () => {
    expect(files.some((file) => file.startsWith('wasm/LICENSE'))).toBe(true);
    expect(files).toContain('iccs/LICENSE');
    expect(files).toContain('cmaps/LICENSE');
    expect(files).toContain('standard_fonts/LICENSE_FOXIT');
    expect(files).toContain('standard_fonts/LICENSE_LIBERATION');
  });

  it('列挙した全てのファイルが、実在する', () => {
    for (const file of files) expect(existsSync(join(ROOT, file)), file).toBe(true);
  });
});

describe('resolveAssetPath(URL から、配信してよいファイルの場所を求める)', () => {
  it('/pdfjs/<フォルダ>/<ファイル> を、パッケージ内のファイルに対応づける', () => {
    expect(resolveAssetPath(ROOT, '/pdfjs/cmaps/90ms-RKSJ-H.bcmap', '/')).toBe(join(ROOT, 'cmaps', '90ms-RKSJ-H.bcmap'));
  });

  it('クエリ文字列は無視する', () => {
    expect(resolveAssetPath(ROOT, '/pdfjs/wasm/jbig2.wasm?v=1', '/')).toBe(join(ROOT, 'wasm', 'jbig2.wasm'));
  });

  it('サブパスで配信するときは、そのサブパスの下だけを対象にする', () => {
    expect(resolveAssetPath(ROOT, '/tools/pdfjs/cmaps/a.bcmap', '/tools/')).toBe(join(ROOT, 'cmaps', 'a.bcmap'));
    expect(resolveAssetPath(ROOT, '/pdfjs/cmaps/a.bcmap', '/tools/')).toBeNull();
  });

  it.each([
    ['上の階層をたどる', '/pdfjs/cmaps/../../package.json'],
    ['エンコードした上の階層', '/pdfjs/cmaps/%2e%2e/%2e%2e/package.json'],
    ['フォルダの手前でたどる', '/pdfjs/../package.json'],
    ['バックスラッシュでたどる', '/pdfjs/cmaps/..%5C..%5Cpackage.json'],
    ['NUL 文字', '/pdfjs/cmaps/a%00.bcmap'],
    ['配信対象でないフォルダ', '/pdfjs/build/pdf.mjs'],
    ['フォルダだけ', '/pdfjs/cmaps/'],
    ['フォルダ名だけ(末尾のスラッシュなし。ファイルの指定がない)', '/pdfjs/cmaps'],
    ['ルートだけ', '/pdfjs/'],
    ['別のパス', '/assets/index.js'],
    ['不正なエンコード', '/pdfjs/cmaps/%E0%A4%A'],
    ['空の区間', '/pdfjs/cmaps//x.bcmap'],
    ['.', '/pdfjs/cmaps/./x.bcmap'],
  ])('拒否する(null): %s', (_label, url) => {
    expect(resolveAssetPath(ROOT, url, '/')).toBeNull();
  });

  it('配信を許した場合の結果は、常にパッケージのフォルダの内側', () => {
    const resolved = resolveAssetPath(ROOT, '/pdfjs/standard_fonts/FoxitSerif.pfb', '/');
    expect(resolved?.startsWith(ROOT + sep)).toBe(true);
  });
});

describe('contentTypeOf(配信するときの Content-Type)', () => {
  it.each([
    ['wasm/jbig2.wasm', 'application/wasm'],
    ['wasm/quickjs-eval.js', 'text/javascript'],
    ['standard_fonts/LiberationSans-Regular.ttf', 'font/ttf'],
    ['cmaps/90ms-RKSJ-H.bcmap', 'application/octet-stream'],
    ['standard_fonts/FoxitSerif.pfb', 'application/octet-stream'],
    ['iccs/CGATS001Compat-v2-micro.icc', 'application/octet-stream'],
    ['iccs/LICENSE', 'text/plain; charset=utf-8'],
    ['wasm/LICENSE_OPENJPEG', 'text/plain; charset=utf-8'],
  ])('%s は %s', (file, expected) => {
    expect(contentTypeOf(file)).toBe(expected);
  });
});
