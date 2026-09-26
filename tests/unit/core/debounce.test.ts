import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COLUMNS_DEBOUNCE_MS, debounce } from '../../../src/core/debounce.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('debounce', () => {
  it('呼んだだけでは実行せず、待ち時間が過ぎたら 1 回だけ実行する', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 300);
    debounced(1);
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('連続して呼ぶと、待ち時間を数え直し、最後の引数だけで 1 回実行する', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 300);
    debounced(1);
    vi.advanceTimersByTime(200);
    debounced(2);
    vi.advanceTimersByTime(200);
    debounced(3);
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('cancel すると、待っていた実行は行われない', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 300);
    debounced(1);
    debounced.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel の後も、再び呼べば実行される。何も待っていないときの cancel は無害', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 300);
    debounced.cancel();
    debounced(7);
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('実行した後に呼べば、また待ち時間を置いて実行する', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 300);
    debounced(1);
    vi.advanceTimersByTime(300);
    debounced(2);
    vi.advanceTimersByTime(300);
    expect(fn.mock.calls).toEqual([[1], [2]]);
  });

  it('列数の入力の待ち時間は 300 ms(blueprint の F4 の「短い待ち時間」)', () => {
    expect(COLUMNS_DEBOUNCE_MS).toBe(300);
  });
});
