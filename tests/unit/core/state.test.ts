import { describe, expect, it } from 'vitest';
import { ERROR_TEXT, THUMBNAIL_PRIORITY_TEXT } from '../../../src/core/messages.ts';
import { INITIAL_STATE, reduce, shownImageName, shownIndex, statusLines, uiFlags, type AppEvent, type AppState } from '../../../src/core/state.ts';

/** オブジェクトを再帰的に凍結する(reduce が入力を書き換えたら、例外で気づけるようにする)。 */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** 状態を凍結した上で、イベントを順に適用した結果を返す。 */
function run(events: AppEvent[], from: AppState = INITIAL_STATE): AppState {
  return events.reduce((state, event) => reduce(deepFreeze(state), event), from);
}

/** 区切りの候補 2〜pageCount の、全ての部分集合(昇順)を列挙する。 */
function separatorSets(pageCount: number): number[][] {
  const candidates = Array.from({ length: Math.max(pageCount - 1, 0) }, (_, index) => index + 2);
  return Array.from({ length: 2 ** candidates.length }, (_, mask) => candidates.filter((_page, bit) => (mask >> bit) & 1));
}

/** pageCount ページの PDF で、区切り before の各セグメントを表示中に、区切りを after に変えたとき、旧セグメントの先頭ページを含む新しいセグメントを表示していることを確かめる。 */
function expectFollowsPage(pageCount: number, before: number[], after: number[]): void {
  const opened = run([{ type: 'fileChosen', fileName: 'a.pdf' }, { type: 'loaded', pageCount }, { type: 'renderFinished', failedPages: [] }]);
  const split = run([{ type: 'separatorsChanged', separators: before }], opened);
  for (const start of [1, ...before]) {
    const viewing = run([{ type: 'segmentSelected', start }], split);
    const state = run([{ type: 'separatorsChanged', separators: after }], viewing);
    const containing = [...after].reverse().find((page) => page <= start) ?? 1;
    expect(state.segmentStart, `n=${pageCount} ${before}→${after} 先頭 ${start}`).toBe(containing);
  }
}

const CHOOSE: AppEvent = { type: 'fileChosen', fileName: 'report.pdf' };
const LOADED_12: AppEvent = { type: 'loaded', pageCount: 12 };
const LOADING = run([CHOOSE]);
const RENDERING = run([CHOOSE, LOADED_12]);
const READY = run([CHOOSE, LOADED_12, { type: 'renderFinished', failedPages: [] }]);
const IDLE_WITH_ERROR = run([CHOOSE, { type: 'loadFailed', error: 'encrypted' }]);
const RENDERING_20 = run([CHOOSE, { type: 'loaded', pageCount: 20 }]);
const READY_20 = run([{ type: 'renderFinished', failedPages: [] }], RENDERING_20);
// 20 ページの PDF を、区切り 5, 8 で分けて(p.1–4 / p.5–7 / p.8–20)、先頭のセグメントを描き終えた状態
const SPLIT = run([{ type: 'separatorsChanged', separators: [5, 8] }, { type: 'renderFinished', failedPages: [] }], READY_20);
// SPLIT から、一括保存を始めた状態
const BATCHING = run([{ type: 'batchStarted' }], SPLIT);

describe('初期状態', () => {
  it('未読み込み(idle)で、ファイルもエラーもない', () => {
    expect(INITIAL_STATE).toMatchObject({ phase: 'idle', fileName: null, pageCount: 0, error: null });
    expect(INITIAL_STATE.failedPages).toEqual([]);
    expect(INITIAL_STATE.shrink).toBeNull();
    expect(INITIAL_STATE.deferredForThumbnails).toBe(false);
  });
});

