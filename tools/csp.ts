import type { HtmlTagDescriptor, Plugin } from 'vite';

// 外部への通信をブラウザ側でも禁止する CSP。許可元は同一オリジンを基本にする。
//  - script-src の wasm-unsafe-eval は、pdf.js の wasm デコーダ(JBIG2 / JPEG2000)のために必要
//  - style-src にインラインを許可しない。見た目は CSS ファイルと CSSOM の操作で作る
const DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
];

export const CSP = DIRECTIVES.join('; ');

/** CSP の meta タグを、Vite の HTML 変換が受け取る形で作る。 */
function cspTags(): HtmlTagDescriptor[] {
  const attrs = { 'http-equiv': 'Content-Security-Policy', content: CSP };
  return [{ tag: 'meta', attrs, injectTo: 'head-prepend' }];
}

/** ビルド時に、index.html の head の先頭へ CSP の meta タグを差し込む Vite プラグイン。 */
export function injectCsp(): Plugin {
  return { name: 'inject-csp', apply: 'build', transformIndexHtml: cspTags };
}
