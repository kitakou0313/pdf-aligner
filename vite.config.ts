import { defineConfig } from 'vite';
import { injectCsp } from './tools/csp.ts';
import { pdfjsAssets } from './tools/pdfjs-assets.ts';

// ビルドする成果物にだけ CSP を埋め込む(Q2: 通信ゼロを、ブラウザ側でも強制する)。
// pdf.js の付属アセット(CMap、標準フォント、wasm)は、外部の CDN ではなく、同一オリジンから配信する(Q9)
export default defineConfig({
  plugins: [injectCsp(), pdfjsAssets()],
});
