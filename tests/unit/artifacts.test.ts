import { describe, expect, it } from 'vitest';
import { runDirName, runsToDelete, safeSegment, screenshotPath } from '../../e2e/helpers/artifacts.ts';

describe('runDirName(実行ごとのディレクトリ名)', () => {
  it('実行日時を YYYYMMDD-HHmmss にする(ゼロ埋めあり)', () => {
    expect(runDirName(new Date(2026, 8, 26, 12, 34, 56))).toBe('20260926-123456');
    expect(runDirName(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102-030405');
  });

  it('名前の辞書順が、実行の時系列と一致する', () => {
    const earlier = runDirName(new Date(2026, 8, 26, 9, 59, 59));
    const later = runDirName(new Date(2026, 8, 26, 10, 0, 0));
    expect(earlier < later).toBe(true);
  });
});

/** 時刻が 1 秒ずつ進む、n 個の実行ディレクトリ名を作る。 */
function runs(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `20260926-1200${String(i).padStart(2, '0')}`);
}

describe('runsToDelete(残す世代を超えた古い実行)', () => {
  it('新しい keep 個を残し、それより古いものを返す', () => {
    expect(runsToDelete(runs(12), 10)).toEqual(runs(12).slice(0, 2));
  });

  it('keep 個以下なら、何も削除しない', () => {
    expect(runsToDelete(runs(10), 10)).toEqual([]);
    expect(runsToDelete(runs(3), 10)).toEqual([]);
    expect(runsToDelete([], 10)).toEqual([]);
  });

  it('並びが乱れていても、名前の新旧で判断する', () => {
    const shuffled = [...runs(5)].reverse();
    expect(runsToDelete(shuffled, 3)).toEqual(runs(5).slice(0, 2));
  });

  it('実行ディレクトリの形式でない名前は、決して削除対象にしない', () => {
    const mixed = [...runs(3), 'latest', '.DS_Store', 'notes', '2026-09-26'];
    expect(runsToDelete(mixed, 1)).toEqual(runs(3).slice(0, 2));
  });

  it('keep が 0 なら、形式に合うものを全て返す', () => {
    expect(runsToDelete(runs(2), 0)).toEqual(runs(2));
  });
});

describe('screenshotPath(スクリーンショットの保存先)', () => {
  const root = 'e2e-artifacts/screenshots';

  it('実行ディレクトリ / テスト名 / 連番-ステップ名.png の形にする', () => {
    const path = screenshotPath(root, '20260926-123456', 'smoke.spec.ts ページが開く', 1, '初期表示');
    expect(path).toBe('e2e-artifacts/screenshots/20260926-123456/smoke-spec-ts-ページが開く/01-初期表示.png');
  });

  it('連番は 2 桁でゼロ埋めし、撮った順に並ぶ', () => {
    const [second, tenth] = [2, 10].map((n) => screenshotPath(root, 'run', 't', n, 's'));
    expect([second, tenth].sort()).toEqual([second, tenth]);
    expect(second).toContain('/02-');
  });

  it('テスト名やステップ名に区切りがあっても、実行ディレクトリの外に出ない', () => {
    const path = screenshotPath(root, 'run', '../../etc', 1, '../x');
    expect(path).toBe('e2e-artifacts/screenshots/run/etc/01-x.png');
  });
});

describe('safeSegment(テスト名をパスの 1 要素にする)', () => {
  it('パスの区切りや記号を、ハイフンにまとめる', () => {
    expect(safeSegment('a/b: c?')).toBe('a-b-c');
  });

  it('日本語は残す', () => {
    expect(safeSegment('ページが開く')).toBe('ページが開く');
  });

  it('前後の空白とハイフンを取り除く', () => {
    expect(safeSegment('  --x--  ')).toBe('x');
  });

  it('長すぎる名前は 80 文字に切り詰める', () => {
    expect(safeSegment('a'.repeat(200))).toHaveLength(80);
  });

  it('空になるときは untitled にする', () => {
    expect(safeSegment('///')).toBe('untitled');
    expect(safeSegment('')).toBe('untitled');
  });

  it('".." のような、親ディレクトリを指す名前にならない', () => {
    expect(safeSegment('..')).toBe('untitled');
    expect(safeSegment('../..')).toBe('untitled');
  });
});
