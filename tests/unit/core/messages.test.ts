import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_TEXT,
  LOADING_TEXT,
  formatBatchCancelled,
  formatBatchFailed,
  formatBatchProgress,
  formatFailedPages,
  formatProgress,
  formatShrinkNotice,
} from '../../../src/core/messages.ts';

describe('メッセージの文言(blueprint の F8 と一致する)', () => {
  let blueprint = '';
  beforeAll(async () => {
    blueprint = await readFile(new URL('../../../docs/pdf-aligner-blueprint.html', import.meta.url), 'utf8');
  });

  it('固定の文言は、blueprint の一覧に、そのまま載っている(仕様と実装のずれを防ぐ)', () => {
    for (const text of [LOADING_TEXT, ...Object.values(ERROR_TEXT)]) {
      expect(blueprint, text).toContain(text);
    }
  });

  it('エラーの文言は、blueprint の表のとおり', () => {
    expect(ERROR_TEXT).toEqual({
      encrypted: 'パスワードで保護された PDF には対応していません。',
      invalid: 'PDF を読み込めませんでした。ファイルが壊れているか、PDF ではない可能性があります。',
      empty: 'ページがありません。',
      multipleFiles: 'PDF は 1 ファイルだけ指定してください。',
      pngFailed: '画像が大きすぎて PNG を生成できませんでした。列数を変更するか、PDF を分割してお試しください。',
    });
    expect(LOADING_TEXT).toBe('読み込み中…');
  });

  it('一括保存の文言は、blueprint の例 9 の表に、そのまま載っている', () => {
    for (const text of [formatBatchProgress(1, 3, 'p.1–4'), formatBatchProgress(2, 3, 'p.5–7'), formatBatchCancelled(1, 3), formatBatchFailed('p.8–20', 2, 3)]) {
      expect(blueprint, text).toContain(text);
    }
  });

  it('一括保存の文言の雛形(N、K を含む)は、blueprint の F8 の表に載っている', () => {
    for (const template of ['保存中 K/N 個(p.5–7)', '保存をキャンセルしました。N 個中 K 個を保存しました。', 'p.8–20 の画像が大きすぎて PNG を生成できませんでした。N 個中 K 個を保存しました。']) {
      expect(blueprint, template).toContain(template);
    }
  });
});

describe('一括保存の文言(blueprint の F8、例 9)', () => {
  it('formatBatchProgress は「保存中 K/N 個(範囲)」(K は 1 始まりの、処理中のセグメントの番号)', () => {
    expect(formatBatchProgress(2, 3, 'p.5–7')).toBe('保存中 2/3 個(p.5–7)');
  });

  it('formatBatchCancelled は、キャンセルしたことと、保存した個数', () => {
    expect(formatBatchCancelled(1, 3)).toBe('保存をキャンセルしました。3 個中 1 個を保存しました。');
    expect(formatBatchCancelled(0, 2)).toBe('保存をキャンセルしました。2 個中 0 個を保存しました。');
  });

  it('formatBatchFailed は、PNG を生成できなかったセグメントの範囲と、保存した個数', () => {
    expect(formatBatchFailed('p.8–20', 2, 3)).toBe('p.8–20 の画像が大きすぎて PNG を生成できませんでした。3 個中 2 個を保存しました。');
  });
});

describe('formatProgress(描画中 N/M ページ)', () => {
  it.each([
    [12, 40, '描画中 12/40 ページ'],
    [0, 5, '描画中 0/5 ページ'],
    [5, 5, '描画中 5/5 ページ'],
  ])('%i / %i → %j', (done, total, expected) => {
    expect(formatProgress(done, total)).toBe(expected);
  });
});

describe('formatShrinkNotice(自動縮小の通知)', () => {
  it('倍率は小数 2 桁までで、末尾の 0 は省く。画素数は 3 桁区切り', () => {
    expect(formatShrinkNotice(1.8441, 11297, 23763)).toBe('画像が大きいため縮小しました。実際の倍率 1.84倍(11,297 × 23,763 px)');
    expect(formatShrinkNotice(1.6, 8000, 20000)).toBe('画像が大きいため縮小しました。実際の倍率 1.6倍(8,000 × 20,000 px)');
    expect(formatShrinkNotice(0.5, 999, 1000)).toBe('画像が大きいため縮小しました。実際の倍率 0.5倍(999 × 1,000 px)');
  });
});

describe('formatFailedPages(描画に失敗したページの警告)', () => {
  it('0 始まりの番号を、1 始まりのページ番号にして、昇順に並べる', () => {
    expect(formatFailedPages([29, 6, 11])).toBe('3 ページの描画に失敗しました(ページ: 7, 12, 30)');
  });

  it('1 ページだけでも、同じ形式', () => {
    expect(formatFailedPages([0])).toBe('1 ページの描画に失敗しました(ページ: 1)');
  });

  it('重複した番号は、1 つにまとめる', () => {
    expect(formatFailedPages([2, 2, 3])).toBe('2 ページの描画に失敗しました(ページ: 3, 4)');
  });

  it('失敗がなければ、空の文字列', () => {
    expect(formatFailedPages([])).toBe('');
  });
});
