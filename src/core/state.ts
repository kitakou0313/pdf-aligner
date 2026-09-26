import { DEFAULT_COLUMNS, defaultColumns } from './columns.ts';
import {
  ERROR_TEXT,
  LOADING_TEXT,
  formatFailedPages,
  formatProgress,
  formatShrinkNotice,
  type AppError,
} from './messages.ts';

/** 画面の状態: 未読み込み、読み込み中、描画中、完了。 */
export type Phase = 'idle' | 'loading' | 'rendering' | 'ready';

/** 自動縮小したときの、実際の倍率と画像の大きさ。 */
export interface ShrinkInfo {
  readonly scale: number;
  readonly width: number;
  readonly height: number;
}

/** 描画の進捗(処理したページ数 / 総ページ数)。 */
export interface Progress {
  readonly done: number;
  readonly total: number;
}

/** アプリ全体の状態。View は個別のフラグを持たず、ここから導く。 */
export interface AppState {
  readonly phase: Phase;
  readonly fileName: string | null;
  readonly pageCount: number;
  readonly columns: number;
  readonly progress: Progress;
  readonly shrink: ShrinkInfo | null;
  readonly failedPages: readonly number[];
  readonly error: AppError | null;
}

/** 状態を変えるイベント。 */
export type AppEvent =
  | { readonly type: 'fileChosen'; readonly fileName: string }
  | { readonly type: 'loadFailed'; readonly error: 'encrypted' | 'invalid' }
  | { readonly type: 'loaded'; readonly pageCount: number }
  | { readonly type: 'columnsChanged'; readonly columns: number }
  | { readonly type: 'layoutPlanned'; readonly scale: number; readonly width: number; readonly height: number; readonly shrunk: boolean }
  | { readonly type: 'progress'; readonly done: number; readonly total: number }
  | { readonly type: 'renderFinished'; readonly failedPages: readonly number[] }
  | { readonly type: 'renderFailed' }
  | { readonly type: 'dropRejected' }
  | { readonly type: 'pngFailed' };

/** 各操作の可否(blueprint の「画面の状態と操作の可否」)。 */
export interface UiFlags {
  readonly pick: boolean;
  readonly columns: boolean;
  readonly zoom: boolean;
  readonly download: boolean;
}

/** ステータス行の 1 行(種類と文言)。 */
export interface StatusLine {
  readonly kind: 'progress' | 'notice' | 'warning' | 'error';
  readonly text: string;
}

export const INITIAL_STATE: AppState = {
  phase: 'idle',
  fileName: null,
  pageCount: 0,
  columns: DEFAULT_COLUMNS,
  progress: { done: 0, total: 0 },
  shrink: null,
  failedPages: [],
  error: null,
};

type EventOf<T extends AppEvent['type']> = Extract<AppEvent, { type: T }>;
type Handlers = { [T in AppEvent['type']]: (state: AppState, event: EventOf<T>) => AppState };

/** PDF を選ぶと、どの状態からでも、全ての状態を置き換えて loading になる。 */
function onFileChosen(_state: AppState, event: EventOf<'fileChosen'>): AppState {
  return { ...INITIAL_STATE, phase: 'loading', fileName: event.fileName };
}

/** 読み込みに失敗したら、未読み込みに戻ってエラーだけを残す。 */
function onLoadFailed(state: AppState, event: EventOf<'loadFailed'>): AppState {
  return state.phase === 'loading' ? { ...INITIAL_STATE, error: event.error } : state;
}

/** 読み込めたら描画中になる。ページが 0 枚なら、未読み込みに戻って「ページがありません」。 */
function onLoaded(state: AppState, event: EventOf<'loaded'>): AppState {
  if (state.phase !== 'loading') return state;
  const { pageCount } = event;
  if (!Number.isInteger(pageCount) || pageCount < 1) return { ...INITIAL_STATE, error: 'empty' };
  const progress = { done: 0, total: pageCount };
  return { ...state, phase: 'rendering', pageCount, columns: defaultColumns(pageCount), progress };
}

/** 列数の変更は、描画中か完了のときだけ受け付け、範囲外や同じ値は無視する。変更したら描き直す。 */
function onColumnsChanged(state: AppState, event: EventOf<'columnsChanged'>): AppState {
  const { columns } = event;
  const active = state.phase === 'rendering' || state.phase === 'ready';
  const valid = Number.isInteger(columns) && columns >= 1 && columns <= state.pageCount;
  if (!active || !valid || columns === state.columns) return state;
  const progress = { done: 0, total: state.pageCount };
  return { ...state, phase: 'rendering', columns, progress, shrink: null, failedPages: [], error: null };
}

