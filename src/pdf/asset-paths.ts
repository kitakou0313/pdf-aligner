// pdf.js の付属アセット(pdfjs-dist パッケージ内のフォルダ)を、成果物の中で配信する場所。
// アプリ(URL の指定)と、Vite プラグイン(配信・出力)の両方が使うので、依存のない小さなファイルに置く。

/** 成果物のルートから見た、配信先のディレクトリ名。 */
export const ASSET_ROOT = 'pdfjs';

/** 配信するフォルダ: CMap、標準フォント、wasm デコーダ、ICC プロファイル。 */
export const ASSET_FOLDERS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'] as const;

/** pdf.js の getDocument に渡す、付属アセットの URL(どれも同一オリジンで、末尾がスラッシュ)。 */
export interface AssetUrls {
  readonly cMapUrl: string;
  readonly standardFontDataUrl: string;
  readonly wasmUrl: string;
  readonly iccUrl: string;
}

/** baseUrl(Vite の BASE_URL。末尾がスラッシュ)の下の、各アセットフォルダの URL を作る。 */
export function assetUrls(baseUrl: string): AssetUrls {
  /** フォルダ名から、その URL を作る。 */
  const at = (folder: string): string => `${baseUrl}${ASSET_ROOT}/${folder}/`;
  return {
    cMapUrl: at('cmaps'),
    standardFontDataUrl: at('standard_fonts'),
    wasmUrl: at('wasm'),
    iccUrl: at('iccs'),
  };
}
