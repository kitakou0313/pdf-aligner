import { describe, expect, it } from 'vitest';
import { formatSeparators, liveSeparators, parseSeparators } from '../../../src/core/separators.ts';

/** 決定的な疑似乱数(線形合同法)。0 以上 1 未満の値を返す関数を作る。 */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/** 配列を、乱数で並べ替えた新しい配列にする。 */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  return items
    .map((item) => ({ item, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item);
}

describe('parseSeparators(確定時の正規化。blueprint の例 7。総ページ数 20)', () => {
  it.each([
    ['5, 8', [5, 8]],
    ['12, 5, 5', [5, 12]],
    ['12, 5, 5, 1, 0, 99, x', [5, 12]],
    ['2, 3', [2, 3]],
    ['20', [20]],
    ['1', []],
    ['', []],
    ['5 8', []],
  ])('%j → %j', (raw, expected) => {
    expect(parseSeparators(raw, 20)).toEqual(expected);
  });

  it.each([
    ['前後の空白は無視する', ' 5 ,  8 ', [5, 8]],
    ['先頭の 0 は、10 進の整数として読む', '05, 007', [5, 7]],
    ['小数は捨てる(丸めない)', '5.5, 8', [8]],
    ['全角の数字は捨てる', '５, 8', [8]],
    ['全角のカンマは区切りではない(1 つの項目になり、捨てる)', '5，8', []],
    ['符号つきは捨てる', '+5, -3, 8', [8]],
    ['指数表記は捨てる', '1e1, 8', [8]],
    ['空の項目は捨てる', '5,,8,', [5, 8]],
    ['桁あふれする巨大な数は、範囲外として捨てる', '99999999999999999999, 8', [8]],
    ['範囲の両端(2 と総ページ数)は残し、その外側(1 と総ページ数 + 1)は捨てる', '1, 2, 20, 21', [2, 20]],
  ])('%s: %j → %j', (_label, raw, expected) => {
    expect(parseSeparators(raw, 20)).toEqual(expected);
  });

  it('総ページ数が 1 のときは、有効な区切りがない(2 ページ目以降がない)', () => {
    expect(parseSeparators('1, 2, 3', 1)).toEqual([]);
  });

  it('性質: 有効なページ番号の集合を、順序と重複を変えて書いても、同じ結果(昇順で重複なし)になる', () => {
    const random = seededRandom(7);
    const pages = Array.from({ length: 11 }, (_, index) => index + 2);
    for (let round = 0; round < 200; round += 1) {
      const subset = pages.filter(() => random() < 0.4);
      const noisy = shuffled([...subset, ...subset.filter(() => random() < 0.5)], random);
      expect(parseSeparators(noisy.join(', '), 12)).toEqual(subset);
    }
  });

  it('性質: 結果は、正規化した文字列をもう一度解釈しても変わらない(冪等)', () => {
    for (const raw of ['12, 5, 5, 1, 0, 99, x', '5 8', '', '3,,3, 4.5', ' 7 ']) {
      const once = parseSeparators(raw, 20);
      expect(parseSeparators(formatSeparators(once), 20)).toEqual(once);
    }
  });
});

describe('liveSeparators(入力の途中で、すぐに反映してよい区切り。1 つでも無効な項目があれば null)', () => {
  it.each([
    ['', []],
    ['   ', []],
    ['5', [5]],
    ['5, 8', [5, 8]],
    ['12, 5, 5', [5, 12]],
    ['2', [2]],
    ['20', [20]],
  ])('%j → %j(有効。空欄は「区切りなし」、重複と順不同は整えて反映する)', (raw, expected) => {
    expect(liveSeparators(raw, 20)).toEqual(expected);
  });

  it.each([
    ['1', '1 ページ目'],
    ['0', '0'],
    ['21', '総ページ数を超える'],
    ['99', '範囲外'],
    ['x', '数字以外'],
    ['5.5', '小数'],
    ['5,', '末尾のカンマ(空の項目)'],
    ['5, 1', '有効な項目に、1 ページ目が混ざる(「1」は、「12」を打つ途中でありうる)'],
    ['5 8', '空白区切り'],
  ])('%j(%s)は、反映しない(null)。丸めて反映するのは、確定したとき', (raw) => {
    expect(liveSeparators(raw, 20)).toBeNull();
  });
});

describe('formatSeparators(入力欄に書き戻す文字列)', () => {
  it.each([
    [[5, 12], '5, 12'],
    [[7], '7'],
    [[], ''],
  ])('%j → %j', (separators, expected) => {
    expect(formatSeparators(separators)).toBe(expected);
  });
});