/** 描画するレイアウトが決まったら、縮小したときだけ、その情報を持つ。 */
function onLayoutPlanned(state: AppState, event: EventOf<'layoutPlanned'>): AppState {
  if (state.phase !== 'rendering') return state;
  const { scale, width, height, shrunk } = event;
  return { ...state, shrink: shrunk ? { scale, width, height } : null };
}

/** 描画中の進捗を更新する。 */
function onProgress(state: AppState, event: EventOf<'progress'>): AppState {
  if (state.phase !== 'rendering') return state;
  return { ...state, progress: { done: event.done, total: event.total } };
}

/** 描画が終わったら完了になり、失敗したページを持つ。 */
function onRenderFinished(state: AppState, event: EventOf<'renderFinished'>): AppState {
  if (state.phase !== 'rendering') return state;
  const progress = { done: state.pageCount, total: state.pageCount };
  return { ...state, phase: 'ready', progress, failedPages: [...event.failedPages] };
}

/** 描画そのものが失敗したら(ページ単位ではなく全体の失敗)、未読み込みに戻って「読み込めなかった」エラーだけを残す。 */
function onRenderFailed(state: AppState): AppState {
  return state.phase === 'rendering' ? { ...INITIAL_STATE, error: 'invalid' } : state;
}

/** 複数ファイルのドロップは拒否する。状態はそのままで、エラーだけを付ける。 */
function onDropRejected(state: AppState): AppState {
  return { ...state, error: 'multipleFiles' };
}

/** PNG を生成できなかったら、完了のまま、エラーだけを付ける。 */
function onPngFailed(state: AppState): AppState {
  return state.phase === 'ready' ? { ...state, error: 'pngFailed' } : state;
}

const HANDLERS: Handlers = {
  fileChosen: onFileChosen,
  loadFailed: onLoadFailed,
  loaded: onLoaded,
  columnsChanged: onColumnsChanged,
  layoutPlanned: onLayoutPlanned,
  progress: onProgress,
  renderFinished: onRenderFinished,
  renderFailed: onRenderFailed,
  dropRejected: onDropRejected,
  pngFailed: onPngFailed,
};

/** 状態にイベントを適用した、新しい状態を返す(状態は書き換えない。状況に合わない古いイベントは無視する)。 */
export function reduce(state: AppState, event: AppEvent): AppState {
  const handler = HANDLERS[event.type] as (s: AppState, e: AppEvent) => AppState;
  return handler(state, event);
}

const FLAGS: Readonly<Record<Phase, UiFlags>> = {
  idle: { pick: true, columns: false, zoom: false, download: false },
  loading: { pick: true, columns: false, zoom: false, download: false },
  rendering: { pick: true, columns: true, zoom: true, download: false },
  ready: { pick: true, columns: true, zoom: true, download: true },
};

/** 状態から、各操作の可否を導く。 */
export function uiFlags(state: AppState): UiFlags {
  return FLAGS[state.phase];
}

/** 読み込み中と描画中の、進捗の行を作る。 */
function progressLines(state: AppState): StatusLine[] {
  if (state.phase === 'loading') return [{ kind: 'progress', text: LOADING_TEXT }];
  if (state.phase !== 'rendering') return [];
  return [{ kind: 'progress', text: formatProgress(state.progress.done, state.progress.total) }];
}

/** 自動縮小の通知と、描画に失敗したページの警告の行を作る。 */
function noticeLines(state: AppState): StatusLine[] {
  const lines: StatusLine[] = [];
  if (state.shrink) {
    const { scale, width, height } = state.shrink;
    lines.push({ kind: 'notice', text: formatShrinkNotice(scale, width, height) });
  }
  if (state.failedPages.length > 0) lines.push({ kind: 'warning', text: formatFailedPages(state.failedPages) });
  return lines;
}

/** ステータス行に出すメッセージを、進捗 → 通知 → 警告 → エラーの順で返す。 */
export function statusLines(state: AppState): StatusLine[] {
  const error: StatusLine[] = state.error ? [{ kind: 'error', text: ERROR_TEXT[state.error] }] : [];
  return [...progressLines(state), ...noticeLines(state), ...error];
}
