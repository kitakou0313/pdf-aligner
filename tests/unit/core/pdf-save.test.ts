import { describe, expect, it } from 'vitest';
import { createController, type OpenedPdf, type PdfFile } from '../../../src/core/controller.ts';
import { formatPdfFailed } from '../../../src/core/messages.ts';
import type { Segment } from '../../../src/core/segments.ts';
import { INITIAL_STATE, reduce, statusLines, uiFlags, type AppEvent, type AppState } from '../../../src/core/state.ts';
import { createStore } from '../../../src/core/store.ts';
import { FakeSource } from './helpers/fake-source.ts';
import { A4, repeat } from './helpers/pages.ts';

/** イベントを順に適用した結果を返す。 */
function run(events: AppEvent[], from: AppState = INITIAL_STATE): AppState {
  return events.reduce(reduce, from);
}

const OPEN: AppEvent[] = [{ type: 'fileChosen', fileName: 'report.pdf' }, { type: 'loaded', pageCount: 12 }];
const RENDERING = run(OPEN);
const READY = run([...OPEN, { type: 'renderFinished', failedPages: [] }]);
// 区切り 4, 9 にして、表示中のセグメントの描画を終えた状態(区切りを変えると描き直しになるので、最後に完了させる)
const SPLIT = run([{ type: 'separatorsChanged', separators: [4, 9] }, { type: 'renderFinished', failedPages: [] }], READY);

describe('PDF の書き出しの状態(pdfSaveStarted / pdfSaveFinished / pdfSaveFailed)', () => {
  it('描画中と完了のときだけ始められる。未読み込み・読み込み中は無視する', () => {
    expect(run([{ type: 'pdfSaveStarted' }]).pdfSaving).toBe(false);
    expect(run([{ type: 'fileChosen', fileName: 'a.pdf' }, { type: 'pdfSaveStarted' }]).pdfSaving).toBe(false);
    expect(run([{ type: 'pdfSaveStarted' }], RENDERING).pdfSaving).toBe(true);
    expect(run([{ type: 'pdfSaveStarted' }], READY).pdfSaving).toBe(true);
  });

  it('保存中に、もう一度始めることはできない(状態は変わらない)', () => {
    const saving = run([{ type: 'pdfSaveStarted' }], READY);
    expect(reduce(saving, { type: 'pdfSaveStarted' })).toBe(saving);
  });

  it('PNG の一括保存中は始められない', () => {
    const batch = run([{ type: 'batchStarted' }], SPLIT);
    expect(batch.batch).not.toBeNull();
    expect(run([{ type: 'pdfSaveStarted' }], batch).pdfSaving).toBe(false);
  });

  it('終わると、保存中でなくなる。警告は残さない', () => {
    const state = run([{ type: 'pdfSaveStarted' }, { type: 'pdfSaveFinished' }], READY);
    expect(state.pdfSaving).toBe(false);
    expect(state.pdfStop).toBeNull();
  });

  it('失敗すると、保存中でなくなり、保存できた個数と総数を警告のために残す', () => {
    const state = run([{ type: 'pdfSaveStarted' }, { type: 'pdfSaveFailed', saved: 1, total: 3 }], SPLIT);
    expect(state.pdfSaving).toBe(false);
    expect(state.pdfStop).toEqual({ saved: 1, total: 3 });
  });

  it('保存中でないときの終了・失敗の通知(古い保存の遅れた通知)は無視する', () => {
    expect(reduce(READY, { type: 'pdfSaveFinished' })).toBe(READY);
    expect(reduce(READY, { type: 'pdfSaveFailed', saved: 0, total: 1 })).toBe(READY);
  });

  it('画像には影響しない(フェーズ、進捗、表示中のセグメントはそのまま)', () => {
    const state = run([{ type: 'pdfSaveStarted' }], SPLIT);
    expect({ ...state, pdfSaving: false }).toEqual(SPLIT);
  });

  it('警告は、新しい保存の開始、列数・区切り・セグメントの変更、別の PDF の選択で消える', () => {
    const failed = run([{ type: 'pdfSaveStarted' }, { type: 'pdfSaveFailed', saved: 0, total: 3 }], SPLIT);
    const cleared: AppEvent[] = [
      { type: 'pdfSaveStarted' },
      { type: 'columnsChanged', columns: 3 },
      { type: 'separatorsChanged', separators: [5] },
      { type: 'segmentSelected', start: 4 },
      { type: 'fileChosen', fileName: 'b.pdf' },
    ];
    for (const event of cleared) expect(run([event], failed).pdfStop, event.type).toBeNull();
  });

  it('PDF を選び直すと、保存中の記録も消える(古い保存の終了通知は、新しい PDF に影響しない)', () => {
    const saving = run([{ type: 'pdfSaveStarted' }], READY);
    const next = run([{ type: 'fileChosen', fileName: 'b.pdf' }], saving);
    expect(next.pdfSaving).toBe(false);
    expect(reduce(next, { type: 'pdfSaveFailed', saved: 0, total: 1 })).toBe(next);
  });
});

