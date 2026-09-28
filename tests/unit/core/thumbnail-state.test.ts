import { describe, expect, it } from 'vitest';
import { initialThumbnailState, reduceThumbnail, type ThumbnailEvent, type ThumbnailStatus } from '../../../src/core/thumbnail-state.ts';

const VISIBLE: ThumbnailEvent = { type: 'visible' };
const INVISIBLE: ThumbnailEvent = { type: 'invisible' };
const SUCCEEDED: ThumbnailEvent = { type: 'succeeded' };
const FAILED: ThumbnailEvent = { type: 'failed' };

/** 1 ページだけの状態に、指定したイベントを順に適用した、最後の状態を返す。 */
function applyAll(initial: ThumbnailStatus, events: readonly ThumbnailEvent[]): ThumbnailStatus {
  let state: readonly ThumbnailStatus[] = [initial];
  for (const event of events) state = reduceThumbnail(state, 0, event);
  return state[0] as ThumbnailStatus;
}

describe('initialThumbnailState(全ページを pending にする)', () => {
  it('ページ数ぶんの pending の配列を作る', () => {
    expect(initialThumbnailState(3)).toEqual(['pending', 'pending', 'pending']);
  });

  it('0 ページなら空の配列', () => {
    expect(initialThumbnailState(0)).toEqual([]);
  });
});

describe('reduceThumbnail(可視化・不可視化・描画結果を、1 ページの状態に反映する)', () => {
  it.each([
    ['pending', VISIBLE, 'rendering'],
    ['pending', INVISIBLE, 'pending'],
    ['pending', SUCCEEDED, 'pending'],
    ['pending', FAILED, 'pending'],
    ['rendering', VISIBLE, 'rendering'],
    ['rendering', INVISIBLE, 'pending'],
    ['rendering', SUCCEEDED, 'rendered'],
    ['rendering', FAILED, 'failed'],
    ['rendered', VISIBLE, 'rendered'],
    ['rendered', INVISIBLE, 'pending'],
    ['rendered', SUCCEEDED, 'rendered'],
    ['rendered', FAILED, 'rendered'],
    ['failed', VISIBLE, 'failed'],
    ['failed', INVISIBLE, 'pending'],
    ['failed', SUCCEEDED, 'failed'],
    ['failed', FAILED, 'failed'],
  ] as const)('%s に %o を適用すると %s', (before, event, after) => {
    expect(applyAll(before, [event])).toBe(after);
  });

  it('可視化 → 生成成功 の一連で rendered になる', () => {
    expect(applyAll('pending', [VISIBLE, SUCCEEDED])).toBe('rendered');
  });

  it('可視化 → 生成失敗 の一連で failed になる(Q11: 未生成のセルと区別できるようにする)', () => {
    expect(applyAll('pending', [VISIBLE, FAILED])).toBe('failed');
  });

  it('rendered なページが不可視化されたら pending に戻る(Q7: 画面外は破棄する)', () => {
    expect(applyAll('pending', [VISIBLE, SUCCEEDED, INVISIBLE])).toBe('pending');
  });

  it('failed なページが不可視化されたら pending に戻る(未生成と同じ扱いに戻る)', () => {
    expect(applyAll('pending', [VISIBLE, FAILED, INVISIBLE])).toBe('pending');
  });

  it('不可視化された後、再び可視化されると、また rendering からやり直す', () => {
    expect(applyAll('pending', [VISIBLE, SUCCEEDED, INVISIBLE, VISIBLE])).toBe('rendering');
  });

  it('描画中に不可視化されたら、いったん pending に戻り、後から届く結果は無視する(競合状態)', () => {
    expect(applyAll('pending', [VISIBLE, INVISIBLE, SUCCEEDED])).toBe('pending');
    expect(applyAll('pending', [VISIBLE, INVISIBLE, FAILED])).toBe('pending');
  });

  it('他のページの状態には影響しない', () => {
    const state = reduceThumbnail(['pending', 'pending', 'pending'], 1, VISIBLE);
    expect(state).toEqual(['pending', 'rendering', 'pending']);
  });

  it('状態が変わらないときは、同じ配列を返す(不要な再描画の判定に使える)', () => {
    const state = initialThumbnailState(2);
    expect(reduceThumbnail(state, 0, INVISIBLE)).toBe(state);
  });

  it.each([-1, 2, 1.5])('範囲外のページ番号(%s)は RangeError', (index) => {
    expect(() => reduceThumbnail(initialThumbnailState(2), index, VISIBLE)).toThrow(RangeError);
  });
});
