/** ドロップされたものへの対応: 何もしない、読み込む、拒否する(エラーを出す)。 */
export type DropAction = 'ignore' | 'choose' | 'reject';

/** ドロップされたファイルの本数から、することを決める。0 本(と不正な本数)は何もせず、1 本は読み込み、複数は拒否する。 */
export function dropAction(fileCount: number): DropAction {
  if (!Number.isInteger(fileCount) || fileCount < 1) return 'ignore';
  return fileCount === 1 ? 'choose' : 'reject';
}
