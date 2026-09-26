import { describe, expect, it } from 'vitest';
import { CSP, injectCsp } from '../../tools/csp.ts';

/** CSP の文字列を、ディレクティブ名 → 許可元の一覧の対応表にする。 */
function parse(csp: string): Map<string, string[]> {
  const entries = csp.split(';').map((part) => part.trim().split(/\s+/));
  return new Map(entries.map(([name, ...sources]) => [name ?? '', sources]));
}

describe('CSP(外部への通信をブラウザ側で禁止する)', () => {
  const directives = parse(CSP);

  it('既定の取得先も、通信先(fetch など)も、同一オリジンだけにする', () => {
    expect(directives.get('default-src')).toEqual(["'self'"]);
    expect(directives.get('connect-src')).toEqual(["'self'"]);
  });

  it('外部のホスト名、ワイルドカード、http(s)/ws(s) のスキームを、どの許可元にも含めない', () => {
    for (const [name, sources] of directives) {
      for (const source of sources) {
        expect(source, `${name}: ${source}`).not.toMatch(/^(\*|https?:|wss?:|[a-z0-9.-]+\.[a-z]{2,})/i);
      }
    }
  });

  it('プラグイン、フォーム送信、base 要素による書き換えを許さない', () => {
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('form-action')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'self'"]);
  });

  it('スクリプトは同一オリジンと wasm だけで、インラインや eval を許さない', () => {
    expect(directives.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
  });

  it('Worker は、同一オリジンか blob だけ', () => {
    expect(directives.get('worker-src')).toEqual(["'self'", 'blob:']);
  });
});

describe('injectCsp(Vite プラグイン)', () => {
  const plugin = injectCsp();

  it('ビルドのときだけ動く(HMR がインライン script を使う dev サーバーには付けない)', () => {
    expect(plugin.apply).toBe('build');
  });

  it('index.html の head の先頭に、CSP の meta タグを差し込む', () => {
    const transform = plugin.transformIndexHtml as () => unknown;
    expect(transform()).toEqual([
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
        injectTo: 'head-prepend',
      },
    ]);
  });
});
