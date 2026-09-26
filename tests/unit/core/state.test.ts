import { describe, expect, it } from 'vitest';
import { ERROR_TEXT } from '../../../src/core/messages.ts';
import { INITIAL_STATE, reduce, statusLines, uiFlags, type AppEvent, type AppState } from '../../../src/core/state.ts';

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

const CHOOSE: AppEvent = { type: 'fileChosen', fileName: 'report.pdf' };
const LOADED_12: AppEvent = { type: 'loaded', pageCount: 12 };
const LOADING = run([CHOOSE]);
const RENDERING = run([CHOOSE, LOADED_12]);
const READY = run([CHOOSE, LOADED_12, { type: 'renderFinished', failedPages: [] }]);
const IDLE_WITH_ERROR = run([CHOOSE, { type: 'loadFailed', error: 'encrypted' }]);

describe('初期状態', () => {
  it('未読み込み(idle)で、ファイルもエラーもない', () => {
    expect(INITIAL_STATE).toMatchObject({ phase: 'idle', fileName: null, pageCount: 0, error: null });
    expect(INITIAL_STATE.failedPages).toEqual([]);
    expect(INITIAL_STATE.shrink).toBeNull();
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

describe('エラーの通知(dropRejected / pngFailed)', () => {
  it('複数ファイルのドロップは、どの状態でも、状態はそのままエラーだけを付ける', () => {
    for (const from of [INITIAL_STATE, LOADING, RENDERING, READY]) {
      expect(run([{ type: 'dropRejected' }], from)).toEqual({ ...from, error: 'multipleFiles' });
    }
  });

  it('PNG を生成できなかったときは、ready のまま、エラーだけを付ける', () => {
    expect(run([{ type: 'pngFailed' }], READY)).toEqual({ ...READY, error: 'pngFailed' });
  });

  it('エラーは、次の列数の変更や、別の PDF の選択で消える', () => {
    const withError = run([{ type: 'pngFailed' }], READY);
    expect(run([{ type: 'columnsChanged', columns: 3 }], withError).error).toBeNull();
    expect(run([CHOOSE], withError).error).toBeNull();
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

describe('uiFlags(blueprint の「画面の状態と操作の可否」)', () => {
  it.each([
    ['idle', INITIAL_STATE, { pick: true, columns: false, zoom: false, download: false }],
    ['loading', LOADING, { pick: true, columns: false, zoom: false, download: false }],
    ['rendering', RENDERING, { pick: true, columns: true, zoom: true, download: false }],
    ['ready', READY, { pick: true, columns: true, zoom: true, download: true }],
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
