import { composePages, type ComposeOptions, type PageSource } from './compose.ts';
import { pdfFileName } from './filename.ts';
import type { Layout, LayoutPlan } from './layout.ts';
import type { CanvasLimits } from './limits.ts';
import { effectiveColumns, segmentPageCount, type Segment } from './segments.ts';
import { segmentsOfState, shownImageName, shownSegment, type AppEvent, type AppState } from './state.ts';
import type { Store } from './store.ts';
import { windowSource } from './window-source.ts';

/** 読み込む PDF(ファイル)。実物は File で、コントローラは名前しか使わない。 */
export interface PdfFile {
  readonly name: string;
}

/** 開いた PDF。source からページを描き、不要になったら close で資源を解放する。 */
export interface OpenedPdf {
  readonly source: PageSource;
  /** 元PDFプレビュー(F11)用: n ページ目(0 始まり)を、指定した幅のサムネイルとして canvas に描く。 */
  renderThumbnail(index: number, targetWidth: number, canvas: HTMLCanvasElement, signal: AbortSignal): Promise<void>;
  /** PDF の出力用: segment のページだけを切り出した、新しい PDF のバイト列を作る(元のバイト列は保持せず、呼ばれるたびに読み直す)。 */
  slice(segment: Segment): Promise<Uint8Array>;
  close(): void;
}

/** PDF を開けなかったときの例外。kind は、パスワード付きか、壊れている(または PDF ではない)か。 */
export class OpenFailure extends Error {
  readonly kind: 'encrypted' | 'invalid';

  /** 失敗の種類と、元の例外から作る。 */
  constructor(kind: 'encrypted' | 'invalid', cause: unknown) {
    super(`PDF を開けませんでした: ${kind}`, { cause });
    this.name = 'OpenFailure';
    this.kind = kind;
  }
}

/** 元PDFプレビュー(F11)側への問い合わせ先。出力の描画より、こちらを優先する(F7)。 */
export interface ThumbnailPriority {
  /** 見えている範囲に、まだ生成していないページがないか。 */
  isSettled(): boolean;
  /** isSettled() が変わるたびに呼ばれる。返り値で購読解除できる。 */
  onSettledChange(listener: (settled: boolean) => void): () => void;
}

/** 元PDFプレビューを持たないとき(単体テストなど)の既定値: 常に settled で、優先しない。 */
const ALWAYS_SETTLED: ThumbnailPriority = {
  /** 常に settled。 */
  isSettled: () => true,
  /** 変化しないので、何もしない購読。 */
  onSettledChange: () => () => {},
};

/** コントローラが頼る外部のうち、描画に関わるもの(状態の入れ物と、出力先の準備)。 */
interface RenderDeps {
  readonly store: Store<AppState, AppEvent>;
  /** 描画を始める前に、出力先(canvas の大きさと背景)を、レイアウトに合わせて用意する。 */
  readonly prepare: (layout: Layout) => void;
  readonly limits?: CanvasLimits;
  /** 元PDFプレビュー(未指定なら常に settled)。 */
  readonly thumbnails?: ThumbnailPriority;
}

/** deps.thumbnails(未指定なら常に settled の既定値)。 */
function thumbnailsOf(deps: RenderDeps): ThumbnailPriority {
  return deps.thumbnails ?? ALWAYS_SETTLED;
}

/** 一括保存が頼る外部。今の出力画像(プレビューと同じ canvas)を、指定した名前の PNG として保存する。生成できなかったときは false。 */
interface BatchDeps extends RenderDeps {
  readonly saveImage: (fileName: string) => Promise<boolean>;
}

/** コントローラが頼る外部(描画に関わるもの、PDF を開く処理、画像と PDF の保存)。F は、開く対象(実物は File)の型。 */
export interface ControllerDeps<F extends PdfFile = PdfFile> extends BatchDeps {
  readonly open: (file: F) => Promise<OpenedPdf>;
  /** 切り出した PDF を、指定した名前で保存する。 */
  readonly savePdf: (data: Uint8Array, fileName: string) => void;
}