describe('uiFlags: PDF のボタン(blueprint の「画面の状態と操作の可否」)', () => {
  it('未読み込み・読み込み中は、どちらも無効', () => {
    for (const state of [INITIAL_STATE, run([{ type: 'fileChosen', fileName: 'a.pdf' }])]) {
      expect(uiFlags(state)).toMatchObject({ downloadPdf: false, downloadAllPdf: false });
    }
  });

  it('描画中でも、PDF が読めていれば「PDFをダウンロード」は有効。「すべて」は区切りがあるときだけ', () => {
    expect(uiFlags(RENDERING)).toMatchObject({ downloadPdf: true, downloadAllPdf: false });
    const split = run([{ type: 'separatorsChanged', separators: [4] }], RENDERING);
    expect(uiFlags(split)).toMatchObject({ downloadPdf: true, downloadAllPdf: true });
  });

  it('PDF の保存中は、PDF のボタンだけが無効。PNG のボタンと他の操作は、そのまま', () => {
    const saving = run([{ type: 'pdfSaveStarted' }], SPLIT);
    expect(uiFlags(saving)).toMatchObject({ downloadPdf: false, downloadAllPdf: false });
    expect(uiFlags(saving)).toMatchObject({ download: true, downloadAll: true, columns: true, separators: true, pick: true });
  });

  it('PNG の一括保存中は、PDF のボタンも無効', () => {
    const batch = run([{ type: 'batchStarted' }], SPLIT);
    expect(uiFlags(batch)).toMatchObject({ downloadPdf: false, downloadAllPdf: false });
  });
});

describe('statusLines: PDF を書き出せなかったときの警告', () => {
  it('保存できた個数と総数を含む警告の行を出す', () => {
    const failed = run([{ type: 'pdfSaveStarted' }, { type: 'pdfSaveFailed', saved: 1, total: 3 }], SPLIT);
    expect(statusLines(failed)).toContainEqual({ kind: 'warning', text: formatPdfFailed(1, 3) });
    expect(formatPdfFailed(1, 3)).toBe('PDF を書き出せませんでした。3 個中 1 個を保存しました。');
  });

  it('警告がなければ、PDF に関する行は出ない', () => {
    expect(statusLines(SPLIT)).toEqual([]);
  });
});

/** 偽物の PDF: 切り出しを記録し、指定した番号(0 始まりの呼び出し順)の切り出しだけ失敗させられる。 */
class SlicingPdf implements OpenedPdf {
  readonly source = new FakeSource(repeat(A4, 12));
  readonly sliced: Segment[] = [];
  failAt = -1;

  /** 切り出しを記録し、中身の代わりにセグメントを文字にしたバイト列を返す(failAt 番目の呼び出しは失敗)。 */
  async slice(segment: Segment): Promise<Uint8Array> {
    if (this.sliced.length === this.failAt) throw new Error('切り出せない');
    this.sliced.push(segment);
    return new TextEncoder().encode(`${segment.start}-${segment.end}`);
  }

  /** この偽物では使わない。 */
  close(): void {}

  /** この偽物では使わない。 */
  renderThumbnail(): Promise<void> {
    return Promise.resolve();
  }
}

/** 保存された PDF(名前と、中身の文字列)。 */
interface SavedPdf {
  readonly name: string;
  readonly text: string;
}

/** 何もしない(描画の準備など、この試験の対象外の依存の代わり)。 */
function nothing(): void {}

/** 常に成功する PNG の保存(この試験の対象外)。 */
async function savesImage(): Promise<boolean> {
  return true;
}

/** コントローラと記録(保存された PDF の名前と中身)を組み立てる。open は、pdf を返す。 */
function build(open: () => Promise<OpenedPdf>) {
  const store = createStore(INITIAL_STATE, reduce);
  const saved: SavedPdf[] = [];
  /** 保存された PDF を、名前と中身の文字列で記録する。 */
  const savePdf = (data: Uint8Array, name: string): void => void saved.push({ name, text: new TextDecoder().decode(data) });
  const controller = createController<PdfFile>({ store, open, prepare: nothing, saveImage: savesImage, savePdf });
  return { store, controller, saved };
}

