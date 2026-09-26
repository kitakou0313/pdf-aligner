import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, basename } from 'node:path';
import type { Plugin, Rollup } from 'vite';
import { ASSET_FOLDERS, ASSET_ROOT } from '../src/pdf/asset-paths.ts';

// 拡張子ごとの Content-Type(ここにないファイルは application/octet-stream)
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.ttf': 'font/ttf',
};
const TEXT_TYPE = 'text/plain; charset=utf-8';
const BINARY_TYPE = 'application/octet-stream';

/** pdfjs-dist パッケージのディレクトリ(node_modules の中のどこにあっても、解決して求める)。 */
function packageRoot(): string {
  return dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
}

/** 配信するフォルダの下の全ファイルを、フォルダ名つきの相対パス(スラッシュ区切り)で列挙する。 */
export function listAssetFiles(root: string): string[] {
  return ASSET_FOLDERS.flatMap((folder) => {
    const entries = readdirSync(join(root, folder), { recursive: true, withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => `${folder}/${relativeTo(join(root, folder), entry)}`);
  });
}

/** ディレクトリ内のファイルの、そのディレクトリからの相対パス(スラッシュ区切り)。 */
function relativeTo(dir: string, entry: { parentPath: string; name: string }): string {
  return join(entry.parentPath, entry.name).slice(dir.length + 1).split('\\').join('/');
}

/** 配信するときの Content-Type。ライセンス表記はテキスト、wasm と TrueType は専用の型、他はバイナリ。 */
export function contentTypeOf(file: string): string {
  if (basename(file).startsWith('LICENSE')) return TEXT_TYPE;
  return CONTENT_TYPES[extname(file)] ?? BINARY_TYPE;
}

/** URL の各区間をデコードする。デコードできない(不正なエンコード)なら null。 */
function decodeSegments(path: string): string[] | null {
  try {
    return path.split('/').map(decodeURIComponent);
  } catch {
    return null;
  }
}

/** 区間が、ファイル名として安全でない(空、「.」、「..」、区切りや NUL を含む)かどうか。 */
function isUnsafeSegment(segment: string): boolean {
  return segment === '' || segment === '.' || segment === '..' || /[/\\\0]/.test(segment);
}

/**
 * リクエストの URL を、配信してよいファイルの場所に対応づける。対象は <base>pdfjs/<配信フォルダ>/<ファイル> だけで、
 * それ以外(上の階層へのたどり、配信対象外のフォルダ、不正なエンコードなど)は null。存在の確認は行わない。
 */
export function resolveAssetPath(root: string, url: string, base: string): string | null {
  const path = url.split(/[?#]/)[0] ?? '';
  const prefix = `${base}${ASSET_ROOT}/`;
  if (!path.startsWith(prefix)) return null;
  const segments = decodeSegments(path.slice(prefix.length));
  if (!segments || segments.length < 2 || segments.some(isUnsafeSegment)) return null;
  return (ASSET_FOLDERS as readonly string[]).includes(segments[0] as string) ? join(root, ...segments) : null;
}

/** 開発サーバーで、付属アセットを配信するミドルウェアを作る(対象外の URL や存在しないファイルは、次に回す)。 */
function assetMiddleware(root: string, base: () => string): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req, res, next) => {
    const file = resolveAssetPath(root, req.url ?? '', base());
    if (!file || !existsSync(file) || !statSync(file).isFile()) return next();
    res.setHeader('Content-Type', contentTypeOf(file));
    createReadStream(file).pipe(res);
  };
}

/** ビルドの成果物に、付属アセット(とライセンス表記)を出力する。 */
function emitAssets(this: Rollup.PluginContext): void {
  const root = packageRoot();
  for (const file of listAssetFiles(root)) {
    this.emitFile({ type: 'asset', fileName: `${ASSET_ROOT}/${file}`, source: readFileSync(join(root, file)) });
  }
}

/**
 * pdf.js の付属アセット(CMap、標準フォント、wasm、ICC)を、同一オリジンから配信する Vite プラグイン。
 * 開発サーバーではミドルウェアで配信し、ビルドでは成果物の pdfjs/ に出力する。外部の CDN は使わない。
 */
export function pdfjsAssets(): Plugin {
  let base = '/';
  return {
    name: 'pdfjs-assets',
    /** 解決された設定から、配信のルート(base)を覚える。 */
    configResolved: (config) => void (base = config.base),
    /** 開発サーバーに、アセットの配信を足す。 */
    configureServer: (server) => void server.middlewares.use(assetMiddleware(packageRoot(), () => base)),
    generateBundle: emitAssets,
  };
}
