import type { UiFlags } from '../core/state.ts';
import { requireElement } from './dom.ts';

/** ツールバーの操作を受け取る側(ロジックは持たず、値や合図を渡すだけ)。 */
export interface ToolbarHandlers {
  chooseFile(file: File): void;
  columnsInput(raw: string): void;
  columnsCommit(raw: string): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomActual(): void;
  zoomFit(): void;
  download(): void;
}

/** ツールバーに表示する内容(操作の可否、列数の欄、倍率の表示)。 */
export interface ToolbarModel {
  readonly flags: UiFlags;
  readonly columnsText: string;
  readonly pageCount: number;
  readonly zoomLabel: string;
}

/** ツールバーの表示の更新口。 */
export interface Toolbar {
  render(model: ToolbarModel): void;
  /** 列数の欄に、値を書き戻す(確定したときの丸め)。 */
  writeColumns(columns: number): void;
}

/** ツールバーの DOM 要素と、その表示の更新。 */
class ToolbarView implements Toolbar {
  private readonly pick: HTMLButtonElement;
  private readonly fileInput: HTMLInputElement;
  private readonly columns: HTMLInputElement;
  private readonly zoomOut: HTMLButtonElement;
  private readonly zoomIn: HTMLButtonElement;
  private readonly zoomLevel: HTMLButtonElement;
  private readonly zoomFit: HTMLButtonElement;
  private readonly download: HTMLButtonElement;

  /** root の中の要素を取り出す。 */
  constructor(root: ParentNode) {
    this.pick = requireElement(root, '#pick');
    this.fileInput = requireElement(root, '#file-input');
    this.columns = requireElement(root, '#columns');
    this.zoomOut = requireElement(root, '#zoom-out');
    this.zoomIn = requireElement(root, '#zoom-in');
    this.zoomLevel = requireElement(root, '#zoom-level');
    this.zoomFit = requireElement(root, '#zoom-fit');
    this.download = requireElement(root, '#download');
  }

  /** 各要素の操作を、handlers に結びつける。 */
  bind(handlers: ToolbarHandlers): void {
    this.bindFile(handlers);
    this.columns.addEventListener('input', () => handlers.columnsInput(this.columns.value));
    this.columns.addEventListener('change', () => handlers.columnsCommit(this.columns.value));
    this.bindButtons(handlers);
  }

  /** ファイルの選択: ボタンで選択ダイアログを開き、選ばれたら渡す(同じファイルを続けて選べるよう、選択は空に戻す)。 */
  private bindFile(handlers: ToolbarHandlers): void {
    this.pick.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (file) handlers.chooseFile(file);
    });
  }

  /** ズームとダウンロードのボタンを、handlers に結びつける。 */
  private bindButtons(handlers: ToolbarHandlers): void {
    this.zoomOut.addEventListener('click', () => handlers.zoomOut());
    this.zoomIn.addEventListener('click', () => handlers.zoomIn());
    this.zoomLevel.addEventListener('click', () => handlers.zoomActual());
    this.zoomFit.addEventListener('click', () => handlers.zoomFit());
    this.download.addEventListener('click', () => handlers.download());
  }

  /** 操作の可否、列数の欄、倍率の表示を、model のとおりにする(入力中の列数の欄は、書き換えない)。 */
  render(model: ToolbarModel): void {
    const { flags } = model;
    this.pick.disabled = !flags.pick;
    this.columns.disabled = !flags.columns;
    if (model.pageCount > 0) this.columns.max = String(model.pageCount);
    if (document.activeElement !== this.columns) this.columns.value = model.columnsText;
    for (const button of [this.zoomOut, this.zoomIn, this.zoomLevel, this.zoomFit]) button.disabled = !flags.zoom;
    this.zoomLevel.textContent = model.zoomLabel;
    this.download.disabled = !flags.download;
  }

  /** 列数の欄に、値を書き戻す。 */
  writeColumns(columns: number): void {
    this.columns.value = String(columns);
  }
}

/** ツールバーを、index.html の要素に結びつけて、表示の更新口を返す。 */
export function bindToolbar(root: ParentNode, handlers: ToolbarHandlers): Toolbar {
  const view = new ToolbarView(root);
  view.bind(handlers);
  return view;
}
