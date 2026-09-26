import { GlobalWorkerOptions, type getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { assetUrls } from './asset-paths.ts';

/** getDocument に渡す設定のうち、PDF のデータ以外。 */
export type DocumentOptions = Omit<NonNullable<Parameters<typeof getDocument>[0]>, 'data'>;

/** pdf.js の Worker を、成果物に含まれる同一オリジンのファイルから読み込むよう設定する(何度呼んでも同じ)。 */
export function configurePdfjs(): void {
  GlobalWorkerOptions.workerSrc = workerUrl;
}

/**
 * getDocument に渡す設定(PDF のデータを除く)。CMap、標準フォント、wasm、ICC プロファイルは、
 * 同一オリジンの pdfjs/ から読む(既定では読み込まれず、フォントを埋め込んでいない PDF の文字が化けるため)。
 * useSystemFonts を切るのは、Latin の標準フォントを、端末にあるフォントではなく同梱のデータに固定して、
 * 端末ごとの出力の違いをなくすため。日本語などのグリフは同梱していないので、ブラウザ(OS)のフォント代替で描かれる。
 */
export function documentOptions(): DocumentOptions {
  return { ...assetUrls(import.meta.env.BASE_URL), cMapPacked: true, useSystemFonts: false };
}