/** 利用者の操作を受け付けて、PDF の読み込みと描画を調停する。各操作は、完了または後の操作に置き換えられたときに解決し、拒否はしない。 */
export interface Controller<F extends PdfFile = PdfFile> {
  chooseFile(file: F): Promise<void>;
  setColumns(columns: number): Promise<void>;
  /** 区切り(正規化済み)を設定して、表示するセグメントを描き直す。 */
  setSeparators(separators: readonly number[]): Promise<void>;
  /** 表示するセグメントを、その先頭ページ(1 始まり)で選んで、描き直す(一括保存中は無視する)。 */
  selectSegment(start: number): Promise<void>;
  /** 全セグメントを、先頭から順に、セグメントごとの PNG として保存する(始められないときは何もしない)。 */
  downloadAll(): Promise<void>;
  /** 一括保存をキャンセルする(一括保存中でなければ何もしない)。 */
  cancelBatch(): void;
  /** 表示中のセグメントのページを、元ページのまま切り出した PDF として保存する(始められないときは何もしない)。 */
  downloadPdf(): Promise<void>;
  /** 全セグメントを、先頭から順に、セグメントごとの PDF として保存する(区切りなしのときは何もしない)。 */
  downloadAllPdf(): Promise<void>;
  /** 複数ファイルのドロップを拒否する(表示中の状態はそのまま、エラーだけを出す)。 */
  rejectDrop(): void;
}

/** 今の PDF と、進行中の描画・一括保存(中断の手段と、描画の終わりを待つ手段)、PDF を選ぶ操作の世代(選ぶたびに進み、古い読み込みを見分ける)。 */
interface Session {
  pdf: OpenedPdf | null;
  abort: AbortController | null;
  inflight: Promise<unknown>;
  epoch: number;
  batchAbort: AbortController | null;
}

/** 開けなかった原因を分類する(OpenFailure ならその種類、それ以外は「壊れているか PDF ではない」)。 */
function failureKind(error: unknown): 'encrypted' | 'invalid' {
  return error instanceof OpenFailure ? error.kind : 'invalid';
}

/** 今の PDF を閉じて手放す。 */
function closePdf(session: Session): void {
  session.pdf?.close();
  session.pdf = null;
}

/** 進行中の描画があれば中断する(その終わりは session.inflight で待てる)。 */
function abortRender(session: Session): void {
  session.abort?.abort();
  session.abort = null;
}

/** レイアウトが決まったとき: 出力先を用意し、画像の大きさと縮小の有無を状態に知らせる。 */
function announceLayout(deps: RenderDeps, plan: LayoutPlan): void {
  deps.prepare(plan.layout);
  const { scale, width, height } = plan.layout;
  deps.store.dispatch({ type: 'layoutPlanned', scale, width, height, shrunk: plan.shrunk });
}

/** セグメントの描画の設定: 実際の列数(列数とセグメントのページ数の小さい方)、中断の信号、通知の受け取り口。 */
function composeOptions(deps: RenderDeps, signal: AbortSignal, segment: Segment): ComposeOptions {
  return {
    columns: effectiveColumns(deps.store.getState().columns, segment),
    signal,
    limits: deps.limits,
    /** レイアウトの通知を、出力先の用意と状態への反映につなぐ。 */
    onLayout: (plan) => announceLayout(deps, plan),
    /** 1 ページ処理するたびに、進捗を状態に反映する。 */
    onProgress: (done, total) => deps.store.dispatch({ type: 'progress', done, total }),
  };
}

/**
 * 描画を 1 回行う。表示中のセグメントのページだけを描く。レイアウトが決まったら出力先を用意し、進捗を知らせ、
 * 最後まで描けたときだけ完了にする。失敗したページは、元の PDF のページ番号(0 始まり)にして知らせる。
 * 最後まで描けたら true、中断されたら(元PDFプレビュー優先、または後の変更で)false を返す。
 */
async function renderOnce(deps: RenderDeps, pdf: OpenedPdf, signal: AbortSignal): Promise<boolean> {
  const segment = shownSegment(deps.store.getState());
  if (!segment) return true;
  const source = windowSource(pdf.source, segment.start - 1, segmentPageCount(segment));
  const result = await composePages(source, composeOptions(deps, signal, segment));
  if (result.status !== 'done') return false;
  const failedPages = result.failedPages.map((index) => index + segment.start - 1);
  deps.store.dispatch({ type: 'renderFinished', failedPages });
  return true;
}

/** 一括保存中でなければ、元PDFプレビューの見えている範囲に、まだ生成していないページがあるか。 */
function blockedByThumbnails(deps: RenderDeps): boolean {
  return !deps.store.getState().batch && !thumbnailsOf(deps).isSettled();
}