describe('PDF の選択と読み込み(fileChosen → loaded / loadFailed)', () => {
  it('選択すると loading になり、ファイル名を持つ', () => {
    expect(LOADING).toMatchObject({ phase: 'loading', fileName: 'report.pdf', pageCount: 0, error: null });
  });

  it('読み込めたら rendering になり、列数は「10 と総ページ数の小さい方」、進捗は 0/総ページ数', () => {
    expect(RENDERING).toMatchObject({ phase: 'rendering', pageCount: 12, columns: 10 });
    expect(RENDERING.progress).toEqual({ done: 0, total: 12 });
    expect(run([CHOOSE, { type: 'loaded', pageCount: 4 }]).columns).toBe(4);
  });

  it('総ページ数が 0 なら、idle に戻って「ページがありません」のエラー', () => {
    const state = run([CHOOSE, { type: 'loaded', pageCount: 0 }]);
    expect(state).toMatchObject({ phase: 'idle', fileName: null, error: 'empty' });
  });

  it.each(['encrypted', 'invalid'] as const)('読み込みに失敗(%s)したら、idle に戻ってエラーだけが残る', (error) => {
    expect(run([CHOOSE, { type: 'loadFailed', error }])).toMatchObject({
      phase: 'idle',
      fileName: null,
      pageCount: 0,
      error,
    });
  });

  it('どの状態からでも、別の PDF を選べる。全ての状態(列数、進捗、警告、縮小、エラー)を置き換える', () => {
    const dirty = run(
      [
        { type: 'layoutPlanned', scale: 1.5, width: 100, height: 200, shrunk: true },
        { type: 'renderFinished', failedPages: [3] },
        { type: 'columnsChanged', columns: 5 },
        { type: 'dropRejected' },
      ],
      RENDERING,
    );
    for (const from of [INITIAL_STATE, LOADING, RENDERING, READY, IDLE_WITH_ERROR, dirty]) {
      expect(run([{ type: 'fileChosen', fileName: 'next.pdf' }], from)).toEqual({ ...LOADING, fileName: 'next.pdf' });
    }
  });
});

describe('描画の進行(layoutPlanned / progress / renderFinished)', () => {
  it('縮小したときだけ、縮小の情報(倍率と画像の大きさ)を持つ', () => {
    const shrunk = run([{ type: 'layoutPlanned', scale: 1.6, width: 8000, height: 20000, shrunk: true }], RENDERING);
    expect(shrunk.shrink).toEqual({ scale: 1.6, width: 8000, height: 20000 });
    const normal = run([{ type: 'layoutPlanned', scale: 2, width: 100, height: 200, shrunk: false }], shrunk);
    expect(normal.shrink).toBeNull();
  });

  it('進捗を更新する', () => {
    expect(run([{ type: 'progress', done: 7, total: 12 }], RENDERING).progress).toEqual({ done: 7, total: 12 });
  });

  it('描画が終わると ready になり、失敗したページ(0 始まり)を持つ。進捗は完了', () => {
    const state = run([{ type: 'renderFinished', failedPages: [6, 11] }], RENDERING);
    expect(state).toMatchObject({ phase: 'ready', failedPages: [6, 11] });
    expect(state.progress).toEqual({ done: 12, total: 12 });
  });
});

describe('元PDFプレビューの優先による中断・再開(renderDeferred / renderResumed。F7/F11)', () => {
  it('rendering 中に renderDeferred が来ると、phase はそのままで、deferredForThumbnails だけが true になる', () => {
    const state = run([{ type: 'renderDeferred' }], RENDERING);
    expect(state).toMatchObject({ phase: 'rendering', deferredForThumbnails: true });
  });

  it('renderResumed が来ると、deferredForThumbnails が false に戻る(phase はそのまま)', () => {
    const deferred = run([{ type: 'renderDeferred' }], RENDERING);
    const resumed = run([{ type: 'renderResumed' }], deferred);
    expect(resumed).toMatchObject({ phase: 'rendering', deferredForThumbnails: false });
  });

  it('すでに同じ値なら、状態を変えない(冪等)', () => {
    expect(reduce(RENDERING, { type: 'renderResumed' })).toBe(RENDERING);
    const deferred = run([{ type: 'renderDeferred' }], RENDERING);
    expect(reduce(deferred, { type: 'renderDeferred' })).toBe(deferred);
  });

  it.each([INITIAL_STATE, LOADING, READY])('rendering 以外(%#)では、renderDeferred を無視する', (from) => {
    expect(reduce(from, { type: 'renderDeferred' })).toBe(from);
  });

  it('列数・区切り・セグメント選択で描き直すと、deferredForThumbnails は false に戻る', () => {
    const deferred = run([{ type: 'renderDeferred' }], RENDERING);
    expect(run([{ type: 'columnsChanged', columns: 3 }], deferred).deferredForThumbnails).toBe(false);
    const deferred20 = run([{ type: 'renderDeferred' }], RENDERING_20);
    expect(run([{ type: 'separatorsChanged', separators: [5] }], deferred20).deferredForThumbnails).toBe(false);
  });
});

