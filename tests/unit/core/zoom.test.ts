import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  clampScroll,
  clampZoom,
  cssScale,
  fitZoom,
  reduceZoom,
  resolveZoom,
  scrollForZoomAt,
  stepZoom,
  zoomRange,
  type Point,
  type ZoomState,
} from '../../../src/core/zoom.ts';

describe('cssScale(画像ピクセル基準の倍率から、CSS の拡大率へ)', () => {
  it.each([
    [1, 1, 1],
    [1, 2, 0.5],
    [8, 2, 4],
    [0.1, 2, 0.05],
    [0.5, 3, 0.5 / 3],
  ])('倍率 %d、devicePixelRatio %d → CSS の拡大率 %d(100% は画像 1 px = 物理 1 px)', (zoom, dpr, expected) => {
    expect(cssScale(zoom, dpr)).toBeCloseTo(expected, 10);
  });

  it.each([0, -1, Number.NaN])('devicePixelRatio %s は、例外にする', (dpr) => {
    expect(() => cssScale(1, dpr)).toThrow(RangeError);
  });
});

describe('fitZoom(全体が領域に収まる倍率。blueprint の例 4)', () => {
  const IMAGE = { width: 2476, height: 5180 };
  const VIEWPORT = { width: 1000, height: 800 };

  it('DPR 1: min(1000/2476, 800/5180) ≈ 0.154(表示は 15%)', () => {
    expect(fitZoom(IMAGE, VIEWPORT, 1)).toBeCloseTo(800 / 5180, 10);
    expect(Math.round(fitZoom(IMAGE, VIEWPORT, 1) * 100)).toBe(15);
  });

  it('DPR 2: 画像ピクセル基準に直すので 2 倍の 0.309(表示は 31%)', () => {
    expect(fitZoom(IMAGE, VIEWPORT, 2)).toBeCloseTo((2 * 800) / 5180, 10);
    expect(Math.round(fitZoom(IMAGE, VIEWPORT, 2) * 100)).toBe(31);
  });

  it('1 ページだけの小さい画像は、上限の 100% で止まる(拡大しない)', () => {
    expect(fitZoom({ width: 1254, height: 1748 }, { width: 2000, height: 2000 }, 1)).toBe(1);
  });

  it('DPR 2 でも上限は 100%(画像 1 px = 物理 1 px)', () => {
    expect(fitZoom({ width: 100, height: 100 }, { width: 5000, height: 5000 }, 2)).toBe(1);
  });

  it('縦と横のうち、厳しい方に合わせる', () => {
    expect(fitZoom({ width: 1000, height: 100 }, { width: 500, height: 500 }, 1)).toBe(0.5);
    expect(fitZoom({ width: 100, height: 1000 }, { width: 500, height: 500 }, 1)).toBe(0.5);
  });

  it('領域の大きさが 0(非表示など)なら 0 を返す(領域が戻れば、再計算で復帰する)', () => {
    expect(fitZoom(IMAGE, { width: 0, height: 0 }, 1)).toBe(0);
  });

  it('画像の大きさが 0 以下、領域が負、DPR が 0 以下なら、例外にする', () => {
    expect(() => fitZoom({ width: 0, height: 10 }, VIEWPORT, 1)).toThrow(RangeError);
    expect(() => fitZoom(IMAGE, { width: -1, height: 10 }, 1)).toThrow(RangeError);
    expect(() => fitZoom(IMAGE, VIEWPORT, 0)).toThrow(RangeError);
  });
});

describe('zoomRange と clampZoom(範囲は [min(10%, 全体が収まる倍率), 800%])', () => {
  it('全体が収まる倍率が 10% 以上なら、範囲は 10%〜800%', () => {
    expect(zoomRange(0.5)).toEqual({ min: 0.1, max: 8 });
    expect(zoomRange(1)).toEqual({ min: 0.1, max: 8 });
    expect(MIN_ZOOM).toBe(0.1);
    expect(MAX_ZOOM).toBe(8);
  });

  it('巨大な画像で 10% を下回るときは、下限を「収まる倍率」まで下げる', () => {
    expect(zoomRange(0.02)).toEqual({ min: 0.02, max: 8 });
  });

  it.each([
    [20, 0.5, 8],
    [0.01, 0.5, 0.1],
    [0.01, 0.02, 0.02],
    [1, 0.5, 1],
    [8, 0.5, 8],
    [0.1, 0.5, 0.1],
  ])('clampZoom(%d, fit=%d) → %d', (zoom, fit, expected) => {
    expect(clampZoom(zoom, fit)).toBe(expected);
  });

  it('数でない倍率は、例外にする', () => {
    expect(() => clampZoom(Number.NaN, 0.5)).toThrow(RangeError);
  });
});

describe('resolveZoom(モードから、実際に使う倍率を決める)', () => {
  it('fit モードは、全体が収まる倍率そのもの', () => {
    expect(resolveZoom({ mode: 'fit' }, 0.3)).toBe(0.3);
  });

  it('manual モードは、指定した倍率(範囲内ならそのまま)', () => {
    expect(resolveZoom({ mode: 'manual', zoom: 3 }, 0.3)).toBe(3);
  });

  it('manual モードでも、範囲外なら範囲に丸める(ウィンドウや列数の変化で範囲が変わるため)', () => {
    expect(resolveZoom({ mode: 'manual', zoom: 0.05 }, 0.5)).toBe(0.1);
    expect(resolveZoom({ mode: 'manual', zoom: 20 }, 0.5)).toBe(8);
  });
});