/** サムネイルの settled の変化と、外側の中断のたびに on を呼ぶよう購読する。返り値で購読を解く。 */
function watchThumbnails(deps: RenderDeps, outerSignal: AbortSignal, on: () => void): () => void {
  const unsubscribe = thumbnailsOf(deps).onSettledChange(on);
  outerSignal.addEventListener('abort', on);
  return () => { unsubscribe(); outerSignal.removeEventListener('abort', on); };
}

/** unblocked(ブロックが解けたか、外側が中断した)になるたびに resolve を試み、なったら購読を解く。 */
function watchUntilUnblocked(deps: RenderDeps, outerSignal: AbortSignal, resolve: () => void): void {
  /** まだブロックされていれば、何もしない。解けていれば、購読を解いて resolve する。 */
  const check = (): void => {
    if (blockedByThumbnails(deps) && !outerSignal.aborted) return;
    stop();
    resolve();
  };
  const stop = watchThumbnails(deps, outerSignal, check);
  check();
}

/** ブロックが解ける(サムネイルが落ち着く)か、外側の中断が来るまで待つ。 */
function waitUntilUnblocked(deps: RenderDeps, outerSignal: AbortSignal): Promise<void> {
  return new Promise((resolve) => watchUntilUnblocked(deps, outerSignal, resolve));
}

/** controller を、blockedByThumbnails になったときだけ中断する関数を作る。 */
function abortIfBlocked(deps: RenderDeps, controller: AbortController): () => void {
  return () => { if (blockedByThumbnails(deps)) controller.abort(); };
}

/** 2 つの後始末をまとめて 1 つにする。 */
function combineCleanup(a: () => void, b: () => void): () => void {
  return () => { a(); b(); };
}

/** 描画中に(一括保存中でなければ)サムネイルが優先を取り戻したら中断する信号を作る。stop で後始末する。 */
function guardedSignal(deps: RenderDeps, outerSignal: AbortSignal): { signal: AbortSignal; stop: () => void } {
  const inner = new AbortController();
  /** 外側の中断(supersede)が来たら、この描画も中断する。 */
  const onAbort = (): void => inner.abort();
  const unsubscribe = thumbnailsOf(deps).onSettledChange(abortIfBlocked(deps, inner));
  outerSignal.addEventListener('abort', onAbort);
  const stop = combineCleanup(unsubscribe, () => outerSignal.removeEventListener('abort', onAbort));
  return { signal: inner.signal, stop };
}

/** ブロックされていることを状態に知らせてから、解けるまで待つ。 */
async function deferForThumbnails(deps: RenderDeps, outerSignal: AbortSignal): Promise<void> {
  deps.store.dispatch({ type: 'renderDeferred' });
  await waitUntilUnblocked(deps, outerSignal);
}

/** 元PDFプレビューに邪魔されない状態で、描画を 1 回試みる。最後まで描けたら true。 */
async function attemptRender(deps: RenderDeps, pdf: OpenedPdf, outerSignal: AbortSignal): Promise<boolean> {
  deps.store.dispatch({ type: 'renderResumed' });
  const guard = guardedSignal(deps, outerSignal);
  const completed = await renderOnce(deps, pdf, guard.signal);
  guard.stop();
  return completed;
}

/**
 * 一括保存中でなければ元PDFプレビューの表示を優先しながら、描画を試みる(F7)。
 * 優先されている間は待ち、描画中に割り込まれたら中断して、落ち着いてからやり直す。外側の中断(supersede)が来たら、そこで諦める。
 */
async function renderWithPriority(deps: RenderDeps, pdf: OpenedPdf, outerSignal: AbortSignal): Promise<void> {
  while (!outerSignal.aborted) {
    if (blockedByThumbnails(deps)) {
      await deferForThumbnails(deps, outerSignal);
      continue;
    }
    if ((await attemptRender(deps, pdf, outerSignal)) || outerSignal.aborted) return;
  }
}

/** 描画が例外で終わったときの後始末。中断済み(後の操作に置き換えられた)描画の失敗は無視し、今の描画なら、PDF を閉じて、「読み込めなかった」エラーにする。 */
function onRenderCrashed(deps: RenderDeps, session: Session, signal: AbortSignal, error: unknown): void {
  if (signal.aborted) return;
  console.error('描画に失敗しました', error);
  closePdf(session);
  deps.store.dispatch({ type: 'renderFailed' });
}

/**
 * 描画を予約して実行する。先の描画は中断し、その終わりを待ってから始める(描画は、常に 1 つだけ)。
 * 待つ間に、さらに後の操作があったときは、この描画の中断の信号がすでに立っているので、composePages が何も描かずに終わる。
 */
