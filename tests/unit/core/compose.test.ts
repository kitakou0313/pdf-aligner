import { describe, expect, it, vi } from 'vitest';
import { composePages } from '../../../src/core/compose.ts';
import { computeLayout } from '../../../src/core/layout.ts';
import { FakeSource, type Behavior } from './helpers/fake-source.ts';
import { A3, A4, A4_LANDSCAPE, repeat } from './helpers/pages.ts';

/** キャンセルされていない AbortSignal を作る。 */
function freshSignal(): AbortSignal {
  return new AbortController().signal;
}

/** 少しだけ待ってから成功する振る舞い。 */
function sleepBriefly(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1));
}

/** 指定したページ(0 始まり)だけ失敗する振る舞いを作る。 */
function failAt(...bad: number[]): Behavior {
  return async (index) => {
    if (bad.includes(index)) throw new Error(`page ${index} broke`);
  };
}

/** 指定したページの描画中に、キャンセルする振る舞いを作る。 */
function abortDuring(controller: AbortController, target: number): Behavior {
  return async (index) => {
    if (index === target) controller.abort();
  };
}

/** 指定したページ(未指定なら全ページ)で、キャンセルしてから、指定した例外を投げる振る舞いを作る。 */
function abortThenThrow(controller: AbortController, error: Error, target?: number): Behavior {
  return async (index) => {
    if (target !== undefined && index !== target) return;
    controller.abort();
    throw error;
  };
}

/** 呼び出しを、順序つきで文字列にして記録する振る舞いを作る。 */
function logging(log: string[]): Behavior {
  return async (index) => {
    log.push(`render ${index}`);
  };
}

describe('composePages: 正常系', () => {
  it('全ページを、行方向の順に、レイアウトどおりの配置で描き、done を返す', async () => {
    const source = new FakeSource(repeat(A4, 5));
    const result = await composePages(source, { columns: 2, signal: freshSignal() });
    const expected = computeLayout(repeat(A4, 5), 2, 2);
    expect(source.calls).toEqual([0, 1, 2, 3, 4]);
    expect(source.placements).toEqual(expected.placements);
    expect(result).toEqual({ status: 'done', failedPages: [], layout: expected });
  });

  it('混在したページの大きさでも、レイアウトどおりの配置になる', async () => {
    const pages = [A4, A4_LANDSCAPE, A3];
    const source = new FakeSource(pages);
    await composePages(source, { columns: 2, signal: freshSignal() });
    expect(source.placements).toEqual(computeLayout(pages, 2, 2).placements);
  });

  it('描画は 1 ページずつ順番に行う(同時に 2 ページ以上を描かない)', async () => {
    const source = new FakeSource(repeat(A4, 4), sleepBriefly);
    await composePages(source, { columns: 2, signal: freshSignal() });
    expect(source.maxInFlight).toBe(1);
  });

  it('レイアウト → 進捗 0 → (描画 → 進捗)の繰り返し、の順に通知する', async () => {
    const log: string[] = [];
    const source = new FakeSource(repeat(A4, 3), logging(log));
    const onLayout = vi.fn(() => log.push('layout'));
    const onProgress = vi.fn((done: number, total: number) => log.push(`progress ${done}/${total}`));
    await composePages(source, { columns: 3, signal: freshSignal(), onLayout, onProgress });
    expect(log).toEqual([
      'layout', 'progress 0/3',
      'render 0', 'progress 1/3',
      'render 1', 'progress 2/3',
      'render 2', 'progress 3/3',
    ]);
  });

  it('描画には、渡した signal と同じものを渡す(描画の中断に使えるように)', async () => {
    const seen: AbortSignal[] = [];
    const signal = freshSignal();
    const source = new FakeSource([A4, A4], async (_index, s) => void seen.push(s));
    await composePages(source, { columns: 2, signal });
    expect(seen).toEqual([signal, signal]);
  });
});

describe('composePages: 自動縮小', () => {
  it('上限を超えるとき、縮小したレイアウトを通知し、その配置で描く', async () => {
    const onLayout = vi.fn();
    const source = new FakeSource(repeat(A4, 6));
    const limits = { maxSide: 500, maxArea: 90_000 };
    const result = await composePages(source, { columns: 2, signal: freshSignal(), limits, onLayout });
    const plan = onLayout.mock.calls[0]?.[0];
    expect(plan.shrunk).toBe(true);
    expect(plan.layout.width * plan.layout.height).toBeLessThanOrEqual(90_000);
    expect(source.placements).toEqual(plan.layout.placements);
    expect(result.layout).toEqual(plan.layout);
  });

  it('上限に収まるとき、縮小しない(既定の上限)', async () => {
    const onLayout = vi.fn();
    await composePages(new FakeSource(repeat(A4, 6)), { columns: 2, signal: freshSignal(), onLayout });
    expect(onLayout.mock.calls[0]?.[0].shrunk).toBe(false);
  });
});

