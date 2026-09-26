import { createColumnsInput, type ColumnsInput } from './core/columns-input.ts';
import { createController, type Controller } from './core/controller.ts';
import { dropAction } from './core/drop.ts';
import { downloadFileName } from './core/filename.ts';
import type { Layout } from './core/layout.ts';
import { INITIAL_STATE, reduce, statusLines, uiFlags, type AppEvent, type AppState } from './core/state.ts';
import { createStore, type Store } from './core/store.ts';
import { ZoomController } from './core/zoom-controller.ts';
import { wheelZoomFactor, zoomAnchoredScroll, type Point } from './core/zoom.ts';
import { openPdf } from './pdf/loader.ts';
import { requireElement } from './view/dom.ts';
import { bindDropzone, blockStrayDrops } from './view/dropzone.ts';
import { canvasToPng, saveBlob } from './view/download.ts';
import { createPreview, type Preview } from './view/preview.ts';
import { renderStatus } from './view/status.ts';
import { bindToolbar, type Toolbar, type ToolbarHandlers } from './view/toolbar.ts';
import { watchDevicePixelRatio } from './view/viewport.ts';

/** 状態を持たない配線役。状態は store が、判断は core が、DOM の操作は view が持つ。ここは、それらをつなぐだけ。 */
class App implements ToolbarHandlers {
  private readonly store: Store<AppState, AppEvent> = createStore(INITIAL_STATE, reduce);
  private readonly zoom = new ZoomController();
  private readonly preview: Preview;
  private readonly toolbar: Toolbar;
  private readonly statusLine: HTMLElement;
  private readonly controller: Controller<File>;
  private readonly columns: ColumnsInput;

  /** index.html の要素に、各部品を結びつけ、状態の変化を画面に反映するようにする。 */
  constructor(root: HTMLElement) {
    this.preview = createPreview(root);
    this.statusLine = requireElement(root, '#status');
    this.controller = this.buildController();
    this.columns = this.buildColumnsInput();
    this.toolbar = bindToolbar(root, this);
    this.connect(requireElement(root, '#preview'));
  }

  /** 読み込みと描画を調停するコントローラを、状態の入れ物・PDF を開く処理・出力先の準備につないで作る。 */
  private buildController(): Controller<File> {
    const open = this.openFile.bind(this);
    return createController<File>({ store: this.store, open, prepare: this.onPrepare.bind(this) });
  }

  /** 列数の入力欄の規則を、状態・列数の反映・欄への書き戻しにつないで作る。 */
  private buildColumnsInput(): ColumnsInput {
    const state = this.store.getState.bind(this.store);
    return createColumnsInput({ state, apply: this.applyColumns.bind(this), write: this.writeColumns.bind(this) });
  }

  /** PDF ファイルを開く。ページは、プレビューの出力画像へ描かれる。 */
  private openFile(file: File): ReturnType<typeof openPdf> {
    return openPdf(file, this.preview);
  }

  /** 列数の変更を反映する(描き直す)。 */
  private applyColumns(columns: number): void {
    void this.controller.setColumns(columns);
  }

  /** 列数の欄に、丸めた値を書き戻す。 */
  private writeColumns(columns: number): void {
    this.toolbar.writeColumns(columns);
  }

  /** 状態の変化、ドロップ、領域の大きさと画面の密度の変化を、画面に反映するようにつなぎ、最初の表示を行う。 */
  private connect(dropArea: HTMLElement): void {
    this.store.subscribe((state) => this.render(state));
    bindDropzone(dropArea, (files) => this.onDrop(files));
    blockStrayDrops(document);
    this.preview.onViewportChange(() => this.refreshZoom());
    this.preview.onWheelZoom(this.onWheelZoom.bind(this));
    watchDevicePixelRatio(() => this.refreshZoom());
    this.render(this.store.getState());
  }

  /** 状態を、プレビュー、倍率、ステータス行、ツールバーに反映する。 */
  private render(state: AppState): void {
    this.preview.showImage(state.phase === 'rendering' || state.phase === 'ready');
    this.refreshZoom();
    renderStatus(this.statusLine, statusLines(state));
  }

  /** 出力画像の準備ができたとき(描画の開始時)。倍率を新しい画像の大きさに合わせ、スクロール位置は左上に戻す。 */
  private onPrepare(layout: Layout): void {
    this.preview.prepare(layout);
    this.refreshZoom();
    this.preview.scrollTo({ x: 0, y: 0 });
  }

