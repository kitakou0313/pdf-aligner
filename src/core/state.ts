import { DEFAULT_COLUMNS, defaultColumns } from './columns.ts';
import { imageFileName } from './filename.ts';
import {
  ERROR_TEXT,
  LOADING_TEXT,
  formatBatchCancelled,
  formatBatchFailed,
  formatBatchProgress,
  formatFailedPages,
  formatProgress,
  formatShrinkNotice,
  type AppError,
} from './messages.ts';
import { followedStart, isValidSeparators, segmentPageCount, segmentRange, segmentsOf, type Segment } from './segments.ts';
import { sameSeparators } from './separators.ts';

/** 画面の状態: 未読み込み、読み込み中、描画中、完了。 */
export type Phase = 'idle' | 'loading' | 'rendering' | 'ready';

/** 自動縮小したときの、実際の倍率と画像の大きさ。 */
export interface ShrinkInfo {
  readonly scale: number;
  readonly width: number;
  readonly height: number;
}

/** 描画の進捗(処理したページ数 / 表示中のセグメントのページ数)。 */
export interface Progress {
  readonly done: number;
  readonly total: number;
}

/** 一括保存の進捗: 処理中のセグメントの番号(0 始まり)、セグメントの個数、保存した個数。 */
export interface BatchProgress {
  readonly index: number;
  readonly total: number;
  readonly saved: number;
}

/** 一括保存を途中で止めた記録(警告に出す)。segment は、PNG を生成できなかったセグメント(キャンセルのときは null)。 */
export interface BatchStop {
  readonly reason: 'cancelled' | 'failed';
  readonly saved: number;
  readonly total: number;
  readonly segment: Segment | null;
}

/** アプリ全体の状態。View は個別のフラグを持たず、ここから導く。 */
export interface AppState {
  readonly phase: Phase;
  readonly fileName: string | null;
  readonly pageCount: number;
  readonly columns: number;
  /** 区切り(新しい画像の先頭にするページ。2〜総ページ数、昇順、重複なし)。空は「区切りなし」。 */
  readonly separators: readonly number[];
  /** 表示中のセグメントの先頭ページ(1 始まり)。必ず、いずれかのセグメントの先頭。 */
  readonly segmentStart: number;
  readonly progress: Progress;
  readonly shrink: ShrinkInfo | null;
  readonly failedPages: readonly number[];
  readonly error: AppError | null;
  /** 一括保存中なら、その進捗。 */
  readonly batch: BatchProgress | null;
  /** 直前の一括保存を、キャンセルまたは失敗で止めた記録。 */
  readonly batchStop: BatchStop | null;
}

/** 状態を変えるイベント。 */
export type AppEvent =
  | { readonly type: 'fileChosen'; readonly fileName: string }
  | { readonly type: 'loadFailed'; readonly error: 'encrypted' | 'invalid' }
  | { readonly type: 'loaded'; readonly pageCount: number }
  | { readonly type: 'columnsChanged'; readonly columns: number }
  | { readonly type: 'separatorsChanged'; readonly separators: readonly number[] }
  | { readonly type: 'segmentSelected'; readonly start: number }
  | { readonly type: 'layoutPlanned'; readonly scale: number; readonly width: number; readonly height: number; readonly shrunk: boolean }
  | { readonly type: 'progress'; readonly done: number; readonly total: number }
  | { readonly type: 'renderFinished'; readonly failedPages: readonly number[] }
  | { readonly type: 'renderFailed' }
  | { readonly type: 'dropRejected' }
  | { readonly type: 'pngFailed' }
  | { readonly type: 'batchStarted' }
  | { readonly type: 'batchProgressed'; readonly index: number; readonly saved: number }
  | { readonly type: 'batchFinished' }
  | { readonly type: 'batchStopped'; readonly reason: 'cancelled' | 'failed'; readonly index: number; readonly saved: number };

/** 各操作の可否(blueprint の「画面の状態と操作の可否」)。 */
export interface UiFlags {
  readonly pick: boolean;
  readonly columns: boolean;
  readonly separators: boolean;
  readonly segments: boolean;
  readonly zoom: boolean;
  readonly download: boolean;
  readonly downloadAll: boolean;
  /** 一括保存中の「キャンセル」(「すべてダウンロード」のボタンが、この役目になる)。 */
  readonly cancelBatch: boolean;
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
  separators: [],
  segmentStart: 1,
  progress: { done: 0, total: 0 },
  shrink: null,
  failedPages: [],
  error: null,
  batch: null,
  batchStop: null,
};

type EventOf<T extends AppEvent['type']> = Extract<AppEvent, { type: T }>;
type Handlers = { [T in AppEvent['type']]: (state: AppState, event: EventOf<T>) => AppState };

/** 今のセグメントの一覧(PDF を読み込むまでは空)。 */
export function segmentsOfState(state: AppState): Segment[] {
  return state.pageCount < 1 ? [] : segmentsOf(state.pageCount, state.separators);
}

/** 表示中のセグメント(PDF を読み込むまでは null)。 */
export function shownSegment(state: AppState): Segment | null {
  return segmentsOfState(state).find((segment) => segment.start === state.segmentStart) ?? null;
}

