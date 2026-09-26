import { liveColumns, normalizeColumns } from './columns.ts';
import { COLUMNS_DEBOUNCE_MS, debounce, type Debounced } from './debounce.ts';

/** 列数の入力欄が頼る外部。state は今の総ページ数と列数、apply は列数の反映、write は欄への書き戻し。 */
export interface ColumnsInputDeps {
  readonly state: () => { readonly pageCount: number; readonly columns: number };
  readonly apply: (columns: number) => void;
  readonly write: (columns: number) => void;
  readonly delayMs?: number;
}

/** 列数の入力欄の 2 つの操作: 入力の途中と、確定(フォーカスを外す、Enter)。 */
export interface ColumnsInput {
  onInput(raw: string): void;
  onCommit(raw: string): void;
}

/** 入力の途中: 反映してよい値なら、待ち時間の後に反映する。そうでなければ、待っていた反映を取り消す。 */
function handleInput(deps: ColumnsInputDeps, pending: Debounced<[number]>, raw: string): void {
  const columns = liveColumns(raw, deps.state().pageCount);
  if (columns === null) pending.cancel();
  else pending(columns);
}

/** 確定: 待っていた反映を取り消し、範囲内の整数に丸めて欄に書き戻す。今の列数と違うときだけ、すぐに反映する。 */
function handleCommit(deps: ColumnsInputDeps, pending: Debounced<[number]>, raw: string): void {
  pending.cancel();
  const { pageCount, columns: current } = deps.state();
  const columns = normalizeColumns(raw, pageCount, current);
  deps.write(columns);
  if (columns !== current) deps.apply(columns);
}

/**
 * 列数の入力欄の規則を作る。入力の途中は、反映してよい値だけを、短い待ち時間の後に反映する(連続した入力は最後の値だけ)。
 * 確定したときは、範囲内の整数に丸めて(空欄や数でなければ直前の値に戻して)欄に書き戻し、待たずに反映する。
 */
export function createColumnsInput(deps: ColumnsInputDeps): ColumnsInput {
  const pending = debounce(deps.apply, deps.delayMs ?? COLUMNS_DEBOUNCE_MS);
  return {
    /** 入力の途中の値を扱う。 */
    onInput: (raw) => handleInput(deps, pending, raw),
    /** 確定した値を扱う。 */
    onCommit: (raw) => handleCommit(deps, pending, raw),
  };
}