describe('composePages: キャンセル', () => {
  it('描画の途中でキャンセルすると、残りのページは描かず、cancelled を返す', async () => {
    const controller = new AbortController();
    const onProgress = vi.fn();
    const source = new FakeSource(repeat(A4, 5), abortDuring(controller, 2));
    const result = await composePages(source, { columns: 2, signal: controller.signal, onProgress });
    expect(source.calls).toEqual([0, 1, 2]);
    expect(result.status).toBe('cancelled');
    expect(onProgress.mock.calls.at(-1)).toEqual([2, 5]);
  });

  it('最後のページの描画中にキャンセルしても、完了(N/N)の通知はしない', async () => {
    const controller = new AbortController();
    const onProgress = vi.fn();
    const source = new FakeSource(repeat(A4, 3), abortDuring(controller, 2));
    const result = await composePages(source, { columns: 3, signal: controller.signal, onProgress });
    expect(result.status).toBe('cancelled');
    expect(onProgress).not.toHaveBeenCalledWith(3, 3);
  });

  it('開始前に、既にキャンセルされていたら、何も通知せず、何も描かない', async () => {
    const controller = new AbortController();
    controller.abort();
    const [onLayout, onProgress] = [vi.fn(), vi.fn()];
    const source = new FakeSource(repeat(A4, 3));
    const result = await composePages(source, { columns: 1, signal: controller.signal, onLayout, onProgress });
    expect(result).toEqual({ status: 'cancelled', failedPages: [], layout: null });
    expect([source.calls, onLayout.mock.calls, onProgress.mock.calls]).toEqual([[], [], []]);
  });

  it('キャンセルに伴う中断の例外(AbortError)は、失敗ページとして数えない', async () => {
    const controller = new AbortController();
    const behavior = abortThenThrow(controller, new DOMException('Aborted', 'AbortError'), 1);
    const result = await composePages(new FakeSource(repeat(A4, 3), behavior), { columns: 1, signal: controller.signal });
    expect(result).toMatchObject({ status: 'cancelled', failedPages: [] });
  });

  it('キャンセルした後に起きた、どんな例外も、失敗ページとして数えない', async () => {
    const controller = new AbortController();
    const behavior = abortThenThrow(controller, new Error('後始末の途中の失敗'));
    const result = await composePages(new FakeSource(repeat(A4, 3), behavior), { columns: 1, signal: controller.signal });
    expect(result).toMatchObject({ status: 'cancelled', failedPages: [] });
  });
});

describe('composePages: ページ単位の失敗(空セルのまま続行して、失敗を返す)', () => {
  it('1 ページだけ失敗しても、他のページは描き、進捗は最後まで進み、failedPages に番号を返す', async () => {
    const onProgress = vi.fn();
    const source = new FakeSource(repeat(A4, 5), failAt(3));
    const result = await composePages(source, { columns: 2, signal: freshSignal(), onProgress });
    expect(source.calls).toEqual([0, 1, 2, 3, 4]);
    expect(result).toMatchObject({ status: 'done', failedPages: [3] });
    expect(onProgress.mock.calls.at(-1)).toEqual([5, 5]);
  });

  it('複数のページが失敗したら、昇順で全て返す', async () => {
    const source = new FakeSource(repeat(A4, 6), failAt(4, 1));
    const result = await composePages(source, { columns: 2, signal: freshSignal() });
    expect(result.failedPages).toEqual([1, 4]);
  });

  it('全ページが失敗しても、例外にはせず、done として全ての番号を返す', async () => {
    const source = new FakeSource(repeat(A4, 3), failAt(0, 1, 2));
    const result = await composePages(source, { columns: 3, signal: freshSignal() });
    expect(result).toMatchObject({ status: 'done', failedPages: [0, 1, 2] });
  });
});

describe('composePages: 不正な入力', () => {
  it.each([0, -1, 1.5, 4, Number.NaN])('列数 %s は、何も通知・描画せずに RangeError で拒否する', async (columns) => {
    const onLayout = vi.fn();
    const source = new FakeSource(repeat(A4, 3));
    await expect(composePages(source, { columns, signal: freshSignal(), onLayout })).rejects.toThrow(RangeError);
    expect([source.calls, onLayout.mock.calls]).toEqual([[], []]);
  });

  it('ページが 0 枚なら、RangeError で拒否する', async () => {
    await expect(composePages(new FakeSource([]), { columns: 1, signal: freshSignal() })).rejects.toThrow(RangeError);
  });
});
