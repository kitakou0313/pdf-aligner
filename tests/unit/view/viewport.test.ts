import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchDevicePixelRatio } from '../../../src/view/viewport.ts';

/** 偽の MediaQueryList: 登録された change の関数を持ち、fire で呼べる(once: true なら、呼んだら登録を外す)。 */
class FakeQuery {
  readonly query: string;
  private listener: (() => void) | null = null;
  private once = false;

  /** 照会の文字列から作る。 */
  constructor(query: string) {
    this.query = query;
  }

  /** change の関数を登録する(この偽物は、1 つだけ持つ)。 */
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void {
    expect(type).toBe('change');
    this.listener = listener;
    this.once = options?.once === true;
  }

  /** 一致が変化したことにして、登録された関数を呼ぶ。登録がなければ false。 */
  fire(): boolean {
    const listener = this.listener;
    if (!listener) return false;
    if (this.once) this.listener = null;
    listener();
    return true;
  }
}

/** 偽の window: 密度を持ち、matchMedia で作った照会を、queries に記録する。 */
interface FakeWindow {
  devicePixelRatio: number;
  matchMedia(query: string): FakeQuery;
}

/** 照会を記録する matchMedia を持つ、偽の window を作る。 */
function fakeWindow(dpr: number, queries: FakeQuery[]): FakeWindow {
  return {
    devicePixelRatio: dpr,
    /** 照会を作って記録する。 */
    matchMedia(query: string): FakeQuery {
      const created = new FakeQuery(query);
      queries.push(created);
      return created;
    },
  };
}

/** window の偽物を差し込み、照会の作成の記録と、密度の設定口を返す。 */
function stubWindow(initialDpr: number): { queries: FakeQuery[]; setDpr: (dpr: number) => void } {
  const queries: FakeQuery[] = [];
  const fake = fakeWindow(initialDpr, queries);
  vi.stubGlobal('window', fake);
  /** 密度を変える(画面の移動の代わり)。 */
  const setDpr = (dpr: number): void => {
    fake.devicePixelRatio = dpr;
  };
  return { queries, setDpr };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('watchDevicePixelRatio(画面の密度の変化を、matchMedia の一致の変化で検知する)', () => {
  it('今の密度を条件にした照会で、監視を始める', () => {
    const { queries } = stubWindow(2);
    watchDevicePixelRatio(vi.fn());
    expect(queries.map((q) => q.query)).toEqual(['(resolution: 2dppx)']);
  });

  it('一致が変化したら、新しい密度を渡して通知し、新しい密度を条件にして監視し直す', () => {
    const { queries, setDpr } = stubWindow(1);
    const onChange = vi.fn();
    watchDevicePixelRatio(onChange);
    setDpr(2);
    queries[0]?.fire();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(2);
    expect(queries.map((q) => q.query)).toEqual(['(resolution: 1dppx)', '(resolution: 2dppx)']);
  });

  it('何度変わっても、そのたびに通知し、監視し直す(小数の密度も)', () => {
    const { queries, setDpr } = stubWindow(1);
    const onChange = vi.fn();
    watchDevicePixelRatio(onChange);
    for (const dpr of [2, 1.5, 1]) {
      setDpr(dpr);
      queries.at(-1)?.fire();
    }
    expect(onChange.mock.calls).toEqual([[2], [1.5], [1]]);
    expect(queries.at(-1)?.query).toBe('(resolution: 1dppx)');
  });

  it('古い照会は、一度通知したら、それ以上は通知しない(二重の通知や、監視の増殖を起こさない)', () => {
    const { queries, setDpr } = stubWindow(1);
    const onChange = vi.fn();
    watchDevicePixelRatio(onChange);
    setDpr(2);
    expect(queries[0]?.fire()).toBe(true);
    expect(queries[0]?.fire(), '古い照会には、もう登録が残っていない').toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