async function startRender(deps: RenderDeps, session: Session): Promise<void> {
  abortRender(session);
  const abort = new AbortController();
  session.abort = abort;
  await session.inflight;
  if (!session.pdf) return;
  const run = renderWithPriority(deps, session.pdf, abort.signal);
  session.inflight = run.catch(() => undefined);
  await run.catch((error: unknown) => onRenderCrashed(deps, session, abort.signal, error));
}

/** PDF を開く。世代が進んでいたら、開けた PDF は閉じて null。失敗は分類して状態に反映する(古い世代の失敗は無視)。 */
async function openCurrent<F extends PdfFile>(deps: ControllerDeps<F>, session: Session, file: F, epoch: number): Promise<OpenedPdf | null> {
  try {
    const pdf = await deps.open(file);
    if (epoch === session.epoch) return pdf;
    pdf.close();
  } catch (error) {
    if (epoch === session.epoch) deps.store.dispatch({ type: 'loadFailed', error: failureKind(error) });
  }
  return null;
}

/** 開けた PDF を「今の PDF」にして、描画を始める。ページがなければ(状態機械が受け付けなければ)、閉じるだけ。 */
async function beginRendering(deps: RenderDeps, session: Session, pdf: OpenedPdf): Promise<void> {
  session.pdf = pdf;
  deps.store.dispatch({ type: 'loaded', pageCount: pdf.source.pageCount });
  if (deps.store.getState().phase === 'rendering') await startRender(deps, session);
  else closePdf(session);
}

/** 選ばれた PDF を、前のものと置き換えて読み込み、描画する。前の描画が終わってから、前の PDF を閉じる。 */
async function chooseFile<F extends PdfFile>(deps: ControllerDeps<F>, session: Session, file: F): Promise<void> {
  session.epoch += 1;
  const { epoch } = session;
  abortRender(session);
  deps.store.dispatch({ type: 'fileChosen', fileName: file.name });
  await session.inflight;
  if (epoch !== session.epoch) return;
  closePdf(session);
  const pdf = await openCurrent(deps, session, file, epoch);
  if (pdf) await beginRendering(deps, session, pdf);
}

/** 状態を変えるイベント(列数、区切り、表示するセグメントの変更)を送る。状態機械が受け入れた(状態が変わった)ときだけ、描き直す。 */
async function applyChange(deps: RenderDeps, session: Session, event: AppEvent): Promise<void> {
  const before = deps.store.getState();
  deps.store.dispatch(event);
  if (deps.store.getState() === before) return;
  await startRender(deps, session);
}

/** 一括保存の終わり方: 全て保存した(finished)、キャンセルした、PNG を生成できなかった(failed)、状態が外で置き換わった(lost)。 */
interface BatchOutcome {
  readonly reason: 'finished' | 'cancelled' | 'failed' | 'lost';
  readonly index: number;
  readonly saved: number;
}

/** 1 つのセグメントの保存の結果: 保存した(saved)、または、一括保存の終わり方(finished 以外)。 */
type StepResult = 'saved' | 'cancelled' | 'failed' | 'lost';

/**
 * index 番目のセグメントを表示して描き終え、PNG にして保存する。描画の途中で中断されたとき(cancelled)、
 * 描画そのものが失敗するなどして状態が外で置き換わったとき(lost)は、保存しない。
 */
async function saveSegment(deps: BatchDeps, session: Session, signal: AbortSignal, index: number): Promise<StepResult> {
  const segments = segmentsOfState(deps.store.getState());
  await applyChange(deps, session, { type: 'segmentSelected', start: (segments[index] as Segment).start });
  if (signal.aborted) return 'cancelled';
  const state = deps.store.getState();
  if (!state.batch || state.phase !== 'ready') return 'lost';
  const saved = await deps.saveImage(shownImageName(state));
  return saved ? 'saved' : 'failed';
}

/** 全セグメントを、先頭から順に保存する。最初に中断・失敗したところで止まる。 */
async function saveAllSegments(deps: BatchDeps, session: Session, signal: AbortSignal): Promise<BatchOutcome> {
  const total = segmentsOfState(deps.store.getState()).length;
  let saved = 0;
  for (let index = 0; index < total; index += 1) {
    if (signal.aborted) return { reason: 'cancelled', index, saved };
    deps.store.dispatch({ type: 'batchProgressed', index, saved });
    const step = await saveSegment(deps, session, signal, index);
    if (step !== 'saved') return { reason: step, index, saved };
    saved += 1;
  }
  return { reason: 'finished', index: total, saved };
}

