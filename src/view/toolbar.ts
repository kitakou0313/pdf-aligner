import type { UiFlags } from '../core/state.ts';
import { requireElement } from './dom.ts';

/** ツールバーの操作を受け取る側(ロジックは持たず、値や合図を渡すだけ)。 */
export interface ToolbarHandlers {
  chooseFile(file: File): void;
  columnsInput(raw: string): void;
  columnsCommit(raw: string): void;
  separatorsInput(raw: string): void;
  separatorsCommit(raw: string): void;
  /** セグメントが選ばれた。start は、選ばれたセグメントの先頭ページ(1 始まり)。 */
  segmentSelected(start: number): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomActual(): void;
  zoomFit(): void;
  download(): void;
  /** 「すべてダウンロード」のボタン(一括保存中は「キャンセル」になる)が押された。 */
  downloadAll(): void;
}

/** セグメントの選択肢: 表示する文言と、選択肢の値になる、セグメントの先頭ページ。 */
export interface SegmentOption {
  readonly label: string;
  readonly start: number;
}

/** ツールバーに表示する内容(操作の可否、列数と区切りの欄、セグメントの選択肢、倍率の表示)。 */
export interface ToolbarModel {
  readonly flags: UiFlags;
  readonly columnsText: string;
  readonly separatorsText: string;
  readonly segments: readonly SegmentOption[];
  readonly segmentStart: number;
  readonly pageCount: number;
  readonly zoomLabel: string;
}

/** ツールバーの表示の更新口。 */
export interface Toolbar {
  render(model: ToolbarModel): void;
  /** 列数の欄に、値を書き戻す(確定したときの丸め)。 */
  writeColumns(columns: number): void;
  /** 区切りの欄に、文字列を書き戻す(確定したときの正規化)。 */
  writeSeparators(text: string): void;
}

/** ツールバーの、入力欄と選択の要素。 */
interface Fields {
  readonly fileInput: HTMLInputElement;
  readonly columns: HTMLInputElement;
  readonly separators: HTMLInputElement;
  readonly segment: HTMLSelectElement;
}

/** ツールバーの、ボタンの要素。 */
interface Buttons {
  readonly pick: HTMLButtonElement;
  readonly zoomOut: HTMLButtonElement;
  readonly zoomIn: HTMLButtonElement;
  readonly zoomLevel: HTMLButtonElement;
  readonly zoomFit: HTMLButtonElement;
  readonly download: HTMLButtonElement;
  readonly downloadAll: HTMLButtonElement;
}

/** root の中から、入力欄と選択の要素を取り出す。 */
function findFields(root: ParentNode): Fields {
  return {
    fileInput: requireElement(root, '#file-input'),
    columns: requireElement(root, '#columns'),
    separators: requireElement(root, '#separators'),
    segment: requireElement(root, '#segment'),
  };
}

/** root の中から、ボタンの要素を取り出す。 */
function findButtons(root: ParentNode): Buttons {
  return {
    pick: requireElement(root, '#pick'),
    zoomOut: requireElement(root, '#zoom-out'),
    zoomIn: requireElement(root, '#zoom-in'),
    zoomLevel: requireElement(root, '#zoom-level'),
    zoomFit: requireElement(root, '#zoom-fit'),
    download: requireElement(root, '#download'),
    downloadAll: requireElement(root, '#download-all'),
  };
}

/** セグメントの選択肢の要素を作る(値は、セグメントの先頭ページ)。 */
function optionElement(option: SegmentOption): HTMLOptionElement {
  const element = document.createElement('option');
  element.value = String(option.start);
  element.textContent = option.label;
  return element;
}

/** ツールバーの DOM 要素と、その表示の更新。 */
class ToolbarView implements Toolbar {
  private readonly fields: Fields;
  private readonly buttons: Buttons;
  private segmentKey = '';

  /** root の中の要素を取り出す。 */
  constructor(root: ParentNode) {
    this.fields = findFields(root);
    this.buttons = findButtons(root);
  }

  /** 各要素の操作を、handlers に結びつける。 */
  bind(handlers: ToolbarHandlers): void {
    this.bindFile(handlers);
    this.bindFields(handlers);
    this.bindButtons(handlers);
  }