/** 表示中のセグメントの番号(0 始まり)。PDF を読み込むまでは -1。 */
export function shownIndex(state: AppState): number {
  return segmentsOfState(state).findIndex((segment) => segment.start === state.segmentStart);
}

/** 表示中のセグメントの画像を保存するときのファイル名(区切りなしのときは、従来の名前)。PDF を読み込んでいるときに使う。 */
export function shownImageName(state: AppState): string {
  return imageFileName(state.fileName ?? '', state.columns, segmentsOfState(state), shownIndex(state));
}

/** 表示中のセグメントのページ数(PDF を読み込むまでは 0)。 */
function shownPageCount(state: AppState): number {
  const segment = shownSegment(state);
  return segment ? segmentPageCount(segment) : 0;
}

/** 描画中か完了か(区切りや列数などの変更を受け付けられる状態)。 */
function isActive(state: AppState): boolean {
  return state.phase === 'rendering' || state.phase === 'ready';
}

/** 表示する画像を描き直す状態にする(描画中に戻し、進捗を 0 から数え直し、縮小・警告・エラーを消す)。 */
function restart(state: AppState): AppState {
  const progress = { done: 0, total: shownPageCount(state) };
  return { ...state, phase: 'rendering', progress, shrink: null, failedPages: [], error: null, batchStop: null };
}

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

/** 列数の変更は、描画中か完了のときだけ(一括保存中は除く)受け付け、範囲外や同じ値は無視する。変更したら描き直す。 */
function onColumnsChanged(state: AppState, event: EventOf<'columnsChanged'>): AppState {
  const { columns } = event;
  const valid = Number.isInteger(columns) && columns >= 1 && columns <= state.pageCount;
  if (!isActive(state) || state.batch || !valid || columns === state.columns) return state;
  return restart({ ...state, columns });
}

/**
 * 区切りの変更は、描画中か完了のときだけ(一括保存中は除く)受け付け、正規化されていない区切りや同じ区切りは無視する。
 * 変更したら、表示するセグメントを、直前に表示していたセグメントの先頭ページを含む新しいセグメントに追従させて、描き直す。
 */
function onSeparatorsChanged(state: AppState, event: EventOf<'separatorsChanged'>): AppState {
  const { separators } = event;
  const acceptable = isActive(state) && !state.batch && isValidSeparators(state.pageCount, separators);
  if (!acceptable || sameSeparators(separators, state.separators)) return state;
  const segmentStart = followedStart(state.segmentStart, segmentsOf(state.pageCount, separators));
  return restart({ ...state, separators, segmentStart });
}

/** 表示するセグメントの選択は、描画中か完了のときだけ受け付け、セグメントの先頭でないページや、表示中と同じものは無視する。 */
function onSegmentSelected(state: AppState, event: EventOf<'segmentSelected'>): AppState {
  const known = segmentsOfState(state).some((segment) => segment.start === event.start);
  if (!isActive(state) || !known || event.start === state.segmentStart) return state;
  return restart({ ...state, segmentStart: event.start });
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
  const count = shownPageCount(state);
  return { ...state, phase: 'ready', progress: { done: count, total: count }, failedPages: [...event.failedPages] };
}

/** 描画そのものが失敗したら(ページ単位ではなく全体の失敗)、未読み込みに戻って「読み込めなかった」エラーだけを残す。 */
function onRenderFailed(state: AppState): AppState {
  return state.phase === 'rendering' ? { ...INITIAL_STATE, error: 'invalid' } : state;
}

/** 複数ファイルのドロップは拒否する。状態はそのままで、エラーだけを付ける(一括保存中は、何もしない)。 */
function onDropRejected(state: AppState): AppState {
  return state.batch ? state : { ...state, error: 'multipleFiles' };
}

/** PNG を生成できなかったら、完了のまま、エラーだけを付ける。 */
function onPngFailed(state: AppState): AppState {
  return state.phase === 'ready' ? { ...state, error: 'pngFailed' } : state;
}

/** 一括保存は、完了で、セグメントが 2 個以上のときだけ始められる。前のエラーと、前の一括保存の警告は消す。 */
function onBatchStarted(state: AppState): AppState {
  const total = state.separators.length + 1;
  if (state.phase !== 'ready' || state.batch || total < 2) return state;
  return { ...state, batch: { index: 0, total, saved: 0 }, error: null, batchStop: null };
}

/** 一括保存の、処理中のセグメントの番号と、保存した個数を更新する(一括保存中でなければ無視する)。 */
function onBatchProgressed(state: AppState, event: EventOf<'batchProgressed'>): AppState {
  if (!state.batch) return state;
  return { ...state, batch: { ...state.batch, index: event.index, saved: event.saved } };
}

/** 一括保存を、全部保存し終えて終える(一括保存中でなければ無視する)。警告は残さない。 */
function onBatchFinished(state: AppState): AppState {
  return state.batch ? { ...state, batch: null } : state;
}