describe('描画そのものの失敗(renderFailed。ページ単位の失敗とは別)', () => {
  it('rendering のときは、idle に戻り、全ての状態を捨ててエラー(読み込めなかった)だけを残す', () => {
    const state = run([{ type: 'renderFailed' }], RENDERING);
    expect(state).toEqual({ ...INITIAL_STATE, error: 'invalid' });
  });

  it.each([INITIAL_STATE, LOADING, READY])('rendering 以外(%#)では、無視する', (from) => {
    expect(reduce(from, { type: 'renderFailed' })).toBe(from);
  });
});

describe('列数の変更(columnsChanged)', () => {
  it('rendering / ready のとき、rendering に戻り、列数を更新して、進捗・縮小・警告・エラーを消す', () => {
    const dirty = run(
      [
        { type: 'layoutPlanned', scale: 1.5, width: 1, height: 1, shrunk: true },
        { type: 'renderFinished', failedPages: [2] },
        { type: 'pngFailed' },
      ],
      RENDERING,
    );
    for (const from of [RENDERING, READY, dirty]) {
      const state = run([{ type: 'columnsChanged', columns: 5 }], from);
      expect(state).toMatchObject({ phase: 'rendering', columns: 5, shrink: null, failedPages: [], error: null });
      expect(state.progress).toEqual({ done: 0, total: 12 });
    }
  });

  it('同じ列数なら、何も起きない(描き直さない)', () => {
    expect(reduce(READY, { type: 'columnsChanged', columns: READY.columns })).toBe(READY);
  });

  it.each([0, -1, 1.5, 13, Number.NaN])('範囲外の列数 %s は、無視する(1〜総ページ数の整数だけを受け付ける)', (columns) => {
    expect(reduce(READY, { type: 'columnsChanged', columns })).toBe(READY);
  });

  it('idle / loading では、無視する', () => {
    expect(reduce(INITIAL_STATE, { type: 'columnsChanged', columns: 5 })).toBe(INITIAL_STATE);
    expect(reduce(LOADING, { type: 'columnsChanged', columns: 5 })).toBe(LOADING);
  });
});

