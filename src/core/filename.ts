// 元のファイル名が空(拡張子だけ)のときに使う名前
export const FALLBACK_BASE_NAME = 'aligned';

/** ダウンロードする PNG のファイル名(<元の名前(.pdf なし)>-<列数>cols.png)を作る。 */
export function downloadFileName(originalName: string, columns: number): string {
  if (!Number.isInteger(columns) || columns < 1) throw new RangeError(`列数は 1 以上の整数: ${columns}`);
  const base = originalName.replace(/\.pdf$/i, '').trim() || FALLBACK_BASE_NAME;
  return `${base}-${columns}cols.png`;
}
