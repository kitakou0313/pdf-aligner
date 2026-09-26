import { describe, expect, it } from 'vitest';
import { ASSET_FOLDERS, ASSET_ROOT, assetUrls } from '../../../src/pdf/asset-paths.ts';

describe('assetUrls(pdf.js の付属アセットを、同一オリジンのどこから読むか)', () => {
  it('ルート配信では、/pdfjs/ の下の各フォルダを、末尾のスラッシュつきで指す', () => {
    expect(assetUrls('/')).toEqual({
      cMapUrl: '/pdfjs/cmaps/',
      standardFontDataUrl: '/pdfjs/standard_fonts/',
      wasmUrl: '/pdfjs/wasm/',
      iccUrl: '/pdfjs/iccs/',
    });
  });

  it('サブパスで配信するときも、その下を指す', () => {
    expect(assetUrls('/tools/aligner/').cMapUrl).toBe('/tools/aligner/pdfjs/cmaps/');
  });

  it('全ての URL は同一オリジン(絶対 URL ではなく、スラッシュ始まりのパス)で、末尾がスラッシュ', () => {
    for (const url of Object.values(assetUrls('/'))) {
      expect(url).toMatch(/^\/[^/].*\/$/);
      expect(url).not.toMatch(/^[a-z]+:/i);
    }
  });

  it('配信するフォルダは、CMap、標準フォント、wasm、ICC プロファイルの 4 つ', () => {
    expect([...ASSET_FOLDERS]).toEqual(['cmaps', 'standard_fonts', 'wasm', 'iccs']);
    expect(ASSET_ROOT).toBe('pdfjs');
  });
});