describe('区切りの変更(separatorsChanged)', () => {
  it('rendering / ready のとき、区切りを持ち、rendering に戻って、進捗(表示中のセグメントのページ数)・縮小・警告・エラーを消す', () => {
    const dirty = run(
      [
        { type: 'layoutPlanned', scale: 1.5, width: 1, height: 1, shrunk: true },
        { type: 'renderFinished', failedPages: [2] },
        { type: 'pngFailed' },
      ],
      RENDERING_20,
    );
    for (const from of [RENDERING_20, READY_20, dirty]) {
      const state = run([{ type: 'separatorsChanged', separators: [5, 8] }], from);
      expect(state).toMatchObject({ phase: 'rendering', separators: [5, 8], segmentStart: 1, shrink: null, failedPages: [], error: null });
      expect(state.progress).toEqual({ done: 0, total: 4 });
    }
  });

  it.each([
    ['p.5–20 を表示中に、区切りへ 12 を足す', [5], 5, [5, 12], 5, 7],
    ['p.12–20 を表示中に、区切りを 5 だけにする', [5, 12], 12, [5], 5, 16],
    ['p.5–11 を表示中に、区切りを 8 だけにする', [5, 12], 5, [8], 1, 7],
    ['p.5–11 を表示中に、区切りをなくす', [5, 12], 5, [], 1, 20],
  ])('%s(blueprint の例 7): 表示する先頭と進捗の総数(新しいセグメントのページ数)が、新しい区切りに追従する', (_label, before, shown, after, start, total) => {
    const viewing = run([{ type: 'separatorsChanged', separators: before }, { type: 'segmentSelected', start: shown }], READY_20);
    const state = run([{ type: 'separatorsChanged', separators: after }], viewing);
    expect(state.segmentStart).toBe(start);
    expect(state.progress).toEqual({ done: 0, total });
  });

  it('網羅(総ページ数 1〜6 の、全ての旧区切りと新区切り、旧セグメント): 新しく表示するセグメントは、旧セグメントの先頭ページを含む、新しいセグメントの先頭', () => {
    for (let pageCount = 1; pageCount <= 6; pageCount += 1) {
      const sets = separatorSets(pageCount);
      for (const before of sets) {
        for (const after of sets) expectFollowsPage(pageCount, before, after);
      }
    }
  });

  it('同じ区切りなら、何も起きない(描き直さない)', () => {
    expect(reduce(SPLIT, { type: 'separatorsChanged', separators: [5, 8] })).toBe(SPLIT);
    expect(reduce(READY_20, { type: 'separatorsChanged', separators: [] })).toBe(READY_20);
  });

  it.each([[[1]], [[0]], [[21]], [[8, 5]], [[5, 5]], [[5.5]], [[Number.NaN]]])('正規化されていない区切り %j は、無視する', (separators) => {
    expect(reduce(READY_20, { type: 'separatorsChanged', separators })).toBe(READY_20);
  });

  it('idle / loading では無視する', () => {
    expect(reduce(INITIAL_STATE, { type: 'separatorsChanged', separators: [5] })).toBe(INITIAL_STATE);
    expect(reduce(LOADING, { type: 'separatorsChanged', separators: [5] })).toBe(LOADING);
  });

  it('一括保存中は、無視する(セグメントの一覧を、保存の途中で変えない)', () => {
    expect(reduce(BATCHING, { type: 'separatorsChanged', separators: [5] })).toBe(BATCHING);
    expect(reduce(BATCHING, { type: 'columnsChanged', columns: 3 })).toBe(BATCHING);
  });

  it('別の PDF を選ぶと、区切りと表示するセグメントは消える', () => {
    const state = run([{ type: 'segmentSelected', start: 8 }, CHOOSE], SPLIT);
    expect(state).toMatchObject({ separators: [], segmentStart: 1 });
  });
});

describe('表示するセグメントの選択(segmentSelected)', () => {
  it('セグメントの先頭ページを指定すると、rendering に戻って、そのセグメントを表示する。進捗の総数は、そのセグメントのページ数', () => {
    for (const from of [SPLIT, run([{ type: 'separatorsChanged', separators: [5, 8] }], READY_20)]) {
      const state = run([{ type: 'segmentSelected', start: 8 }], from);
      expect(state).toMatchObject({ phase: 'rendering', segmentStart: 8, separators: [5, 8], shrink: null, failedPages: [], error: null });
      expect(state.progress).toEqual({ done: 0, total: 13 });
    }
  });

  it('前の警告(失敗したページ、縮小、エラー)は消える', () => {
    const dirty = run(
      [{ type: 'layoutPlanned', scale: 1.5, width: 1, height: 1, shrunk: true }, { type: 'renderFinished', failedPages: [2] }, { type: 'pngFailed' }],
      run([{ type: 'separatorsChanged', separators: [5, 8] }], READY_20),
    );
    const state = run([{ type: 'segmentSelected', start: 5 }], dirty);
    expect(state).toMatchObject({ shrink: null, failedPages: [], error: null });
  });

  it.each([[1], [6], [0], [21], [5.5]])('表示中と同じ先頭(1)、セグメントの先頭でないページ(%s)は、無視する', (start) => {
    expect(reduce(SPLIT, { type: 'segmentSelected', start })).toBe(SPLIT);
  });

  it('idle / loading では無視する', () => {
    expect(reduce(INITIAL_STATE, { type: 'segmentSelected', start: 1 })).toBe(INITIAL_STATE);
    expect(reduce(LOADING, { type: 'segmentSelected', start: 5 })).toBe(LOADING);
  });

  it('描画が終わると、表示中のセグメントのページ数で完了になる。列数を変えたときの進捗の総数も、同じ', () => {
    const shown = run([{ type: 'segmentSelected', start: 8 }, { type: 'renderFinished', failedPages: [] }], SPLIT);
    expect(shown.progress).toEqual({ done: 13, total: 13 });
    expect(run([{ type: 'columnsChanged', columns: 3 }], shown).progress).toEqual({ done: 0, total: 13 });
  });
});

