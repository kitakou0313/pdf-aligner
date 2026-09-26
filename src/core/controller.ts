import { composePages, type ComposeOptions, type PageSource } from './compose.ts';
import type { Layout, LayoutPlan } from './layout.ts';
import type { CanvasLimits } from './limits.ts';
import type { AppEvent, AppState } from './state.ts';
import type { Store } from './store.ts';

/** 読み込む PDF(ファイル)。実物は File で、コントローラは名前しか使わない。 */
export interface PdfFile {
  readonly name: string;
}

/** 開いた PDF。source からページを描き、不要になったら close で資源を解放する。 */
export interface OpenedPdf {
  readonly source: PageSource;
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

/** コントローラが頼る外部のうち、描画に関わるもの(状態の入れ物と、出力先の準備)。 */
interface RenderDeps {
  readonly store: Store<AppState, AppEvent>;
  /** 描画を始める前に、出力先(canvas の大きさと背景)を、レイアウトに合わせて用意する。 */
  readonly prepare: (layout: Layout) => void;
  readonly limits?: CanvasLimits;
}

/** コントローラが頼る外部(描画に関わるものと、PDF を開く処理)。F は、開く対象(実物は File)の型。 */
export interface ControllerDeps<F extends PdfFile = PdfFile> extends RenderDeps {
  readonly open: (file: F) => Promise<OpenedPdf>;
}

/** 利用者の操作を受け付けて、PDF の読み込みと描画を調停する。各操作は、完了または後の操作に置き換えられたときに解決し、拒否はしない。 */
export interface Controller<F extends PdfFile = PdfFile> {
  chooseFile(file: F): Promise<void>;
  setColumns(columns: number): Promise<void>;
  /** 複数ファイルのドロップを拒否する(表示中の状態はそのまま、エラーだけを出す)。 */
  rejectDrop(): void;
}

/** 今の PDF と、進行中の描画(中断の手段と、終わりを待つ手段)、PDF を選ぶ操作の世代(選ぶたびに進み、古い読み込みを見分ける)。 */
interface Session {
  pdf: OpenedPdf | null;
  abort: AbortController | null;
  inflight: Promise<unknown>;
  epoch: number;
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

/** 描画を 1 回行う。レイアウトが決まったら出力先を用意し、進捗を知らせ、最後まで描けたときだけ完了にする。 */
async function renderOnce(deps: RenderDeps, pdf: OpenedPdf, signal: AbortSignal): Promise<void> {
  const { store } = deps;
  const options: ComposeOptions = {
    columns: store.getState().columns,
    signal,
    limits: deps.limits,
    /** レイアウトの通知を、出力先の用意と状態への反映につなぐ。 */
    onLayout: (plan) => announceLayout(deps, plan),
    /** 1 ページ処理するたびに、進捗を状態に反映する。 */
    onProgress: (done, total) => store.dispatch({ type: 'progress', done, total }),
  };
  const result = await composePages(pdf.source, options);
  if (result.status === 'done') store.dispatch({ type: 'renderFinished', failedPages: result.failedPages });
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
  const run = renderOnce(deps, session.pdf, abort.signal);
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

/** 列数の変更を受け付ける。状態機械が受け入れた(範囲内で、値が変わった)ときだけ、描き直す。 */
async function setColumns(deps: RenderDeps, session: Session, columns: number): Promise<void> {
  const before = deps.store.getState();
  deps.store.dispatch({ type: 'columnsChanged', columns });
  if (deps.store.getState() === before) return;
  await startRender(deps, session);
}

/** 状態の入れ物、PDF を開く処理、出力先の準備を受け取って、コントローラを作る。 */
export function createController<F extends PdfFile = PdfFile>(deps: ControllerDeps<F>): Controller<F> {
  const session: Session = { pdf: null, abort: null, inflight: Promise.resolve(), epoch: 0 };
  return {
    /** 選ばれた PDF を読み込んで描く。 */
    chooseFile: (file) => chooseFile(deps, session, file),
    /** 列数の変更を受け付けて、描き直す。 */
    setColumns: (columns) => setColumns(deps, session, columns),
    /** 複数ファイルのドロップを拒否する。 */
    rejectDrop: () => deps.store.dispatch({ type: 'dropRejected' }),
  };
}