/**
 * 一括保存を終える。元のセグメントを表示に戻し(表示するセグメントの変更が警告を消すため)、描き直しが要るなら
 * 一括保存中のまま描き直してから、終わり方を状態に知らせる(この描き直しの間も出力を優先させるため。F7)。
 * 状態がすでに外で置き換わっている(描画の失敗など)ときは、何もしない。
 */
async function finishBatch(deps: BatchDeps, session: Session, origin: number, outcome: BatchOutcome): Promise<void> {
  const { store } = deps;
  if (!store.getState().batch) return;
  store.dispatch({ type: 'segmentSelected', start: origin });
  if (store.getState().phase !== 'ready') await startRender(deps, session);
  const reason = outcome.reason === 'lost' ? 'cancelled' : outcome.reason;
  store.dispatch(reason === 'finished' ? { type: 'batchFinished' } : { type: 'batchStopped', reason, index: outcome.index, saved: outcome.saved });
}

/** 一括保存を始めて、全セグメントを保存し、終わらせる。始められないとき(状態機械が受け付けないとき、すでに一括保存中)は、何もしない。 */
async function downloadAll(deps: BatchDeps, session: Session): Promise<void> {
  if (deps.store.getState().batch) return;
  const origin = deps.store.getState().segmentStart;
  deps.store.dispatch({ type: 'batchStarted' });
  if (!deps.store.getState().batch) return;
  const abort = new AbortController();
  session.batchAbort = abort;
  const outcome = await saveAllSegments(deps, session, abort.signal);
  session.batchAbort = null;
  await finishBatch(deps, session, origin, outcome);
}

/** 一括保存をキャンセルする: 保存の続きを止め、進行中の描画があれば中断する。一括保存中でなければ、何もしない。 */
function cancelBatch(deps: RenderDeps, session: Session): void {
  if (!deps.store.getState().batch) return;
  session.batchAbort?.abort();
  abortRender(session);
}

/** 表示するセグメントの選択(利用者の操作)。一括保存中は、無視する。 */
async function selectSegment(deps: RenderDeps, session: Session, start: number): Promise<void> {
  if (deps.store.getState().batch) return;
  await applyChange(deps, session, { type: 'segmentSelected', start });
}

/** PDF の書き出しの結果: 保存できた個数と、失敗で止まったか(failed)。 */
interface PdfSaveResult {
  readonly saved: number;
  readonly failed: boolean;
}

/** 1 つのセグメントを切り出して保存する。PDF が差し替わっていた(epoch が進んでいた)ときは、保存せずに false。 */
async function saveOnePdf<F extends PdfFile>(deps: ControllerDeps<F>, session: Session, job: PdfJob, segment: Segment): Promise<boolean> {
  const data = await job.pdf.slice(segment);
  if (job.epoch !== session.epoch) return false;
  deps.savePdf(data, pdfFileName(job.fileName, segment, job.pageCount));
  return true;
}

/** 書き出す PDF と、書き出しを始めたときの世代・ファイル名・総ページ数。 */
interface PdfJob {
  readonly pdf: OpenedPdf;
  readonly epoch: number;
  readonly fileName: string;
  readonly pageCount: number;
}

/** 1 つのセグメントの保存の結果: 保存した(saved)、PDF が差し替わっていた(stale)、切り出しに失敗した(failed)。 */
type PdfStep = 'saved' | 'stale' | 'failed';

/** 1 つのセグメントを保存し、例外(切り出しの失敗)は failed にする。ただし、差し替わったあとの失敗は、stale として無視する。 */
async function tryOnePdf<F extends PdfFile>(deps: ControllerDeps<F>, session: Session, job: PdfJob, segment: Segment): Promise<PdfStep> {
  try {
    return (await saveOnePdf(deps, session, job, segment)) ? 'saved' : 'stale';
  } catch (error) {
    console.error('PDF の書き出しに失敗しました', error);
    return job.epoch === session.epoch ? 'failed' : 'stale';
  }
}

/** segments を先頭から順に保存する。切り出しに失敗したら止める(保存できた個数と failed を返す)。PDF が差し替わったら、null(何も知らせない)。 */
async function savePdfSegments<F extends PdfFile>(deps: ControllerDeps<F>, session: Session, job: PdfJob, segments: readonly Segment[]): Promise<PdfSaveResult | null> {
  let saved = 0;
  for (const segment of segments) {
    const step = await tryOnePdf(deps, session, job, segment);
    if (step === 'stale') return null;
    if (step === 'failed') return { saved, failed: true };
    saved += 1;
  }
  return { saved, failed: false };
}

