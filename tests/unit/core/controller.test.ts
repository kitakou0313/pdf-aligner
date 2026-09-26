import { describe, expect, it, vi } from 'vitest';
import { createController, OpenFailure, type Controller, type OpenedPdf, type PdfFile } from '../../../src/core/controller.ts';
import { computeLayout, type Layout } from '../../../src/core/layout.ts';
import { INITIAL_STATE, reduce, type AppEvent, type AppState } from '../../../src/core/state.ts';
import { createStore, type Store } from '../../../src/core/store.ts';
import { FakeSource, type Behavior } from './helpers/fake-source.ts';
import { A4, repeat } from './helpers/pages.ts';

/** 外から解決・拒否できる Promise(処理の順序を、テストが決めるため)。 */
class Gate<T = void> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (reason: unknown) => void;

  /** 未解決の Promise を作る。 */
  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

/** 出来事の記録(ログ)と、その中での名前。閉じたことを、他の出来事との前後関係つきで確かめるために使う。 */
interface LogTo {
  readonly log: string[];
  readonly label: string;
}

/** 開いた PDF の偽物。close の回数を数え、ログを渡されたら「close <名前>」も記録する。 */
class FakePdf implements OpenedPdf {
  readonly source: FakeSource;
  closed = 0;
  private readonly logTo: LogTo | undefined;

  /** ページ数と描画の振る舞い、(あれば)ログから作る。 */
  constructor(pageCount: number, behavior?: Behavior, logTo?: LogTo) {
    this.source = new FakeSource(repeat(A4, pageCount), behavior);
    this.logTo = logTo;
  }

  /** 閉じた回数を数える。 */
  close(): void {
    this.closed += 1;
    this.logTo?.log.push(`close ${this.logTo.label}`);
  }
}

/** prepare の追加動作: 「prepare <ページ数>」をログに残す。 */
function logPrepare(log: string[]): (layout: Layout) => void {
  return (layout) => void log.push(`prepare ${layout.placements.length}`);
}

/** prepare の追加動作: flag.broken が true の間は、例外を投げる。 */
function throwWhile(flag: { broken: boolean }): () => void {
  return () => {
    if (flag.broken) throw new Error('canvas broke');
  };
}

/** ファイルの偽物(名前だけを持つ)。 */
function file(name: string): PdfFile {
  return { name };
}

/** 中断(abort)されるまで、いつまでも待つ描画の振る舞い。中断されたら例外で終わる(pdf.js の RenderingCancelledException 相当)。 */
function hangUntilAborted(): Behavior {
  return (_index, signal) =>
    new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('cancelled')));
    });
}

/** 指定したページ(0 始まり)に最初に来たときだけ、中断されるまで待つ振る舞い(他のページと、2 回目以降は即座に成功)。 */
function hangAt(target: number): Behavior {
  const hang = hangUntilAborted();
  let hung = false;
  return (index, signal) => {
    if (index !== target || hung) return Promise.resolve();
    hung = true;
    return hang(index, signal);
  };
}

/** 指定したページに 1 回目に来たら中断されるまで待ち、2 回目に来たら gate が開くまで待つ振る舞い(他のページは即座に成功)。 */
function hangThenHold(target: number, gate: Gate): Behavior {
  const hang = hangUntilAborted();
  let visits = 0;
  return (index, signal) => {
    if (index !== target) return Promise.resolve();
    visits += 1;
    return visits === 1 ? hang(index, signal) : gate.promise;
  };
}

/** 指定したページ(0 始まり)だけ失敗する振る舞い。 */
function failAt(...bad: number[]): Behavior {
  return async (index) => {
    if (bad.includes(index)) throw new Error(`page ${index} broke`);
  };
}

interface Kit {
  readonly store: Store<AppState, AppEvent>;
  readonly controller: Controller;
  readonly prepared: Layout[];
  readonly phases: string[];
}

/** ストア、コントローラ、記録用の入れ物を組み立てる。open は、ファイルごとに用意した PDF(または例外)を返す。 */
function setup(open: (file: PdfFile) => Promise<OpenedPdf>, extra: { prepare?: (layout: Layout) => void } = {}): Kit {
  const store = createStore(INITIAL_STATE, reduce);
  const prepared: Layout[] = [];
  const phases: string[] = [store.getState().phase];
  store.subscribe((state) => phases.push(state.phase));
  /** 渡されたレイアウトを記録してから、追加動作(あれば)を行う。 */
  const prepare = (layout: Layout): void => {
    prepared.push(layout);
    extra.prepare?.(layout);
  };
  return { store, controller: createController({ store, open, prepare }), prepared, phases };
}

