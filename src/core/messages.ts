// ステータス行に出すエラーの種類
export type AppError = 'encrypted' | 'invalid' | 'empty' | 'multipleFiles' | 'pngFailed';

// blueprint の F8(メッセージ一覧)と一致させる。一致は単体テストが確かめる
export const ERROR_TEXT: Readonly<Record<AppError, string>> = {
  encrypted: 'パスワードで保護された PDF には対応していません。',
  invalid: 'PDF を読み込めませんでした。ファイルが壊れているか、PDF ではない可能性があります。',
  empty: 'ページがありません。',
  multipleFiles: 'PDF は 1 ファイルだけ指定してください。',
  pngFailed: '画像が大きすぎて PNG を生成できませんでした。列数を変更するか、PDF を分割してお試しください。',
};

export const LOADING_TEXT = '読み込み中…';

/** 描画の進捗(描画中 N/M ページ)の文言を作る。 */
export function formatProgress(done: number, total: number): string {
  return `描画中 ${done}/${total} ページ`;
}

/** 数を 3 桁区切りの文字列にする(表示が環境に依存しないよう、ロケールを固定する)。 */
function withCommas(value: number): string {
  return value.toLocaleString('en-US');
}

/** 自動縮小の通知の文言を作る。倍率は小数 2 桁までで、末尾の 0 は省く。 */
export function formatShrinkNotice(scale: number, width: number, height: number): string {
  const shown = Number(scale.toFixed(2));
  const size = `${withCommas(width)} × ${withCommas(height)} px`;
  return `画像が大きいため縮小しました。実際の倍率 ${shown}倍(${size})`;
}

/** 描画に失敗したページ(0 始まり)の警告の文言を作る。失敗がなければ空の文字列。 */
export function formatFailedPages(indexes: readonly number[]): string {
  const pages = [...new Set(indexes)].sort((a, b) => a - b).map((index) => index + 1);
  if (pages.length === 0) return '';
  return `${pages.length} ページの描画に失敗しました(ページ: ${pages.join(', ')})`;
}