describe('一括保存(batchStarted / batchProgressed / batchFinished / batchStopped)', () => {
  it('完了(ready)で、セグメントが 2 個以上のときに始められる。先頭のセグメントから、保存した個数は 0', () => {
    expect(BATCHING.batch).toEqual({ index: 0, total: 3, saved: 0 });
  });

  it.each([
    ['描画中', run([{ type: 'separatorsChanged', separators: [5, 8] }], READY_20)],
    ['区切りなし(セグメントが 1 個)', READY_20],
    ['未読み込み', INITIAL_STATE],
    ['一括保存中(二重に始めない)', BATCHING],
  ])('%s では、始められない(無視する)', (_label, from) => {
    expect(reduce(from, { type: 'batchStarted' })).toBe(from);
  });

  it('始めると、前のエラーと、前の一括保存の警告は消える', () => {
    const stopped = run([{ type: 'batchStopped', reason: 'cancelled', index: 1, saved: 1 }, { type: 'pngFailed' }], BATCHING);
    expect(stopped.batchStop).not.toBeNull();
    const state = run([{ type: 'batchStarted' }], stopped);
    expect(state).toMatchObject({ batchStop: null, error: null });
  });

  it('処理中のセグメントの番号と、保存した個数を更新する', () => {
    const state = run([{ type: 'batchProgressed', index: 2, saved: 2 }], BATCHING);
    expect(state.batch).toEqual({ index: 2, total: 3, saved: 2 });
  });

  it('一括保存中でなければ、進捗の更新、完了、中断は無視する(遅れて届いた古いイベントで、状態を壊さない)', () => {
    for (const event of [{ type: 'batchProgressed', index: 1, saved: 1 }, { type: 'batchFinished' }, { type: 'batchStopped', reason: 'cancelled', index: 0, saved: 0 }] as AppEvent[]) {
      expect(reduce(SPLIT, event)).toBe(SPLIT);
    }
  });

  it('完了すると、一括保存を終える。警告は残さない', () => {
    const state = run([{ type: 'batchProgressed', index: 2, saved: 3 }, { type: 'batchFinished' }], BATCHING);
    expect(state).toMatchObject({ batch: null, batchStop: null });
  });

  it('キャンセルすると、一括保存を終えて、保存した個数と総数を、警告のために残す(範囲は空)', () => {
    const state = run([{ type: 'batchStopped', reason: 'cancelled', index: 1, saved: 1 }], BATCHING);
    expect(state.batch).toBeNull();
    expect(state.batchStop).toEqual({ reason: 'cancelled', saved: 1, total: 3, segment: null });
  });

  it('PNG を生成できなかったときは、そのセグメントの範囲も残す', () => {
    const state = run([{ type: 'batchStopped', reason: 'failed', index: 2, saved: 2 }], BATCHING);
    expect(state.batchStop).toEqual({ reason: 'failed', saved: 2, total: 3, segment: { start: 8, end: 20 } });
  });

  it('一括保存の警告は、列数・区切り・表示するセグメントの変更、一括保存のやり直し、別の PDF の選択で消える', () => {
    const stopped = run([{ type: 'batchStopped', reason: 'cancelled', index: 1, saved: 1 }, { type: 'renderFinished', failedPages: [] }], BATCHING);
    for (const event of [
      { type: 'columnsChanged', columns: 3 },
      { type: 'separatorsChanged', separators: [5] },
      { type: 'segmentSelected', start: 5 },
      CHOOSE,
    ] as AppEvent[]) {
      expect(run([event], stopped).batchStop).toBeNull();
    }
  });

  it('一括保存中も、表示するセグメントの切り替え(内部の操作)と、描画の進行は受け付ける。一括保存は続く', () => {
    const state = run([{ type: 'segmentSelected', start: 5 }, { type: 'renderFinished', failedPages: [] }], BATCHING);
    expect(state).toMatchObject({ phase: 'ready', segmentStart: 5 });
    expect(state.batch).toEqual({ index: 0, total: 3, saved: 0 });
  });

  it('一括保存中の、複数ファイルのドロップは、何もしない(エラーも出さない)', () => {
    expect(reduce(BATCHING, { type: 'dropRejected' })).toBe(BATCHING);
  });
});