describe('stepZoom(＋ / − ボタンの 1 段階)', () => {
  it('＋ で 1.25 倍、− で 1/1.25 倍', () => {
    expect(ZOOM_STEP).toBe(1.25);
    expect(stepZoom(1, 1, 0.5)).toBeCloseTo(1.25, 10);
    expect(stepZoom(1, -1, 0.5)).toBeCloseTo(0.8, 10);
  });

  it('上限 800% と下限で止まる', () => {
    expect(stepZoom(7, 1, 0.5)).toBe(8);
    expect(stepZoom(8, 1, 0.5)).toBe(8);
    expect(stepZoom(0.11, -1, 0.5)).toBe(0.1);
    expect(stepZoom(0.1, -1, 0.5)).toBe(0.1);
  });

  it('巨大な画像では、下限が「収まる倍率」まで下がる', () => {
    expect(stepZoom(0.03, -1, 0.02)).toBeCloseTo(0.024, 10);
    expect(stepZoom(0.021, -1, 0.02)).toBe(0.02);
  });
});

describe('scrollForZoomAt(カーソルの下の点を動かさない拡縮)', () => {
  it('例: スクロール (100, 200)、カーソル (50, 60)、CSS の拡大率 1 → 2 で、新しいスクロールは (250, 460)', () => {
    expect(scrollForZoomAt({ x: 100, y: 200 }, { x: 50, y: 60 }, 1, 2)).toEqual({ x: 250, y: 460 });
  });

  it('カーソルの下にある画像上の点が、拡縮の前後で動かない', () => {
    const cases: [Point, Point, number, number][] = [
      [{ x: 100, y: 200 }, { x: 50, y: 60 }, 1, 2],
      [{ x: 0, y: 0 }, { x: 300, y: 200 }, 0.5, 0.625],
      [{ x: 1234, y: 5678 }, { x: 10, y: 790 }, 2, 0.1],
    ];
    for (const [scroll, pointer, before, after] of cases) {
      const next = scrollForZoomAt(scroll, pointer, before, after);
      expect((next.x + pointer.x) / after).toBeCloseTo((scroll.x + pointer.x) / before, 6);
      expect((next.y + pointer.y) / after).toBeCloseTo((scroll.y + pointer.y) / before, 6);
    }
  });

  it('倍率が同じなら、スクロールは変わらない', () => {
    expect(scrollForZoomAt({ x: 12, y: 34 }, { x: 5, y: 6 }, 0.7, 0.7)).toEqual({ x: 12, y: 34 });
  });

  it('縮小すると、範囲外(負)になりうる。丸めは clampScroll の役目', () => {
    expect(scrollForZoomAt({ x: 0, y: 0 }, { x: 300, y: 200 }, 1, 0.5)).toEqual({ x: -150, y: -100 });
  });

  it.each([0, -1, Number.NaN])('拡大率 %s は、例外にする', (bad) => {
    expect(() => scrollForZoomAt({ x: 0, y: 0 }, { x: 0, y: 0 }, bad, 1)).toThrow(RangeError);
    expect(() => scrollForZoomAt({ x: 0, y: 0 }, { x: 0, y: 0 }, 1, bad)).toThrow(RangeError);
  });
});

describe('clampScroll(スクロール位置を、動ける範囲に収める)', () => {
  const VIEWPORT = { width: 400, height: 300 };

  it('内容が領域より大きいとき、0 〜(内容 − 領域)に収める', () => {
    const content = { width: 1000, height: 2000 };
    expect(clampScroll({ x: -50, y: -1 }, content, VIEWPORT)).toEqual({ x: 0, y: 0 });
    expect(clampScroll({ x: 9999, y: 9999 }, content, VIEWPORT)).toEqual({ x: 600, y: 1700 });
    expect(clampScroll({ x: 300, y: 800 }, content, VIEWPORT)).toEqual({ x: 300, y: 800 });
  });

  it('内容が領域より小さい軸は、動けないので 0', () => {
    expect(clampScroll({ x: 30, y: 40 }, { width: 200, height: 100 }, VIEWPORT)).toEqual({ x: 0, y: 0 });
  });

  it('片方の軸だけが大きいときは、その軸だけ動ける', () => {
    expect(clampScroll({ x: 30, y: 40 }, { width: 200, height: 1000 }, VIEWPORT)).toEqual({ x: 0, y: 40 });
  });
});

describe('reduceZoom(モードの遷移)', () => {
  const FIT: ZoomState = { mode: 'fit' };

  it('操作(＋ / −、Ctrl+ホイール、ピンチ)で manual になり、指定した倍率を保つ', () => {
    expect(reduceZoom(FIT, { type: 'set', zoom: 2 })).toEqual({ mode: 'manual', zoom: 2 });
  });

  it('manual の間に、続けて操作すると、最後の倍率になる', () => {
    const once = reduceZoom(FIT, { type: 'set', zoom: 2 });
    expect(reduceZoom(once, { type: 'set', zoom: 3 })).toEqual({ mode: 'manual', zoom: 3 });
  });

  it('「画面に合わせる」と、新しい PDF の読み込みで、fit に戻る', () => {
    const manual: ZoomState = { mode: 'manual', zoom: 2 };
    expect(reduceZoom(manual, { type: 'fit' })).toEqual(FIT);
  });

  it('列数の変更やウィンドウのリサイズでは、モードも倍率も変わらない(そのため、対応するイベントを持たない)', () => {
    const manual: ZoomState = { mode: 'manual', zoom: 2 };
    expect(reduceZoom(manual, { type: 'set', zoom: 2 })).toEqual(manual);
    expect(reduceZoom(FIT, { type: 'fit' })).toEqual(FIT);
  });
});