/** コントローラと記録を組み立て、PDF を開いて、区切り 4, 9 にした状態にする。 */
async function openSplit(pdf: SlicingPdf) {
  const kit = build(async () => pdf);
  await kit.controller.chooseFile({ name: 'report.pdf' });
  await kit.controller.setSeparators([4, 9]);
  return kit;
}

describe('コントローラの PDF の書き出し(downloadPdf / downloadAllPdf)', () => {
  it('downloadPdf は、表示中のセグメントだけを、範囲つきの名前で保存する', async () => {
    const { controller, saved, store } = await openSplit(new SlicingPdf());
    await controller.selectSegment(4);
    await controller.downloadPdf();
    expect(saved).toEqual([{ name: 'report-p04-08.pdf', text: '4-8' }]);
    expect(store.getState().pdfSaving).toBe(false);
    expect(store.getState().pdfStop).toBeNull();
  });

  it('区切りなしのときの downloadPdf は、全ページを 1 つの PDF として保存する', async () => {
    const pdf = new SlicingPdf();
    const { controller, saved } = await openSplit(pdf);
    await controller.setSeparators([]);
    await controller.downloadPdf();
    expect(saved).toEqual([{ name: 'report-p01-12.pdf', text: '1-12' }]);
  });

  it('downloadAllPdf は、全セグメントを先頭から順に、1 ファイルずつ保存する(合計ページ数は総ページ数)', async () => {
    const { controller, saved, store } = await openSplit(new SlicingPdf());
    await controller.downloadAllPdf();
    expect(saved.map((file) => file.name)).toEqual(['report-p01-03.pdf', 'report-p04-08.pdf', 'report-p09-12.pdf']);
    expect(saved.map((file) => file.text)).toEqual(['1-3', '4-8', '9-12']);
    expect(store.getState().pdfSaving).toBe(false);
  });

  it('区切りなしのとき、downloadAllPdf は何もしない', async () => {
    const { controller, saved } = await openSplit(new SlicingPdf());
    await controller.setSeparators([]);
    await controller.downloadAllPdf();
    expect(saved).toEqual([]);
  });

  it('保存の前後で、表示中のセグメントも、描画の状態も変わらない', async () => {
    const { controller, store } = await openSplit(new SlicingPdf());
    await controller.selectSegment(4);
    const before = store.getState();
    await controller.downloadAllPdf();
    expect(store.getState()).toEqual(before);
  });

  it('途中で切り出しに失敗したら、そこで止まり、保存できた個数を警告に残す', async () => {
    const pdf = new SlicingPdf();
    pdf.failAt = 1;
    const { controller, saved, store } = await openSplit(pdf);
    await controller.downloadAllPdf();
    expect(saved.map((file) => file.name)).toEqual(['report-p01-03.pdf']);
    expect(pdf.sliced).toHaveLength(1);
    expect(store.getState().pdfStop).toEqual({ saved: 1, total: 3 });
    expect(store.getState().pdfSaving).toBe(false);
  });

  it('downloadPdf の切り出しが失敗したら、0 個中…ではなく 1 個中 0 個の警告になる', async () => {
    const pdf = new SlicingPdf();
    pdf.failAt = 0;
    const { controller, saved, store } = await openSplit(pdf);
    await controller.downloadPdf();
    expect(saved).toEqual([]);
    expect(store.getState().pdfStop).toEqual({ saved: 0, total: 1 });
  });

  it('描画中でも保存できる(描画の完了を待たない)', async () => {
    const pdf = new SlicingPdf();
    const { controller, saved } = await openSplit(pdf);
    const pending = controller.setColumns(2);
    await controller.downloadPdf();
    await pending;
    expect(saved).toHaveLength(1);
  });

  it('保存の途中で別の PDF を選んだら、古い保存の残りは保存せず、新しい状態を壊さない', async () => {
    const first = new SlicingPdf();
    const { controller, saved, store } = await openSplit(first);
    const saving = controller.downloadAllPdf();
    await controller.chooseFile({ name: 'next.pdf' });
    await saving;
    expect(saved.length).toBeLessThan(3);
    expect(store.getState().pdfStop).toBeNull();
    expect(store.getState().pdfSaving).toBe(false);
  });

  it('PDF を開いていないときは、何もしない', async () => {
    const { store, controller, saved } = build(async () => new SlicingPdf());
    await controller.downloadPdf();
    await controller.downloadAllPdf();
    expect(saved).toEqual([]);
    expect(store.getState()).toBe(INITIAL_STATE);
  });
});