/** 常に同じ PDF を返す open。 */
function alwaysOpens(pdf: OpenedPdf): (file: PdfFile) => Promise<OpenedPdf> {
  return async () => pdf;
}

describe('PDF の選択 → 読み込み → 描画 → 完了', () => {
  it('選ぶと、読み込み中を経て、全ページを描き、完了になる。列数は 10 と総ページ数の小さい方', async () => {
    const pdf = new FakePdf(12);
    const { store, controller, prepared, phases } = setup(alwaysOpens(pdf));
    await controller.chooseFile(file('report.pdf'));
    expect(store.getState()).toMatchObject({ phase: 'ready', fileName: 'report.pdf', pageCount: 12, columns: 10 });
    expect(pdf.source.calls).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(prepared).toEqual([computeLayout(repeat(A4, 12), 10, 2)]);
    expect(phases).toContain('loading');
    expect(phases.at(-1)).toBe('ready');
  });

  it('選んだ瞬間(読み込みの完了を待たずに)、状態は読み込み中になる', async () => {
    const gate = new Gate<OpenedPdf>();
    const { store, controller } = setup(() => gate.promise);
    const done = controller.chooseFile(file('a.pdf'));
    expect(store.getState()).toMatchObject({ phase: 'loading', fileName: 'a.pdf' });
    gate.resolve(new FakePdf(3));
    await done;
    expect(store.getState().phase).toBe('ready');
  });

  it('進捗は 0 から総ページ数まで、1 ページずつ増える', async () => {
    const { store, controller } = setup(alwaysOpens(new FakePdf(4)));
    const seen: number[] = [];
    store.subscribe((state) => state.phase === 'rendering' && seen.push(state.progress.done));
    await controller.chooseFile(file('a.pdf'));
    expect([...new Set(seen)]).toEqual([0, 1, 2, 3, 4]);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('同じファイルを続けて選んでも、もう一度読み込んで描き直す', async () => {
    const open = vi.fn(async () => new FakePdf(3));
    const { store, controller, prepared } = setup(open);
    await controller.chooseFile(file('a.pdf'));
    await controller.chooseFile(file('a.pdf'));
    expect(open).toHaveBeenCalledTimes(2);
    expect(prepared).toHaveLength(2);
    expect(store.getState().phase).toBe('ready');
  });

  it('前の PDF は、次の PDF を開く前に閉じる(全状態の置き換え)', async () => {
    const first = new FakePdf(3);
    const second = new FakePdf(2);
    const pdfs = [first, second];
    const { store, controller } = setup(async () => pdfs.shift() as FakePdf);
    await controller.chooseFile(file('a.pdf'));
    await controller.chooseFile(file('b.pdf'));
    expect(first.closed).toBe(1);
    expect(second.closed).toBe(0);
    expect(store.getState()).toMatchObject({ fileName: 'b.pdf', pageCount: 2, columns: 2 });
  });

  it('縮小が必要なときは、縮小したレイアウトで準備し、縮小の情報を状態に持つ', async () => {
    const store = createStore(INITIAL_STATE, reduce);
    const prepared: Layout[] = [];
    const limits = { maxSide: 4000, maxArea: 4_000_000 };
    const prepare = prepared.push.bind(prepared);
    const controller = createController({ store, open: alwaysOpens(new FakePdf(12)), prepare, limits });
    await controller.chooseFile(file('big.pdf'));
    expect(prepared[0]?.scale).toBeLessThan(2);
    expect(store.getState().shrink).toMatchObject({ scale: prepared[0]?.scale, width: prepared[0]?.width });
  });
});

describe('読み込みの失敗', () => {
  it.each(['encrypted', 'invalid'] as const)('OpenFailure(%s)なら、未読み込みに戻ってそのエラーだけを残す。何も準備しない', async (kind) => {
    const { store, controller, prepared } = setup(async () => {
      throw new OpenFailure(kind, new Error('x'));
    });
    await controller.chooseFile(file('a.pdf'));
    expect(store.getState()).toMatchObject({ phase: 'idle', fileName: null, error: kind });
    expect(prepared).toEqual([]);
  });

  it('原因が分からない例外は、「壊れているか PDF ではない」として扱う', async () => {
    const { store, controller } = setup(async () => {
      throw new TypeError('unexpected');
    });
    await controller.chooseFile(file('a.pdf'));
    expect(store.getState()).toMatchObject({ phase: 'idle', error: 'invalid' });
  });

  it('0 ページの PDF は、「ページがありません」のエラーにして、開いた PDF を閉じる', async () => {
    const pdf = new FakePdf(0);
    const { store, controller, prepared } = setup(alwaysOpens(pdf));
    await controller.chooseFile(file('empty.pdf'));
    expect(store.getState()).toMatchObject({ phase: 'idle', error: 'empty' });
    expect(pdf.closed).toBe(1);
    expect(prepared).toEqual([]);
  });

  it('失敗した後、表示中だった前の PDF は破棄されていて、次の PDF を選び直せる', async () => {
    const good = new FakePdf(3);
    const queue: Array<() => Promise<OpenedPdf>> = [async () => good, async () => Promise.reject(new OpenFailure('invalid', 1)), async () => new FakePdf(2)];
    const { store, controller } = setup(() => (queue.shift() as () => Promise<OpenedPdf>)());
    await controller.chooseFile(file('a.pdf'));
    await controller.chooseFile(file('broken.pdf'));
    expect(store.getState()).toMatchObject({ phase: 'idle', pageCount: 0, error: 'invalid' });
    expect(good.closed).toBe(1);
    await controller.chooseFile(file('b.pdf'));
    expect(store.getState()).toMatchObject({ phase: 'ready', pageCount: 2, error: null });
  });
});

describe('別の PDF を選んだときの、読み込み・描画の置き換え', () => {
  it('読み込み中に別の PDF を選ぶと、先の読み込みは(遅れて終わっても)捨てられ、その PDF は閉じられる', async () => {
    const slow = new Gate<OpenedPdf>();
    const slowPdf = new FakePdf(5);
    const fastPdf = new FakePdf(2);
    const open = vi.fn((f: PdfFile) => (f.name === 'slow.pdf' ? slow.promise : Promise.resolve(fastPdf)));
    const { store, controller, prepared } = setup(open);
    const first = controller.chooseFile(file('slow.pdf'));
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    await controller.chooseFile(file('fast.pdf'));
    slow.resolve(slowPdf);
    await first;
    expect(store.getState()).toMatchObject({ phase: 'ready', fileName: 'fast.pdf', pageCount: 2 });
    expect(slowPdf.closed).toBe(1);
    expect(slowPdf.source.calls).toEqual([]);
    expect(prepared).toHaveLength(1);
  });

  it('後の PDF の読み込み中に、先の読み込みが失敗しても、後の読み込みは(読み込み中のまま)続き、エラーは出ない', async () => {
    const slow = new Gate<OpenedPdf>();
    const later = new Gate<OpenedPdf>();
    const open = vi.fn<(file: PdfFile) => Promise<OpenedPdf>>((f) => (f.name === 'slow.pdf' ? slow.promise : later.promise));
    const { store, controller } = setup(open);
    const first = controller.chooseFile(file('slow.pdf'));
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const second = controller.chooseFile(file('later.pdf'));
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    slow.reject(new OpenFailure('encrypted', 1));
    await first;
    expect(store.getState()).toMatchObject({ phase: 'loading', fileName: 'later.pdf', error: null });
    later.resolve(new FakePdf(2));
    await second;
    expect(store.getState()).toMatchObject({ phase: 'ready', fileName: 'later.pdf', error: null });
  });

  it('続けて 2 つ選んだとき(先の読み込みを始める前)は、先の PDF を開かず、後の PDF だけを開く', async () => {
    const open = vi.fn<(file: PdfFile) => Promise<OpenedPdf>>(async () => new FakePdf(2));
    const { store, controller } = setup(open);
    await Promise.all([controller.chooseFile(file('first.pdf')), controller.chooseFile(file('second.pdf'))]);
    expect(open.mock.calls.map(([f]) => f.name)).toEqual(['second.pdf']);
    expect(store.getState()).toMatchObject({ phase: 'ready', fileName: 'second.pdf' });
  });

  it('先の読み込みが(遅れて)失敗しても、後から選んだ PDF の表示にエラーを出さない', async () => {
    const slow = new Gate<OpenedPdf>();
    const open = vi.fn((f: PdfFile) => (f.name === 'slow.pdf' ? slow.promise : Promise.resolve(new FakePdf(2))));
    const { store, controller } = setup(open);
    const first = controller.chooseFile(file('slow.pdf'));
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    await controller.chooseFile(file('fast.pdf'));
    slow.reject(new OpenFailure('encrypted', 1));
    await first;
    expect(store.getState()).toMatchObject({ phase: 'ready', fileName: 'fast.pdf', error: null });
  });

  it('描画中に別の PDF を選ぶと、描画を中断し、中断が終わってから前の PDF を閉じ、新しい PDF を描く', async () => {
    const log: string[] = [];
    const old = new FakePdf(6, hangAt(2), { log, label: 'old' });
    const pdfs = [old, new FakePdf(3)];
    const { store, controller } = setup(async () => pdfs.shift() as FakePdf, { prepare: logPrepare(log) });
    const first = controller.chooseFile(file('old.pdf'));
    await vi.waitFor(() => expect(old.source.calls).toEqual([0, 1, 2]));
    await controller.chooseFile(file('new.pdf'));
    await first;
    expect(log).toEqual(['prepare 6', 'close old', 'prepare 3']);
    expect(store.getState()).toMatchObject({ phase: 'ready', fileName: 'new.pdf', pageCount: 3 });
    expect(old.source.calls).toEqual([0, 1, 2]);
  });
});

describe('列数の変更', () => {
  /** 12 ページの PDF を描き終えた状態のキットを返す。 */
  async function readyKit(pdf: FakePdf = new FakePdf(12)): Promise<{ kit: Kit; pdf: FakePdf }> {
    const kit = setup(alwaysOpens(pdf));
    await kit.controller.chooseFile(file('a.pdf'));
    return { kit, pdf };
  }

  it('完了後に変えると、新しい列数のレイアウトで最初から描き直して、また完了する', async () => {
    const { kit, pdf } = await readyKit();
    await kit.controller.setColumns(4);
    expect(kit.store.getState()).toMatchObject({ phase: 'ready', columns: 4 });
    expect(kit.prepared.at(-1)).toEqual(computeLayout(repeat(A4, 12), 4, 2));
    expect(pdf.source.calls).toHaveLength(24);
    const afterFirstReady = kit.phases.slice(kit.phases.indexOf('ready') + 1);
    expect(afterFirstReady).toContain('rendering');
    expect(afterFirstReady.at(-1)).toBe('ready');
  });

  it('変更した瞬間(描き直しの完了を待たずに)、状態は描画中になる', async () => {
    const { kit } = await readyKit();
    const done = kit.controller.setColumns(3);
    expect(kit.store.getState()).toMatchObject({ phase: 'rendering', columns: 3 });
    await done;
  });

  it('描画中に変えると、進行中の描画を中断して、最初から描き直す。中断した描画の続きは描かれない', async () => {
    const pdf = new FakePdf(12, hangAt(5));
    const kit = setup(alwaysOpens(pdf));
    const first = kit.controller.chooseFile(file('a.pdf'));
    await vi.waitFor(() => expect(pdf.source.calls).toHaveLength(6));
    pdf.source.calls.length = 0;
    await kit.controller.setColumns(2);
    await first;
    expect(pdf.source.calls).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(kit.prepared.map((l) => l.columns)).toEqual([10, 2]);
    expect(kit.store.getState()).toMatchObject({ phase: 'ready', columns: 2 });
  });

  it('中断した描画は、完了を通知しない: 新しい描画が終わるまでは、描画中のまま(完了になってから、また描画中に戻らない)', async () => {
    const gate = new Gate();
    const pdf = new FakePdf(12, hangThenHold(2, gate));
    const kit = setup(alwaysOpens(pdf));
    const first = kit.controller.chooseFile(file('a.pdf'));
    await vi.waitFor(() => expect(pdf.source.calls).toEqual([0, 1, 2]));
    const change = kit.controller.setColumns(4);
    await vi.waitFor(() => expect(pdf.source.calls).toEqual([0, 1, 2, 0, 1, 2]));
    expect(kit.store.getState()).toMatchObject({ phase: 'rendering', columns: 4 });
    expect(kit.phases.filter((phase) => phase === 'ready'), '新しい描画が終わるまで、完了になっていない').toHaveLength(0);
    gate.resolve();
    await Promise.all([first, change]);
    expect(kit.store.getState()).toMatchObject({ phase: 'ready', columns: 4 });
    expect(kit.phases.filter((phase) => phase === 'ready'), '完了になるのは 1 回だけ').toHaveLength(1);
  });

  it('立て続けに変えても、描画が始まるのは最後の列数だけ(途中の値では描かない)', async () => {
    const { kit } = await readyKit();
    const before = kit.prepared.length;
    const all = [kit.controller.setColumns(2), kit.controller.setColumns(3), kit.controller.setColumns(4)];
    await Promise.all(all);
    expect(kit.prepared.slice(before).map((l) => l.columns)).toEqual([4]);
    expect(kit.store.getState()).toMatchObject({ phase: 'ready', columns: 4 });
  });

  it('同じ列数、範囲外の列数、PDF を読み込む前は、何もしない(描き直さない)', async () => {
    const { kit, pdf } = await readyKit();
    const before = { prepared: kit.prepared.length, calls: pdf.source.calls.length };
    for (const columns of [10, 0, 13, 2.5]) await kit.controller.setColumns(columns);
    expect(kit.prepared).toHaveLength(before.prepared);
    expect(pdf.source.calls).toHaveLength(before.calls);
    const idle = setup(alwaysOpens(new FakePdf(3)));
    await idle.controller.setColumns(2);
    expect(idle.store.getState().phase).toBe('idle');
    expect(idle.prepared).toEqual([]);
  });

  it('描き直すと、前の警告(失敗したページ)は消え、新しい描画の結果で置き換わる', async () => {
    const pdf = new FakePdf(12, failAt(3));
    const kit = setup(alwaysOpens(pdf));
    await kit.controller.chooseFile(file('a.pdf'));
    expect(kit.store.getState().failedPages).toEqual([3]);
    const seen: (readonly number[])[] = [];
    kit.store.subscribe((state) => seen.push(state.failedPages));
    await kit.controller.setColumns(5);
    expect(seen[0]).toEqual([]);
    expect(kit.store.getState().failedPages).toEqual([3]);
  });
});

describe('ページ単位の失敗と、描画そのものの失敗', () => {
  it('一部のページが失敗しても、他のページを描き、完了して、失敗したページ(0 始まり)を記録する', async () => {
    const pdf = new FakePdf(6, failAt(1, 4));
    const { store, controller } = setup(alwaysOpens(pdf));
    await controller.chooseFile(file('a.pdf'));
    expect(pdf.source.calls).toEqual([0, 1, 2, 3, 4, 5]);
    expect(store.getState()).toMatchObject({ phase: 'ready', failedPages: [1, 4] });
  });

  it('レイアウトの準備で例外が起きたら、未読み込みに戻って「読み込めなかった」エラーにし、PDF を閉じる。その後も使える', async () => {
    const crashed = new FakePdf(3);
    const pdfs = [crashed, new FakePdf(2)];
    const flag = { broken: true };
    const { store, controller } = setup(async () => pdfs.shift() as FakePdf, { prepare: throwWhile(flag) });
    await controller.chooseFile(file('a.pdf'));
    expect(store.getState()).toMatchObject({ phase: 'idle', error: 'invalid', fileName: null });
    expect(crashed.closed, '描画に失敗した PDF は、閉じられる').toBe(1);
    expect(pdfs).toHaveLength(1);
    flag.broken = false;
    await controller.chooseFile(file('b.pdf'));
    expect(store.getState()).toMatchObject({ phase: 'ready', fileName: 'b.pdf', error: null });
  });
});

describe('複数ファイルのドロップ(rejectDrop)', () => {
  it('表示中の PDF、画像、列数はそのままで、エラーだけを出す。描き直しも、PDF を閉じることもしない', async () => {
    const pdf = new FakePdf(12);
    const { store, controller, prepared } = setup(alwaysOpens(pdf));
    await controller.chooseFile(file('a.pdf'));
    const before = store.getState();
    controller.rejectDrop();
    expect(store.getState()).toEqual({ ...before, error: 'multipleFiles' });
    expect(prepared).toHaveLength(1);
    expect(pdf.closed).toBe(0);
  });

  it('描画中に受け付けても、描画を止めない', async () => {
    const pdf = new FakePdf(6, hangAt(2));
    const { store, controller } = setup(alwaysOpens(pdf));
    const first = controller.chooseFile(file('a.pdf'));
    await vi.waitFor(() => expect(pdf.source.calls).toEqual([0, 1, 2]));
    controller.rejectDrop();
    expect(store.getState()).toMatchObject({ phase: 'rendering', error: 'multipleFiles' });
    await controller.chooseFile(file('b.pdf'));
    await first;
    expect(store.getState().error).toBeNull();
  });
});
