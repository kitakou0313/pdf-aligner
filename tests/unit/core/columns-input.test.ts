import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createColumnsInput } from '../../../src/core/columns-input.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** 総ページ数 12、現在の列数 3 という状態。 */
function twelvePagesAtThree(): { pageCount: number; columns: number } {
  return { pageCount: 12, columns: 3 };
}

/** 総ページ数 12、現在の列数 3 の入力欄の、記録つきの偽物を作る。 */
function setup(): { input: ReturnType<typeof createColumnsInput>; apply: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> } {
  const apply = vi.fn();
  const write = vi.fn();
  const input = createColumnsInput({ state: twelvePagesAtThree, apply, write });
  return { input, apply, write };
}

describe('入力の途中(onInput)', () => {
  it('範囲内の整数を入力したら、300 ms 待ってから、その値で 1 回だけ反映する(待つ前には反映しない)', () => {
    const { input, apply } = setup();
    input.onInput('5');
    vi.advanceTimersByTime(299);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(apply).toHaveBeenCalledExactlyOnceWith(5);
  });

  it('連続して入力したときは、最後の値だけを反映する', () => {
    const { input, apply } = setup();
    input.onInput('1');
    vi.advanceTimersByTime(100);
    input.onInput('12');
    vi.advanceTimersByTime(1000);
    expect(apply).toHaveBeenCalledExactlyOnceWith(12);
  });

  it.each([
    ['範囲外(総ページ数より大きい)', '15'],
    ['範囲外(0)', '0'],
    ['小数', '3.6'],
    ['空欄', ''],
    ['数値でない文字列', 'abc'],
  ])('%sの値は、入力の途中では反映しない(丸めるのは、フォーカスを外したとき)', (_label, raw) => {
    const { input, apply } = setup();
    input.onInput(raw);
    vi.advanceTimersByTime(1000);
    expect(apply).not.toHaveBeenCalled();
  });

  it('反映を待っている間に、反映できない値に変わったら、待っていた反映は取り消す(欄の中身と食い違わせない)', () => {
    const { input, apply } = setup();
    input.onInput('1');
    input.onInput('15');
    vi.advanceTimersByTime(1000);
    expect(apply).not.toHaveBeenCalled();
  });

  it('入力の途中では、欄の値を書き換えない(打っている最中の文字を消さない)', () => {
    const { input, write } = setup();
    input.onInput('15');
    input.onInput('');
    vi.advanceTimersByTime(1000);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('確定(onCommit。フォーカスを外したとき、Enter を押したとき)', () => {
  it.each([
    ['15', 12, '総ページ数を超える値は、総ページ数に丸める'],
    ['0', 1, '0 は 1 に丸める'],
    ['-3', 1, '負の値は 1 に丸める'],
    ['3.6', 4, '小数は四捨五入する(切り上がる)'],
    ['5', 5, '範囲内の整数は、そのまま'],
  ])('%j → %i(%s)。欄に書き戻し、待たずに反映する', (raw, expected) => {
    const { input, apply, write } = setup();
    input.onCommit(raw);
    expect(write).toHaveBeenCalledExactlyOnceWith(expected);
    expect(apply).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it.each([
    ['', '空欄'],
    ['abc', '数値でない文字列'],
  ])('%j(%s)は、直前の値(3)に戻す。値は変わらないので、反映(描き直し)はしない', (raw) => {
    const { input, apply, write } = setup();
    input.onCommit(raw);
    expect(write).toHaveBeenCalledExactlyOnceWith(3);
    expect(apply).not.toHaveBeenCalled();
  });

  it('丸めた結果が今の列数と同じなら、欄には書き戻すが、反映はしない', () => {
    const { input, apply, write } = setup();
    input.onCommit('3.4');
    expect(write).toHaveBeenCalledExactlyOnceWith(3);
    expect(apply).not.toHaveBeenCalled();
  });

  it('待っていた反映は取り消し、確定した値で 1 回だけ反映する(二重に描き直さない)', () => {
    const { input, apply } = setup();
    input.onInput('5');
    input.onCommit('5');
    vi.advanceTimersByTime(1000);
    expect(apply).toHaveBeenCalledExactlyOnceWith(5);
  });
});