describe('エラーの通知(dropRejected / pngFailed)', () => {
  it('複数ファイルのドロップは、どの状態でも、状態はそのままエラーだけを付ける', () => {
    for (const from of [INITIAL_STATE, LOADING, RENDERING, READY]) {
      expect(run([{ type: 'dropRejected' }], from)).toEqual({ ...from, error: 'multipleFiles' });
    }
  });

  it('PNG を生成できなかったときは、ready のまま、エラーだけを付ける', () => {
    expect(run([{ type: 'pngFailed' }], READY)).toEqual({ ...READY, error: 'pngFailed' });
  });

  it('エラーは、次の列数・区切り・表示するセグメントの変更や、別の PDF の選択で消える', () => {
    const withError = run([{ type: 'pngFailed' }], READY);
    expect(run([{ type: 'columnsChanged', columns: 3 }], withError).error).toBeNull();
    expect(run([CHOOSE], withError).error).toBeNull();
    const splitError = run([{ type: 'pngFailed' }], SPLIT);
    expect(run([{ type: 'separatorsChanged', separators: [5] }], splitError).error).toBeNull();
    expect(run([{ type: 'segmentSelected', start: 5 }], splitError).error).toBeNull();
  });
});

describe('古いイベントの無視(中断した描画の残りのイベントが、遅れて届いても状態を壊さない)', () => {
  const STALE: [string, AppEvent, AppState][] = [
    ['ready の後の progress', { type: 'progress', done: 3, total: 12 }, READY],
    ['idle での progress', { type: 'progress', done: 3, total: 12 }, INITIAL_STATE],
    ['loading での renderFinished', { type: 'renderFinished', failedPages: [] }, LOADING],
    ['ready での renderFinished', { type: 'renderFinished', failedPages: [1] }, READY],
    ['ready での layoutPlanned', { type: 'layoutPlanned', scale: 1, width: 1, height: 1, shrunk: true }, READY],
    ['rendering での loaded', { type: 'loaded', pageCount: 3 }, RENDERING],
    ['idle での loadFailed', { type: 'loadFailed', error: 'invalid' }, INITIAL_STATE],
    ['rendering での pngFailed', { type: 'pngFailed' }, RENDERING],
  ];

  it.each(STALE)('%s は、状態を変えない', (_name, event, state) => {
    expect(reduce(state, event)).toBe(state);
  });
});

describe('uiFlags(blueprint の「画面の状態と操作の可否」。* は、セグメントが 2 個以上のときだけ有効)', () => {
  const NONE = { pick: false, columns: false, separators: false, segments: false, zoom: false, download: false, downloadAll: false, cancelBatch: false };
  const RENDERING_SPLIT = run([{ type: 'separatorsChanged', separators: [5, 8] }], READY_20);

  it.each([
    ['idle', INITIAL_STATE, { ...NONE, pick: true }],
    ['loading', LOADING, { ...NONE, pick: true }],
    ['rendering(区切りなし)', RENDERING, { ...NONE, pick: true, columns: true, separators: true, zoom: true }],
    ['rendering(区切りあり)', RENDERING_SPLIT, { ...NONE, pick: true, columns: true, separators: true, segments: true, zoom: true }],
    ['ready(区切りなし)', READY, { ...NONE, pick: true, columns: true, separators: true, zoom: true, download: true }],
    ['ready(区切りあり)', SPLIT, { ...NONE, pick: true, columns: true, separators: true, segments: true, zoom: true, download: true, downloadAll: true }],
    ['一括保存中(描画の途中でも、完了でも同じ)', BATCHING, { ...NONE, cancelBatch: true }],
    ['一括保存中(描画の途中)', run([{ type: 'segmentSelected', start: 5 }], BATCHING), { ...NONE, cancelBatch: true }],
  ])('%s', (_name, state, expected) => {
    expect(uiFlags(state)).toEqual(expected);
  });
});

