import { describe, expect, it, vi } from 'vitest';
import { ThumbnailController, type ThumbnailControllerDeps } from '../../../src/core/thumbnail-controller.ts';

/** 外から解決・拒否できる Promise。 */
interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/** resolve/reject を外から呼べる Promise を作る(非同期の順序をテストから制御するため)。 */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 呼ばれた index を記録し、外から解決・拒否できる、偽の render。中断されたら AbortError で拒否する。 */
function fakeRender(): { render: ThumbnailControllerDeps['render']; settle: Map<number, Deferred<void>>; calls: number[] } {
  const settle = new Map<number, Deferred<void>>();
  const calls: number[] = [];
  /** 呼ばれた index を記録し、外から解決・拒否できる Promise を返す。 */
  const render: ThumbnailControllerDeps['render'] = (index, signal) => {
    calls.push(index);
    const d = deferred<void>();
    settle.set(index, d);
    signal.addEventListener('abort', () => d.reject(new DOMException('Aborted', 'AbortError')));
    return d.promise;
  };
  return { render, settle, calls };
}

/** 待っている Promise のマイクロタスクを、テストから 1 回分だけ進める。 */
function flush(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

describe('ThumbnailController(可視化イベントから、render の呼び出しと状態の通知を調停する)', () => {
  it('可視化すると render を呼び、rendering を通知する', () => {
    const { render, calls } = fakeRender();
    const onChange = vi.fn();
    const controller = new ThumbnailController({ render, onChange });
    controller.reset(2);
    controller.visible(0);
    expect(calls).toEqual([0]);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(0, 'rendering');
  });

  it('render が成功したら rendered を通知する', async () => {
    const { render, settle } = fakeRender();
    const onChange = vi.fn();
    const controller = new ThumbnailController({ render, onChange });
    controller.reset(1);
    controller.visible(0);
    settle.get(0)?.resolve();
    await flush();
    expect(onChange).toHaveBeenCalledWith(0, 'rendered');
    expect(controller.statusOf(0)).toBe('rendered');
  });

  it('render が失敗したら failed を通知する(Q11)', async () => {
    const { render, settle } = fakeRender();
    const onChange = vi.fn();
    const controller = new ThumbnailController({ render, onChange });
    controller.reset(1);
    controller.visible(0);
    settle.get(0)?.reject(new Error('boom'));
    await flush();
    expect(controller.statusOf(0)).toBe('failed');
  });

  it('既に rendering/rendered のページを再び可視化しても、render を呼び直さない(冪等)', async () => {
    const { render, settle, calls } = fakeRender();
    const controller = new ThumbnailController({ render, onChange: vi.fn() });
    controller.reset(1);
    controller.visible(0);
    controller.visible(0);
    settle.get(0)?.resolve();
    await flush();
    controller.visible(0);
    expect(calls).toEqual([0]);
  });

  it('不可視化すると pending に戻り、進行中の render を中断する(Q7)', () => {
    const { render, calls } = fakeRender();
    const controller = new ThumbnailController({ render, onChange: vi.fn() });
    controller.reset(1);
    controller.visible(0);
    controller.invisible(0);
    expect(controller.statusOf(0)).toBe('pending');
    expect(calls).toEqual([0]);
  });

  it('描画中に不可視化した後に届く結果は無視する(競合状態)', async () => {
    const { render, settle } = fakeRender();
    const onChange = vi.fn();
    const controller = new ThumbnailController({ render, onChange });
    controller.reset(1);
    controller.visible(0);
    controller.invisible(0);
    onChange.mockClear();
    settle.get(0)?.resolve();
    await flush();
    expect(controller.statusOf(0)).toBe('pending');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('不可視化した後、再び可視化すると、改めて render を呼ぶ(再試行)', () => {
    const { render, calls } = fakeRender();
    const controller = new ThumbnailController({ render, onChange: vi.fn() });
    controller.reset(1);
    controller.visible(0);
    controller.invisible(0);
    controller.visible(0);
    expect(calls).toEqual([0, 0]);
  });

  it('reset は、進行中の render を中断して、新しいページ数の pending に戻す', () => {
    const { render, calls } = fakeRender();
    const controller = new ThumbnailController({ render, onChange: vi.fn() });
    controller.reset(3);
    controller.visible(0);
    controller.reset(2);
    expect([controller.statusOf(0), controller.statusOf(1)]).toEqual(['pending', 'pending']);
    expect(calls).toEqual([0]);
  });

  it('複数ページを、互いに影響せず扱える', () => {
    const { render, calls } = fakeRender();
    const controller = new ThumbnailController({ render, onChange: vi.fn() });
    controller.reset(3);
    controller.visible(0);
    controller.visible(2);
    expect([...calls].sort()).toEqual([0, 2]);
    expect(controller.statusOf(1)).toBe('pending');
  });
});

describe('ThumbnailController(isSettled / onSettledChange。F7 の元PDFプレビュー優先が使う)', () => {
  it('生成中(rendering)のページが 1 つもなければ settled', () => {
    const { render } = fakeRender();
    const controller = new ThumbnailController({ render, onChange: vi.fn() });
    controller.reset(2);
    expect(controller.isSettled()).toBe(true);
  });

  it('可視化して生成が始まると settled でなくなり、購読者に false を通知する', () => {
    const { render } = fakeRender();
    const controller = new ThumbnailController({ render, onChange: vi.fn() });
    controller.reset(2);
    const listener = vi.fn();
    controller.onSettledChange(listener);
    controller.visible(0);
    expect(controller.isSettled()).toBe(false);
    expect(listener).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('生成が成功すると、また settled になり、true を通知する', async () => {
    const { render, settle } = fakeRender();
    const controller = new ThumbnailController({ render, onChange: vi.fn() });
    controller.reset(1);
    const listener = vi.fn();
    controller.onSettledChange(listener);
    controller.visible(0);
    listener.mockClear();
    settle.get(0)?.resolve();
    await flush();
    expect(controller.isSettled()).toBe(true);
    expect(listener).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('生成が失敗しても settled になる(失敗は確定した状態として扱う)', async () => {
    const { render, settle } = fakeRender();
    const controller = new ThumbnailController({ render, onChange: vi.fn() });
    controller.reset(1);
    controller.visible(0);
    settle.get(0)?.reject(new Error('boom'));
    await flush();
    expect(controller.isSettled()).toBe(true);
  });

  it('不可視化すると、進行中でも settled に戻る(Q7: 中断して pending に戻すため)', () => {
    const { render } = fakeRender();
    const controller = new ThumbnailController({ render, onChange: vi.fn() });
    controller.reset(1);
    controller.visible(0);
    controller.invisible(0);
    expect(controller.isSettled()).toBe(true);
  });

  it('複数ページのうち 1 つでも生成中なら settled でない(全て確定して初めて settled になる)', () => {
    const { render, settle } = fakeRender();
    const controller = new ThumbnailController({ render, onChange: vi.fn() });
    controller.reset(2);
    const listener = vi.fn();
    controller.onSettledChange(listener);
    controller.visible(0);
    controller.visible(1);
    listener.mockClear();
    settle.get(0)?.resolve();
    expect(controller.isSettled(), 'まだ 1 ページ生成中').toBe(false);
    expect(listener, '集約した値が変わっていないので、通知しない').not.toHaveBeenCalled();
  });

  it('reset は、進行中の生成を中断するので、settled に戻る', () => {
    const { render } = fakeRender();
    const controller = new ThumbnailController({ render, onChange: vi.fn() });
    controller.reset(2);
    controller.visible(0);
    const listener = vi.fn();
    controller.onSettledChange(listener);
    controller.reset(3);
    expect(controller.isSettled()).toBe(true);
    expect(listener).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('購読を解除すると、以後は呼ばれない', () => {
    const { render } = fakeRender();
    const controller = new ThumbnailController({ render, onChange: vi.fn() });
    controller.reset(1);
    const listener = vi.fn();
    const unsubscribe = controller.onSettledChange(listener);
    unsubscribe();
    controller.visible(0);
    expect(listener).not.toHaveBeenCalled();
  });
});
