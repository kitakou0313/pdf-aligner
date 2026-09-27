import { createColumnsInput, type ColumnsInput } from './core/columns-input.ts';
import { createController, type Controller } from './core/controller.ts';
import { dropAction } from './core/drop.ts';
import type { Layout } from './core/layout.ts';
import { segmentLabel } from './core/segments.ts';
import { createSeparatorsInput, type SeparatorsInput } from './core/separators-input.ts';
import { formatSeparators } from './core/separators.ts';
import { INITIAL_STATE, reduce, segmentsOfState, shownImageName, statusLines, uiFlags, type AppEvent, type AppState } from './core/state.ts';
import { createStore, type Store } from './core/store.ts';
import { ZoomController } from './core/zoom-controller.ts';
import { wheelZoomFactor, zoomAnchoredScroll, type Point } from './core/zoom.ts';
import { openPdf } from './pdf/loader.ts';
import { requireElement } from './view/dom.ts';
import { bindDropzone, blockStrayDrops } from './view/dropzone.ts';
import { canvasToPng, saveBlob } from './view/download.ts';
import { createPreview, type Preview } from './view/preview.ts';
import { renderStatus } from './view/status.ts';
import { bindToolbar, type SegmentOption, type Toolbar, type ToolbarHandlers, type ToolbarModel } from './view/toolbar.ts';
import { watchDevicePixelRatio } from './view/viewport.ts';

/** セグメントのセレクタの選択肢(ラベルと先頭ページ)を、状態から作る。 */
function segmentOptions(state: AppState): SegmentOption[] {
  const segments = segmentsOfState(state);
  return segments.map((segment, index) => ({ label: segmentLabel(segment, index, segments.length), start: segment.start }));
}

/** 状態を持たない配線役。状態は store が、判断は core が、DOM の操作は view が持つ。ここは、それらをつなぐだけ。 */
class App implements ToolbarHandlers {
  private readonly store: Store<AppState, AppEvent> = createStore(INITIAL_STATE, reduce);
  private readonly zoom = new ZoomController();
  private readonly preview: Preview;
  private readonly toolbar: Toolbar;
  private readonly statusLine: HTMLElement;
  private readonly controller: Controller<File>;
  private readonly columns: ColumnsInput;
  private readonly separators: SeparatorsInput;

  /** index.html の要素に、各部品を結びつけ、状態の変化を画面に反映するようにする。 */
  constructor(root: HTMLElement) {
    this.preview = createPreview(root);
    this.statusLine = requireElement(root, '#status');
    this.controller = this.buildController();
    this.columns = this.buildColumnsInput();
    this.separators = this.buildSeparatorsInput();
    this.toolbar = bindToolbar(root, this);
    this.connect(requireElement(root, '#preview'));
  }

  /** 読み込みと描画を調停するコントローラを、状態の入れ物・PDF を開く処理・出力先の準備・画像の保存につないで作る。 */
  private buildController(): Controller<File> {
    const open = this.openFile.bind(this);
    const [prepare, saveImage] = [this.onPrepare.bind(this), this.saveImage.bind(this)];
    return createController<File>({ store: this.store, open, prepare, saveImage });
  }

  /** 区切りの入力欄の規則を、状態・区切りの反映・欄への書き戻しにつないで作る。 */
  private buildSeparatorsInput(): SeparatorsInput {
    const state = this.store.getState.bind(this.store);
    return createSeparatorsInput({ state, apply: this.applySeparators.bind(this), write: this.writeSeparators.bind(this) });
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

  /** 区切りの変更を反映する(表示するセグメントを描き直す)。 */
  private applySeparators(separators: number[]): void {
    void this.controller.setSeparators(separators);
  }

  /** 区切りの欄に、整えた文字列を書き戻す。 */
  private writeSeparators(text: string): void {
    this.toolbar.writeSeparators(text);
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

  /** ツールバーに、操作の可否、列数と区切りの欄、セグメントの選択肢、倍率を反映する。 */
  private renderToolbar(state: AppState): void {
    this.toolbar.render(this.toolbarModel(state));
  }

  /** 状態から、ツールバーの表示内容を作る(PDF を読み込むまでは、列数と区切りの欄は空)。 */
  private toolbarModel(state: AppState): ToolbarModel {
    const active = state.phase === 'rendering' || state.phase === 'ready';
    return {
      flags: uiFlags(state),
      columnsText: active ? String(state.columns) : '',
      separatorsText: active ? formatSeparators(state.separators) : '',
      segments: segmentOptions(state),
      segmentStart: state.segmentStart,
      pageCount: state.pageCount,
      zoomLabel: this.zoom.view()?.label ?? '100%',
    };
  }

  /** ドロップされたファイルを、本数に応じて、読み込む・拒否する・無視する。 */
  private onDrop(files: File[]): void {
    const action = dropAction(files.length);
    if (action === 'reject') this.controller.rejectDrop();
    if (action === 'choose') this.chooseFile(files[0] as File);
  }

  /** 選ばれた PDF を読み込む。倍率は「画面に合わせる」に戻す(一括保存中は、何もしない)。 */
  chooseFile(file: File): void {
    if (this.store.getState().batch) return;
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

  /** 区切りの入力の途中。 */
  separatorsInput(raw: string): void {
    this.separators.onInput(raw);
  }

  /** 区切りの確定。 */
  separatorsCommit(raw: string): void {
    this.separators.onCommit(raw);
  }

  /** セグメントの選択(start は、選ばれたセグメントの先頭ページ)。 */
  segmentSelected(start: number): void {
    void this.controller.selectSegment(start);
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

  /** 完了した画像(表示中のセグメント)を PNG にして保存する(canvas はプレビューと同じ 1 枚)。 */
  private async savePng(): Promise<void> {
    const state = this.store.getState();
    if (state.phase !== 'ready' || state.fileName === null) return;
    if (!(await this.saveImage(shownImageName(state)))) this.store.dispatch({ type: 'pngFailed' });
  }

  /** 「すべてダウンロード」のボタン: 一括保存を始める。一括保存中は、キャンセルになる。 */
  downloadAll(): void {
    if (this.store.getState().batch) this.controller.cancelBatch();
    else void this.controller.downloadAll();
  }

  /** 今の出力画像(プレビューと同じ canvas)を、指定した名前の PNG として保存する。PNG を生成できなかったときは、保存せずに false。 */
  private async saveImage(fileName: string): Promise<boolean> {
    const blob = await canvasToPng(this.preview.canvas);
    if (blob) saveBlob(blob, fileName);
    return blob !== null;
  }
}

/** アプリを、root の中の要素に結びつけて起動する。 */
export function startApp(root: HTMLElement): void {
  new App(root);
}