/** 書き出しの結果を、状態に知らせる(PDF が差し替わって結果が null のときは、何もしない)。 */
function reportPdfSave(deps: RenderDeps, result: PdfSaveResult | null, total: number): void {
  if (!result) return;
  deps.store.dispatch(result.failed ? { type: 'pdfSaveFailed', saved: result.saved, total } : { type: 'pdfSaveFinished' });
}

/** PDF の書き出しを始めて、pick が選んだセグメントを保存する。始められないとき(状態機械が受け付けないとき、PDF がないとき、対象がないとき)は、何もしない。 */
async function downloadPdfs<F extends PdfFile>(deps: ControllerDeps<F>, session: Session, pick: (state: AppState) => Segment[]): Promise<void> {
  const before = deps.store.getState();
  deps.store.dispatch({ type: 'pdfSaveStarted' });
  const state = deps.store.getState();
  if (state === before) return;
  const segments = pick(state);
  if (!session.pdf || segments.length === 0) return void deps.store.dispatch({ type: 'pdfSaveFinished' });
  const job = { pdf: session.pdf, epoch: session.epoch, fileName: state.fileName ?? '', pageCount: state.pageCount };
  reportPdfSave(deps, await savePdfSegments(deps, session, job, segments), segments.length);
}

/** 表示中のセグメントだけ(表示中のセグメントがなければ空)。 */
function shownOnly(state: AppState): Segment[] {
  const segment = shownSegment(state);
  return segment ? [segment] : [];
}

/** 全セグメント(区切りなしのときは空。「すべて」は、区切りがあるときだけ意味がある)。 */
function allSegments(state: AppState): Segment[] {
  return state.separators.length > 0 ? segmentsOfState(state) : [];
}

/** PNG の一括保存の 2 つの操作(開始とキャンセル)。 */
function batchActions<F extends PdfFile>(deps: ControllerDeps<F>, session: Session): Pick<Controller<F>, 'downloadAll' | 'cancelBatch'> {
  return {
    /** 全セグメントを、セグメントごとの PNG として保存する。 */
    downloadAll: () => downloadAll(deps, session),
    /** 一括保存をキャンセルする。 */
    cancelBatch: () => cancelBatch(deps, session),
  };
}

/** PDF の書き出しの 2 つの操作(表示中のセグメントだけ、全セグメント)。 */
function pdfActions<F extends PdfFile>(deps: ControllerDeps<F>, session: Session): Pick<Controller<F>, 'downloadPdf' | 'downloadAllPdf'> {
  return {
    /** 表示中のセグメントを、PDF として保存する。 */
    downloadPdf: () => downloadPdfs(deps, session, shownOnly),
    /** 全セグメントを、セグメントごとの PDF として保存する。 */
    downloadAllPdf: () => downloadPdfs(deps, session, allSegments),
  };
}

/** 状態の入れ物、PDF を開く処理、出力先の準備、画像と PDF の保存を受け取って、コントローラを作る。 */
export function createController<F extends PdfFile = PdfFile>(deps: ControllerDeps<F>): Controller<F> {
  const session: Session = { pdf: null, abort: null, inflight: Promise.resolve(), epoch: 0, batchAbort: null };
  return {
    /** 選ばれた PDF を読み込んで描く(一括保存中は、無視する)。 */
    chooseFile: (file) => (deps.store.getState().batch ? Promise.resolve() : chooseFile(deps, session, file)),
    /** 列数の変更を受け付けて、描き直す。 */
    setColumns: (columns) => applyChange(deps, session, { type: 'columnsChanged', columns }),
    /** 区切りの変更を受け付けて、描き直す。 */
    setSeparators: (separators) => applyChange(deps, session, { type: 'separatorsChanged', separators }),
    /** 表示するセグメントを選んで、描き直す。 */
    selectSegment: (start) => selectSegment(deps, session, start),
    /** PNG の一括保存(開始とキャンセル)と、PDF の書き出し(表示中のセグメントだけ、全セグメント)。 */
    ...batchActions(deps, session),
    ...pdfActions(deps, session),
    /** 複数ファイルのドロップを拒否する。 */
    rejectDrop: () => deps.store.dispatch({ type: 'dropRejected' }),
  };
}