  /** 画像、領域、画面の密度から倍率を求め直し、プレビューの拡大率とツールバーの表示に反映する。 */
  private refreshZoom(): void {
    this.zoom.setViewport(this.preview.viewportSize());
    this.zoom.setDevicePixelRatio(window.devicePixelRatio);
    this.zoom.setImage(this.preview.imageSize());
    const view = this.zoom.view();
    if (view) this.preview.setScale(view.cssScale);
    this.renderToolbar(this.store.getState());
  }

  /** ツールバーに、操作の可否、列数、倍率を反映する(PDF を読み込むまでは、列数の欄は空)。 */
  private renderToolbar(state: AppState): void {
    const active = state.phase === 'rendering' || state.phase === 'ready';
    const columnsText = active ? String(state.columns) : '';
    const zoomLabel = this.zoom.view()?.label ?? '100%';
    this.toolbar.render({ flags: uiFlags(state), columnsText, pageCount: state.pageCount, zoomLabel });
  }

  /** ドロップされたファイルを、本数に応じて、読み込む・拒否する・無視する。 */
  private onDrop(files: File[]): void {
    const action = dropAction(files.length);
    if (action === 'reject') this.controller.rejectDrop();
    if (action === 'choose') this.chooseFile(files[0] as File);
  }

  /** 選ばれた PDF を読み込む。倍率は「画面に合わせる」に戻す。 */
  chooseFile(file: File): void {
    this.zoom.reset();
    void this.controller.chooseFile(file);
  }

  /** 列数の入力の途中。 */
  columnsInput(raw: string): void {
    this.columns.onInput(raw);
  }

  /** 列数の確定。 */
  columnsCommit(raw: string): void {
    this.columns.onCommit(raw);
  }

  /** ＋ボタン: 領域の中央の点を保って、1 段階拡大する。 */
  zoomIn(): void {
    this.zoomAroundCenter(() => this.zoom.step(1));
  }

  /** −ボタン: 領域の中央の点を保って、1 段階縮小する。 */
  zoomOut(): void {
    this.zoomAroundCenter(() => this.zoom.step(-1));
  }

  /** 倍率の表示ボタン: 領域の中央の点を保って、100% にする。 */
  zoomActual(): void {
    this.zoomAroundCenter(() => this.zoom.actual());
  }

  /** 「画面に合わせる」ボタン: 全体が収まる倍率に追従するモードに戻す(スクロールは左上)。 */
  zoomFit(): void {
    this.zoom.fit();
    this.refreshZoom();
    this.preview.scrollTo({ x: 0, y: 0 });
  }

  /** Ctrl+ホイールとピンチ: カーソルの位置を保って、拡縮する。 */
  private onWheelZoom(deltaY: number, deltaMode: number, pointer: Point): void {
    this.zoomAround(() => this.zoom.zoomBy(wheelZoomFactor(deltaY, deltaMode)), pointer);
  }

  /** 領域の中央の点を保って、倍率を変える。 */
  private zoomAroundCenter(change: () => void): void {
    const { width, height } = this.preview.viewportSize();
    this.zoomAround(change, { x: width / 2, y: height / 2 });
  }

  /** 倍率を変え(change)、pointer(領域の左上からの位置)の下にあった画像上の点が動かないよう、スクロール位置を合わせる。 */
  private zoomAround(change: () => void, pointer: Point): void {
    const before = this.zoom.view();
    const scroll = this.preview.scrollPosition();
    change();
    this.refreshZoom();
    const after = this.zoom.view();
    const image = this.preview.imageSize();
    if (!before || !after || !image) return;
    const viewport = this.preview.viewportSize();
    this.preview.scrollTo(zoomAnchoredScroll({ scroll, pointer, image, viewport, oldCss: before.cssScale, newCss: after.cssScale }));
  }

  /** 表示中の画像を PNG にして保存する。生成できなかったときは、保存せずにエラーを出す。 */
  download(): void {
    void this.savePng();
  }

  /** 完了した画像を PNG にして保存する(canvas はプレビューと同じ 1 枚)。 */
  private async savePng(): Promise<void> {
    const { phase, fileName, columns } = this.store.getState();
    if (phase !== 'ready' || fileName === null) return;
    const blob = await canvasToPng(this.preview.canvas);
    if (blob) saveBlob(blob, downloadFileName(fileName, columns));
    else this.store.dispatch({ type: 'pngFailed' });
  }
}

/** アプリを、root の中の要素に結びつけて起動する。 */
export function startApp(root: HTMLElement): void {
  new App(root);
}