/** 一括保存を、キャンセルまたは失敗で終える(一括保存中でなければ無視する)。保存した個数と総数を、警告のために残す。 */
function onBatchStopped(state: AppState, event: EventOf<'batchStopped'>): AppState {
  if (!state.batch) return state;
  const segment = event.reason === 'failed' ? (segmentsOfState(state)[event.index] ?? null) : null;
  const batchStop = { reason: event.reason, saved: event.saved, total: state.batch.total, segment };
  return { ...state, batch: null, batchStop };
}

const HANDLERS: Handlers = {
  fileChosen: onFileChosen,
  loadFailed: onLoadFailed,
  loaded: onLoaded,
  columnsChanged: onColumnsChanged,
  separatorsChanged: onSeparatorsChanged,
  segmentSelected: onSegmentSelected,
  layoutPlanned: onLayoutPlanned,
  progress: onProgress,
  renderFinished: onRenderFinished,
  renderFailed: onRenderFailed,
  dropRejected: onDropRejected,
  pngFailed: onPngFailed,
  batchStarted: onBatchStarted,
  batchProgressed: onBatchProgressed,
  batchFinished: onBatchFinished,
  batchStopped: onBatchStopped,
};

/** 状態にイベントを適用した、新しい状態を返す(状態は書き換えない。状況に合わない古いイベントは無視する)。 */
export function reduce(state: AppState, event: AppEvent): AppState {
  const handler = HANDLERS[event.type] as (s: AppState, e: AppEvent) => AppState;
  return handler(state, event);
}

// 各状態で許される操作。segments と downloadAll は、状態が許すかどうかだけで、セグメントが 2 個以上かは uiFlags が加味する
const FLAGS: Readonly<Record<Phase, UiFlags>> = {
  idle: { pick: true, columns: false, separators: false, segments: false, zoom: false, download: false, downloadAll: false, cancelBatch: false },
  loading: { pick: true, columns: false, separators: false, segments: false, zoom: false, download: false, downloadAll: false, cancelBatch: false },
  rendering: { pick: true, columns: true, separators: true, segments: true, zoom: true, download: false, downloadAll: false, cancelBatch: false },
  ready: { pick: true, columns: true, separators: true, segments: true, zoom: true, download: true, downloadAll: true, cancelBatch: false },
};

// 一括保存中は、「キャンセル」以外の操作を全て無効にする
const BATCH_FLAGS: UiFlags = {
  pick: false,
  columns: false,
  separators: false,
  segments: false,
  zoom: false,
  download: false,
  downloadAll: false,
  cancelBatch: true,
};

/** 状態から、各操作の可否を導く(セグメントの選択と「すべてダウンロード」は、セグメントが 2 個以上のときだけ有効)。 */
export function uiFlags(state: AppState): UiFlags {
  if (state.batch) return BATCH_FLAGS;
  const base = FLAGS[state.phase];
  const split = state.separators.length > 0;
  return { ...base, segments: base.segments && split, downloadAll: base.downloadAll && split };
}

/** 一括保存中の進捗の文言(保存中 K/N 個(処理中のセグメントの範囲))を作る。 */
function batchProgressText(state: AppState, batch: BatchProgress): string {
  const segment = segmentsOfState(state)[batch.index];
  return formatBatchProgress(batch.index + 1, batch.total, segment ? segmentRange(segment) : '');
}

/** 一括保存中、読み込み中、描画中の、進捗の行を作る(一括保存中は、ページごとの「描画中」を出さない)。 */
function progressLines(state: AppState): StatusLine[] {
  if (state.batch) return [{ kind: 'progress', text: batchProgressText(state, state.batch) }];
  if (state.phase === 'loading') return [{ kind: 'progress', text: LOADING_TEXT }];
  if (state.phase !== 'rendering') return [];
  return [{ kind: 'progress', text: formatProgress(state.progress.done, state.progress.total) }];
}

/** 一括保存を止めた記録から、警告の行を作る(PNG を生成できなかったセグメントがあれば範囲つき、なければキャンセル)。 */
function batchStopLine(stop: BatchStop): StatusLine {
  const failed = stop.reason === 'failed' && stop.segment;
  const text = failed ? formatBatchFailed(segmentRange(stop.segment as Segment), stop.saved, stop.total) : formatBatchCancelled(stop.saved, stop.total);
  return { kind: 'warning', text };
}

/** 自動縮小の通知と、描画に失敗したページの警告と、一括保存を止めた警告の行を作る。 */
function noticeLines(state: AppState): StatusLine[] {
  const lines: StatusLine[] = [];
  if (state.shrink) {
    const { scale, width, height } = state.shrink;
    lines.push({ kind: 'notice', text: formatShrinkNotice(scale, width, height) });
  }
  if (state.failedPages.length > 0) lines.push({ kind: 'warning', text: formatFailedPages(state.failedPages) });
  if (state.batchStop) lines.push(batchStopLine(state.batchStop));
  return lines;
}

/** ステータス行に出すメッセージを、進捗 → 通知 → 警告 → エラーの順で返す。 */
export function statusLines(state: AppState): StatusLine[] {
  const error: StatusLine[] = state.error ? [{ kind: 'error', text: ERROR_TEXT[state.error] }] : [];
  return [...progressLines(state), ...noticeLines(state), ...error];
}
