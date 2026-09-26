const RUN_DIR_PATTERN = /^\d{8}-\d{6}$/;
const MAX_SEGMENT_LENGTH = 80;

/** 数値を 2 桁のゼロ埋め文字列にする。 */
function two(value: number): string {
  return String(value).padStart(2, '0');
}

/** 実行日時から、実行ごとのディレクトリ名(YYYYMMDD-HHmmss)を作る。名前の辞書順が時系列になる。 */
export function runDirName(date: Date): string {
  const day = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}`;
  const time = `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
  return `${day}-${time}`;
}

/** 実行ディレクトリの名前のうち、新しい keep 個を超えて古いものを返す。形式に合わない名前は対象外。 */
export function runsToDelete(names: readonly string[], keep: number): string[] {
  const runs = names.filter((name) => RUN_DIR_PATTERN.test(name)).sort();
  return runs.slice(0, Math.max(0, runs.length - keep));
}

/** テスト名を、ディレクトリ名として安全な 1 要素にする(区切りや記号はハイフンにまとめ、80 文字まで)。 */
export function safeSegment(text: string): string {
  const cleaned = text.replace(/[^\p{L}\p{N}_]+/gu, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, MAX_SEGMENT_LENGTH).replace(/-+$/g, '') || 'untitled';
}

/** スクリーンショットの保存先(実行ディレクトリ/テスト名/連番-ステップ名.png)を作る。 */
export function screenshotPath(root: string, runId: string, testTitle: string, index: number, step: string): string {
  const file = `${two(index)}-${safeSegment(step)}.png`;
  return [root, runId, safeSegment(testTitle), file].join('/');
}
