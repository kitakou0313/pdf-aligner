import { describe, expect, it } from 'vitest';
import { dropAction } from '../../../src/core/drop.ts';

describe('dropAction(ドロップされたファイルの本数から、することを決める)', () => {
  it('0 本(テキストなどのドロップ)は、何もしない', () => {
    expect(dropAction(0)).toBe('ignore');
  });

  it('1 本は、読み込む', () => {
    expect(dropAction(1)).toBe('choose');
  });

  it.each([2, 3, 100])('%i 本(複数)は、どれも読み込まず、拒否する', (count) => {
    expect(dropAction(count)).toBe('reject');
  });

  it.each([-1, 1.5, Number.NaN])('本数として不正な値 %s は、何もしない', (count) => {
    expect(dropAction(count)).toBe('ignore');
  });
});