  /** ファイルの選択: ボタンで選択ダイアログを開き、選ばれたら渡す(同じファイルを続けて選べるよう、選択は空に戻す)。 */
  private bindFile(handlers: ToolbarHandlers): void {
    const { fileInput } = this.fields;
    this.buttons.pick.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) handlers.chooseFile(file);
    });
  }

  /** 列数と区切りの欄(入力の途中と確定)と、セグメントの選択を、handlers に結びつける。 */
  private bindFields(handlers: ToolbarHandlers): void {
    const { columns, separators, segment } = this.fields;
    columns.addEventListener('input', () => handlers.columnsInput(columns.value));
    columns.addEventListener('change', () => handlers.columnsCommit(columns.value));
    separators.addEventListener('input', () => handlers.separatorsInput(separators.value));
    separators.addEventListener('change', () => handlers.separatorsCommit(separators.value));
    segment.addEventListener('change', () => handlers.segmentSelected(Number(segment.value)));
  }

  /** ズームとダウンロードのボタンを、handlers に結びつける。 */
  private bindButtons(handlers: ToolbarHandlers): void {
    const { zoomOut, zoomIn, zoomLevel, zoomFit, download, downloadAll } = this.buttons;
    zoomOut.addEventListener('click', () => handlers.zoomOut());
    zoomIn.addEventListener('click', () => handlers.zoomIn());
    zoomLevel.addEventListener('click', () => handlers.zoomActual());
    zoomFit.addEventListener('click', () => handlers.zoomFit());
    download.addEventListener('click', () => handlers.download());
    downloadAll.addEventListener('click', () => handlers.downloadAll());
  }

  /** 操作の可否、列数と区切りの欄、セグメントの選択肢、倍率の表示を、model のとおりにする(入力中の欄は、書き換えない)。 */
  render(model: ToolbarModel): void {
    this.renderFields(model);
    this.renderSegments(model);
    this.renderButtons(model);
  }

  /** 列数と区切りの欄の、有効・無効と中身を、model のとおりにする(入力中の欄の中身は、書き換えない)。 */
  private renderFields(model: ToolbarModel): void {
    const { columns, separators } = this.fields;
    columns.disabled = !model.flags.columns;
    separators.disabled = !model.flags.separators;
    if (model.pageCount > 0) columns.max = String(model.pageCount);
    if (document.activeElement !== columns) columns.value = model.columnsText;
    if (document.activeElement !== separators) separators.value = model.separatorsText;
  }

  /** セグメントの選択肢(変わったときだけ作り直す)と、選択中のセグメント、有効・無効を、model のとおりにする。 */
  private renderSegments(model: ToolbarModel): void {
    const { segment } = this.fields;
    const key = model.segments.map((option) => `${option.start}:${option.label}`).join('|');
    if (key !== this.segmentKey) segment.replaceChildren(...model.segments.map(optionElement));
    this.segmentKey = key;
    segment.value = String(model.segmentStart);
    segment.disabled = !model.flags.segments;
  }

  /** ボタンの有効・無効と、倍率の表示、「すべてダウンロード」の文言(一括保存中は「キャンセル」)を、model のとおりにする。 */
  private renderButtons(model: ToolbarModel): void {
    const { flags } = model;
    const { pick, zoomOut, zoomIn, zoomLevel, zoomFit, download, downloadAll } = this.buttons;
    pick.disabled = !flags.pick;
    for (const button of [zoomOut, zoomIn, zoomLevel, zoomFit]) button.disabled = !flags.zoom;
    zoomLevel.textContent = model.zoomLabel;
    download.disabled = !flags.download;
    downloadAll.textContent = flags.cancelBatch ? 'キャンセル' : 'すべてダウンロード';
    downloadAll.disabled = !(flags.downloadAll || flags.cancelBatch);
  }

  /** 列数の欄に、値を書き戻す。 */
  writeColumns(columns: number): void {
    this.fields.columns.value = String(columns);
  }

  /** 区切りの欄に、文字列を書き戻す。 */
  writeSeparators(text: string): void {
    this.fields.separators.value = text;
  }
}

/** ツールバーを、index.html の要素に結びつけて、表示の更新口を返す。 */
export function bindToolbar(root: ParentNode, handlers: ToolbarHandlers): Toolbar {
  const view = new ToolbarView(root);
  view.bind(handlers);
  return view;
}
