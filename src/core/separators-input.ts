import { COLUMNS_DEBOUNCE_MS, debounce, type Debounced } from './debounce.ts';
import { formatSeparators, liveSeparators, parseSeparators, sameSeparators } from './separators.ts';

/** 区切りの入力欄が頼る外部。state は今の総ページ数と区切り、apply は区切りの反映、write は欄への書き戻し。 */
export interface SeparatorsInputDeps {
  readonly state: () => { readonly pageCount: number; readonly separators: readonly number[] };
  readonly apply: (separators: number[]) => void;
  readonly write: (text: string) => void;
  readonly delayMs?: number;
}

/** 区切りの入力欄の 2 つの操作: 入力の途中と、確定(フォーカスを外す、Enter)。 */
export interface SeparatorsInput {
  onInput(raw: string): void;
  onCommit(raw: string): void;
}

/** 入力の途中: 全ての項目が有効なら、待ち時間の後に反映する。そうでなければ、待っていた反映を取り消す。 */
function handleInput(deps: SeparatorsInputDeps, pending: Debounced<[number[]]>, raw: string): void {
  const separators = liveSeparators(raw, deps.state().pageCount);
  if (separators === null) pending.cancel();
  else pending(separators);
}

/** 確定: 待っていた反映を取り消し、有効なページ番号だけに整えて欄に書き戻す。今の区切りと違うときだけ、すぐに反映する。 */
function handleCommit(deps: SeparatorsInputDeps, pending: Debounced<[number[]]>, raw: string): void {
  pending.cancel();
  const { pageCount, separators: current } = deps.state();
  const separators = parseSeparators(raw, pageCount);
  deps.write(formatSeparators(separators));
  if (!sameSeparators(separators, current)) deps.apply(separators);
}

/**
 * 区切りの入力欄の規則を作る(列数の入力欄と同じ流儀)。入力の途中は、全ての項目が有効なときだけ、
 * 短い待ち時間の後に反映する(連続した入力は最後の値だけ)。確定したときは、有効なページ番号だけに整えて
 * (昇順、重複なし)欄に書き戻し、待たずに反映する。空欄は「区切りなし」。エラーは表示しない。
 */
export function createSeparatorsInput(deps: SeparatorsInputDeps): SeparatorsInput {
  /** 待ち時間の後に、今の区切りと違うときだけ反映する。 */
  const applyIfChanged = (separators: number[]): void => {
    if (!sameSeparators(separators, deps.state().separators)) deps.apply(separators);
  };
  const pending = debounce(applyIfChanged, deps.delayMs ?? COLUMNS_DEBOUNCE_MS);
  return {
    /** 入力の途中の値を扱う。 */
    onInput: (raw) => handleInput(deps, pending, raw),
    /** 確定した値を扱う。 */
    onCommit: (raw) => handleCommit(deps, pending, raw),
  };
}
