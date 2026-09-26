import { describe, expect, it } from 'vitest';
import { externalUrls } from '../../e2e/helpers/net-guard.ts';

describe('externalUrls(localhost 以外への通信を洗い出す)', () => {
  const INTERNAL = [
    'http://localhost:4173/',
    'http://localhost:4173/assets/index-abc123.js',
    'http://LOCALHOST:80/',
    'ws://localhost:4173/',
    'data:image/png;base64,iVBORw0KGgo=',
    'blob:http://localhost:4173/3f2a-11ee',
    'about:blank',
  ];
  const EXTERNAL = [
    'http://127.0.0.1:4173/',
    'http://[::1]:4173/',
    'https://fonts.googleapis.com/css',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist/build/pdf.mjs',
    'http://localhost.evil.example/',
    'http://evil.example/localhost',
    'wss://example.com/socket',
  ];

  it.each(INTERNAL)('%s は、内部として扱う', (url) => {
    expect(externalUrls([url])).toEqual([]);
  });

  it.each(EXTERNAL)('%s は、外部として検出する', (url) => {
    expect(externalUrls([url])).toEqual([url]);
  });

  it('解釈できない URL は、安全側に倒して外部として扱う', () => {
    expect(externalUrls(['not a url'])).toEqual(['not a url']);
  });

  it('混在した一覧から、外部だけを順序を保って返す', () => {
    const urls = ['http://localhost:4173/', 'https://a.example/', 'about:blank', 'https://b.example/'];
    expect(externalUrls(urls)).toEqual(['https://a.example/', 'https://b.example/']);
  });

  it('空の一覧は、空を返す', () => {
    expect(externalUrls([])).toEqual([]);
  });
});