describe('statusLines(ステータス行に出すメッセージ。順序は 進捗 → 通知 → 警告 → エラー)', () => {
  const SHRINK: AppEvent = { type: 'layoutPlanned', scale: 1.6, width: 8000, height: 20000, shrunk: true };

  it('idle で何もなければ、空', () => {
    expect(statusLines(INITIAL_STATE)).toEqual([]);
  });

  it('idle でエラーがあれば、エラーの文言', () => {
    expect(statusLines(IDLE_WITH_ERROR)).toEqual([{ kind: 'error', text: ERROR_TEXT.encrypted }]);
  });

  it('loading は「読み込み中…」', () => {
    expect(statusLines(LOADING)).toEqual([{ kind: 'progress', text: '読み込み中…' }]);
  });

  it('rendering は「描画中 N/M ページ」', () => {
    const state = run([{ type: 'progress', done: 12, total: 40 }], RENDERING);
    expect(statusLines(state)).toEqual([{ kind: 'progress', text: '描画中 12/40 ページ' }]);
  });

  it('縮小したときは、進捗の後に通知が続く', () => {
    const lines = statusLines(run([SHRINK], RENDERING));
    expect(lines.map((l) => l.kind)).toEqual(['progress', 'notice']);
    expect(lines[1]?.text).toBe('画像が大きいため縮小しました。実際の倍率 1.6倍(8,000 × 20,000 px)');
  });

  it('ready では、通知、警告、エラーが、この順に並ぶ', () => {
    const state = run([SHRINK, { type: 'renderFinished', failedPages: [6, 11] }, { type: 'pngFailed' }], RENDERING);
    const lines = statusLines(state);
    expect(lines.map((l) => l.kind)).toEqual(['notice', 'warning', 'error']);
    expect(lines[1]?.text).toBe('2 ページの描画に失敗しました(ページ: 7, 12)');
    expect(lines[2]?.text).toBe(ERROR_TEXT.pngFailed);
  });

  it('警告は、ダウンロード後も(ready の間)出し続ける', () => {
    expect(statusLines(run([{ type: 'renderFinished', failedPages: [0] }], RENDERING))).toHaveLength(1);
  });

  it('元PDFプレビュー優先で中断・待機している間は、「描画中」の代わりに専用の文言を出す', () => {
    const state = run([{ type: 'progress', done: 3, total: 12 }, { type: 'renderDeferred' }], RENDERING);
    expect(statusLines(state)).toEqual([{ kind: 'progress', text: THUMBNAIL_PRIORITY_TEXT }]);
  });

  it('再開すると、専用の文言から「描画中」に戻る', () => {
    const state = run([{ type: 'renderDeferred' }, { type: 'renderResumed' }, { type: 'progress', done: 1, total: 12 }], RENDERING);
    expect(statusLines(state)).toEqual([{ kind: 'progress', text: '描画中 1/12 ページ' }]);
  });

  it('一括保存中に(セグメントの描画が) rendering であっても、deferredForThumbnails ではなく保存中の進捗を出す', () => {
    const rendering = run([{ type: 'segmentSelected', start: 5 }], BATCHING);
    const state = run([{ type: 'renderDeferred' }], rendering);
    expect(state.deferredForThumbnails, '一括保存中でも、フラグ自体は立ちうる').toBe(true);
    expect(statusLines(state)[0]).toEqual({ kind: 'progress', text: '保存中 1/3 個(p.1–4)' });
  });

  it('区切りで分けているとき、描画中の総数は、表示中のセグメントのページ数(p.8–20 なら 13)', () => {
    const state = run([{ type: 'segmentSelected', start: 8 }, { type: 'progress', done: 3, total: 13 }], SPLIT);
    expect(statusLines(state)).toEqual([{ kind: 'progress', text: '描画中 3/13 ページ' }]);
  });

  it('一括保存中は、「保存中 K/N 個(範囲)」だけを出す(ページごとの「描画中」は出さない)', () => {
    const at2 = run([{ type: 'batchProgressed', index: 1, saved: 1 }, { type: 'segmentSelected', start: 5 }], BATCHING);
    expect(at2.phase).toBe('rendering');
    expect(statusLines(at2)).toEqual([{ kind: 'progress', text: '保存中 2/3 個(p.5–7)' }]);
  });

  it('一括保存中も、縮小の通知と、失敗したページの警告は、表示中のセグメントについて出す', () => {
    const state = run([SHRINK, { type: 'renderFinished', failedPages: [9] }], run([{ type: 'segmentSelected', start: 8 }], BATCHING));
    expect(statusLines(state).map((line) => line.kind)).toEqual(['progress', 'notice', 'warning']);
    expect(statusLines(state)[2]?.text).toBe('1 ページの描画に失敗しました(ページ: 10)');
  });

  it('一括保存をキャンセルしたときは、警告(保存した個数)を出す', () => {
    const state = run([{ type: 'batchStopped', reason: 'cancelled', index: 1, saved: 1 }, { type: 'segmentSelected', start: 1 }, { type: 'renderFinished', failedPages: [] }], BATCHING);
    expect(statusLines(state)).toEqual([{ kind: 'warning', text: '保存をキャンセルしました。3 個中 1 個を保存しました。' }]);
  });

  it('一括保存で PNG を生成できなかったときは、そのセグメントの範囲つきの警告を出す。順序は、失敗ページの警告の後', () => {
    const events: AppEvent[] = [
      { type: 'segmentSelected', start: 8 },
      { type: 'batchStopped', reason: 'failed', index: 2, saved: 2 },
      { type: 'renderFinished', failedPages: [2] },
    ];
    const lines = statusLines(run(events, BATCHING));
    expect(lines.map((line) => line.kind)).toEqual(['warning', 'warning']);
    expect(lines[0]?.text).toBe('1 ページの描画に失敗しました(ページ: 3)');
    expect(lines[1]?.text).toBe('p.8–20 の画像が大きすぎて PNG を生成できませんでした。3 個中 2 個を保存しました。');
  });
});

