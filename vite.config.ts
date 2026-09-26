import { defineConfig } from 'vite';
import { injectCsp } from './tools/csp.ts';

// ビルドする成果物にだけ CSP を埋め込む(Q2: 通信ゼロを、ブラウザ側でも強制する)
export default defineConfig({
  plugins: [injectCsp()],
});
