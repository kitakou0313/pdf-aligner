import { describe, expect, it, vi } from 'vitest';
import { createStore } from '../../../src/core/store.ts';

/** テスト用の単純な状態: 数を足していくだけの reducer。 */
function add(state: number, event: number): number {
  return state + event;
}

describe('createStore', () => {
  it('初期状態を返し、dispatch で reducer を通した新しい状態になる', () => {
    const store = createStore(10, add);
    expect(store.getState()).toBe(10);
    store.dispatch(5);
    expect(store.getState()).toBe(15);
  });

  it('購読者には、状態が変わったときだけ、新しい状態を通知する(reducer が同じ値を返したら通知しない)', () => {
    const store = createStore(10, add);
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch(0);
    expect(listener).not.toHaveBeenCalled();
    store.dispatch(2);
    expect(listener).toHaveBeenCalledExactlyOnceWith(12);
  });

  it('購読を解除すると、以後は通知されない', () => {
    const store = createStore(0, add);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.dispatch(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('購読者は、登録した順に呼ばれる', () => {
    const store = createStore(0, add);
    const log: string[] = [];
    store.subscribe(() => log.push('a'));
    store.subscribe(() => log.push('b'));
    store.dispatch(1);
    expect(log).toEqual(['a', 'b']);
  });

  it('購読者の中で dispatch しても、各購読者は最新の状態を受け取る(入れ子の通知)', () => {
    const store = createStore(0, add);
    const seen: number[] = [];
    store.subscribe((state) => {
      seen.push(state);
      if (state === 1) store.dispatch(10);
    });
    store.dispatch(1);
    expect(store.getState()).toBe(11);
    expect(seen).toEqual([1, 11]);
  });

  it('購読者が例外を投げても、他の購読者には通知され、状態は更新されている', () => {
    const store = createStore(0, add);
    const second = vi.fn();
    store.subscribe(() => {
      throw new Error('listener broke');
    });
    store.subscribe(second);
    expect(() => store.dispatch(1)).toThrow('listener broke');
    expect(second).toHaveBeenCalledExactlyOnceWith(1);
    expect(store.getState()).toBe(1);
  });
});