describe('表示中のセグメント(shownIndex / shownImageName)', () => {
  it('shownIndex は、表示中のセグメントの番号(0 始まり)。PDF を読み込むまでは -1', () => {
    expect(shownIndex(SPLIT)).toBe(0);
    expect(shownIndex(run([{ type: 'segmentSelected', start: 8 }], SPLIT))).toBe(2);
    expect(shownIndex(READY_20)).toBe(0);
    expect(shownIndex(INITIAL_STATE)).toBe(-1);
  });

  it('shownImageName は、区切りなしのときは、既存の名前(<元の名前>-<列数>cols.png)', () => {
    expect(shownImageName(READY_20)).toBe('report-10cols.png');
  });

  it('shownImageName は、区切りありのときは、表示中のセグメントの範囲と実際の列数つき(blueprint の例 8)', () => {
    expect(shownImageName(SPLIT)).toBe('report-p01-04-4cols.png');
    expect(shownImageName(run([{ type: 'segmentSelected', start: 5 }], SPLIT))).toBe('report-p05-07-3cols.png');
    expect(shownImageName(run([{ type: 'segmentSelected', start: 8 }], SPLIT))).toBe('report-p08-20-10cols.png');
  });
});

describe('reduce の性質', () => {
  it('入力の状態を書き換えない(凍結した状態でも例外にならない)', () => {
    expect(() => run([CHOOSE, LOADED_12, { type: 'columnsChanged', columns: 3 }, { type: 'dropRejected' }])).not.toThrow();
  });

  it('典型的な一連の操作: 選択 → 読み込み → 描画 → 完了 → 列数変更 → 完了', () => {
    const state = run([
      CHOOSE,
      LOADED_12,
      { type: 'renderFinished', failedPages: [] },
      { type: 'columnsChanged', columns: 3 },
      { type: 'renderFinished', failedPages: [] },
    ]);
    expect(state).toMatchObject({ phase: 'ready', columns: 3, pageCount: 12, fileName: 'report.pdf' });
  });
});
