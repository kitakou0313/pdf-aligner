import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeparatorsInput } from '../../../src/core/separators-input.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** 総ページ数 20、今の区切りが「5」という状態。 */
function twentyPagesSplitAtFive(): { pageCount: number; separators: readonly number[] } {
  return { pageCount: 20, separators: [5] };
}

/** 総ページ数 20、今の区切り 5 の入力欄の、記録つきの偽物を作る。 */
function setup(): { input: ReturnType<typeof createSeparatorsInput>; apply: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> } {
  const apply = vi.fn();
  const write = vi.fn();
  const input = createSeparatorsInput({ state: twentyPagesSplitAtFive, apply, write });
  return { input, apply, write };
}

describe('入力の途中(onInput)', () => {
  it('全ての項目が有効なら、300 ms 待ってから、その区切りで 1 回だけ反映する(待つ前には反映しない)', () => {
    const { input, apply } = setup();
    input.onInput('5, 8');
    vi.advanceTimersByTime(299);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(apply).toHaveBeenCalledExactlyOnceWith([5, 8]);
  });

  it('連続して入力したときは、最後の値だけを反映する', () => {
    const { input, apply } = setup();
    input.onInput('5, 1');
    vi.advanceTimersByTime(100);
    input.onInput('5, 12');
    vi.advanceTimersByTime(1000);
    expect(apply).toHaveBeenCalledExactlyOnceWith([5, 12]);
  });

  it('重複と順不同は、整えて反映する', () => {
    const { input, apply } = setup();
    input.onInput('12, 5, 5');
    vi.advanceTimersByTime(300);
    expect(apply).toHaveBeenCalledExactlyOnceWith([5, 12]);
  });

  it('空欄は「区切りなし」として、反映する', () => {
    const { input, apply } = setup();
    input.onInput('');
    vi.advanceTimersByTime(300);
    expect(apply).toHaveBeenCalledExactlyOnceWith([]);
  });

  it.each([
    ['1 ページ目', '1'],
    ['範囲外(総ページ数より大きい)', '21'],
    ['数字以外', 'x'],
    ['小数', '5.5'],
    ['末尾のカンマ', '5,'],
    ['空白区切り', '5 8'],
    ['有効な項目に、無効な項目が混ざる', '5, 99'],
  ])('%s(%j)は、入力の途中では反映しない(整えて反映するのは、フォーカスを外したとき)', (_label, raw) => {
    const { input, apply } = setup();
    input.onInput(raw);
    vi.advanceTimersByTime(1000);
    expect(apply).not.toHaveBeenCalled();
  });

  it('反映を待っている間に、反映できない値に変わったら、待っていた反映は取り消す(欄の中身と食い違わせない)', () => {
    const { input, apply } = setup();
    input.onInput('5, 8');
    input.onInput('5, 99');
    vi.advanceTimersByTime(1000);
    expect(apply).not.toHaveBeenCalled();
  });

  it('今の区切りと同じ値は、反映しない(描き直しを起こさない)', () => {
    const { input, apply } = setup();
    input.onInput('5');
    vi.advanceTimersByTime(1000);
    expect(apply).not.toHaveBeenCalled();
  });

  it('入力の途中では、欄の値を書き換えない(打っている最中の文字を消さない)', () => {
    const { input, write } = setup();
    input.onInput('5, 99');
    input.onInput('');
    vi.advanceTimersByTime(1000);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('確定(onCommit。フォーカスを外したとき、Enter を押したとき)', () => {
  it.each([
    ['12, 5, 5, 1, 0, 99, x', '5, 12', [5, 12], '重複の除去、昇順、1 ページ目・範囲外・数字以外の破棄(blueprint の例 7)'],
    ['5, 8', '5, 8', [5, 8], '有効な区切りは、そのまま'],
    ['', '', [], '空欄は、区切りなし'],
    ['5 8', '', [], '空白区切りは、1 つの項目で、整数として読めないので捨てる'],
  ])('%j → 欄は %j、区切りは %j(%s)。欄に書き戻し、待たずに反映する', (raw, text, separators) => {
    const { input, apply, write } = setup();
    input.onCommit(raw);
    expect(write).toHaveBeenCalledExactlyOnceWith(text);
    expect(apply).toHaveBeenCalledExactlyOnceWith(separators);
  });

  it('整えた結果が今の区切りと同じなら、欄には書き戻すが、反映はしない', () => {
    const { input, apply, write } = setup();
    input.onCommit('5.5, 5, 5, 99');
    expect(write).toHaveBeenCalledExactlyOnceWith('5');
    expect(apply).not.toHaveBeenCalled();
  });

  it('待っていた反映は取り消し、確定した値で 1 回だけ反映する(二重に描き直さない)', () => {
    const { input, apply } = setup();
    input.onInput('5, 8');
    input.onCommit('5, 8');
    vi.advanceTimersByTime(1000);
    expect(apply).toHaveBeenCalledExactlyOnceWith([5, 8]);
  });
});
