import { describe, expect, it } from 'vitest';
import { ZoomController } from '../../../src/core/zoom-controller.ts';

const EXAMPLE_1 = { width: 2476, height: 5180 }; // blueprint の例 1: A4 縦 5 ページ、列数 2、倍率 2
const AREA = { width: 1000, height: 800 };

/** 画像とプレビュー領域と密度を与えた、ズームの制御器を作る。 */
function controller(image = EXAMPLE_1, viewport = AREA, dpr = 1): ZoomController {
  const zoom = new ZoomController();
  zoom.setDevicePixelRatio(dpr);
  zoom.setViewport(viewport);
  zoom.setImage(image);
  return zoom;
}

describe('ZoomController: 画面に合わせる(fit)', () => {
  it('画像が無いあいだは、倍率を持たない', () => {
    expect(new ZoomController().view()).toBeNull();
  });

  it('既定は fit。全体が領域に収まる倍率(blueprint の例 4: 15%)で、CSS の拡大率は倍率 ÷ 密度', () => {
    const view = controller().view();
    expect(view?.mode).toBe('fit');
    expect(view?.zoom).toBeCloseTo(Math.min(1000 / 2476, 800 / 5180, 1), 12);
    expect(view?.label).toBe('15%');
    expect(view?.cssScale).toBeCloseTo(view!.zoom, 12);
  });

  it('小さい画像は、拡大しない(上限は 100%)。blueprint の例 4: 1254 × 1748 px、領域 2000 × 2000', () => {
    const view = controller({ width: 1254, height: 1748 }, { width: 2000, height: 2000 }).view();
    expect(view?.zoom).toBe(1);
    expect(view?.label).toBe('100%');
  });

  it('密度が 2 のとき、100% は CSS の拡大率 0.5(blueprint の例 4)', () => {
    const view = controller({ width: 1254, height: 1748 }, { width: 2000, height: 2000 }, 2).view();
    expect(view?.zoom).toBe(1);
    expect(view?.cssScale).toBe(0.5);
  });

  it('領域の大きさが変わると、倍率を合わせ直す', () => {
    const zoom = controller();
    const before = zoom.view()?.zoom as number;
    zoom.setViewport({ width: 500, height: 400 });
    expect(zoom.view()?.zoom).toBeCloseTo(before / 2, 12);
  });

  it('画像の大きさが変わると(列数の変更、自動縮小)、倍率を合わせ直す', () => {
    const zoom = controller();
    zoom.setImage({ width: 1000, height: 400 });
    expect(zoom.view()?.zoom).toBeCloseTo(1, 12);
  });

  it('密度が変わると(画面の移動、ブラウザのズーム)、倍率を合わせ直す', () => {
    const zoom = controller({ width: 1000, height: 800 }, { width: 800, height: 800 }, 1);
    expect(zoom.view()?.zoom).toBeCloseTo(0.8, 12);
    zoom.setDevicePixelRatio(2);
    expect(zoom.view()?.zoom).toBeCloseTo(1, 12);
  });
});

describe('ZoomController: 固定(manual)', () => {
  it('倍率を指定すると固定になり、領域や画像が変わっても、その倍率を保つ', () => {
    const zoom = controller();
    zoom.zoomTo(2);
    zoom.setViewport({ width: 300, height: 300 });
    zoom.setImage({ width: 50, height: 50 });
    expect(zoom.view()).toMatchObject({ mode: 'manual', zoom: 2, label: '200%' });
  });

  it('範囲は、10% と全体が収まる倍率の小さい方から、800% まで', () => {
    const zoom = controller();
    zoom.zoomTo(100);
    expect(zoom.view()?.zoom).toBe(8);
    zoom.zoomTo(0.0001);
    expect(zoom.view()?.zoom).toBeCloseTo(0.1, 12);
  });

  it('巨大な画像で、全体が収まる倍率が 10% を下回るときは、そこまで下げられる', () => {
    const zoom = controller({ width: 12_000, height: 34_000 });
    const fit = zoom.view()?.zoom as number;
    expect(fit).toBeLessThan(0.1);
    zoom.zoomTo(0.0001);
    expect(zoom.view()?.zoom).toBeCloseTo(fit, 12);
  });

  it('固定の倍率は、範囲が変わって範囲外になったら、範囲内に丸めて表示する', () => {
    const zoom = controller();
    zoom.zoomTo(0.05);
    expect(zoom.view()?.zoom).toBeCloseTo(0.1, 12);
    zoom.setImage({ width: 12_000, height: 34_000 });
    expect(zoom.view()?.zoom).toBeCloseTo(0.05, 12);
  });

  it('＋ / − は、1 回で 1.25 倍 / 1/1.25 倍。押すと固定になる', () => {
    const zoom = controller();
    zoom.zoomTo(1);
    zoom.step(1);
    expect(zoom.view()).toMatchObject({ mode: 'manual', zoom: 1.25 });
    zoom.step(-1);
    zoom.step(-1);
    expect(zoom.view()?.zoom).toBeCloseTo(0.8, 12);
  });

  it('fit のときに＋ / − を押すと、そのときの倍率(fit)から 1 段階だけ動く', () => {
    const zoom = controller();
    const fit = zoom.view()?.zoom as number;
    zoom.step(1);
    expect(zoom.view()).toMatchObject({ mode: 'manual' });
    expect(zoom.view()?.zoom).toBeCloseTo(fit * 1.25, 12);
  });

  it('巨大な画像では、− の下限は「全体が収まる倍率」まで下がる(10% では止まらない)', () => {
    const zoom = controller({ width: 12_000, height: 34_000 });
    const fit = zoom.view()?.zoom as number;
    zoom.zoomTo(0.03);
    zoom.step(-1);
    expect(zoom.view()?.zoom).toBeCloseTo(0.024, 10);
    zoom.step(-1);
    expect(zoom.view()?.zoom).toBeCloseTo(fit, 10);
  });

  it('画像がないあいだの操作は、あとで画像が来たときのモードに影響しない(fit のまま)', () => {
    const zoom = new ZoomController();
    zoom.setViewport(AREA);
    zoom.zoomTo(3);
    zoom.actual();
    zoom.step(1);
    zoom.setImage(EXAMPLE_1);
    expect(zoom.view()?.mode).toBe('fit');
  });

  it('＋ / − は、範囲の端で止まる', () => {
    const zoom = controller();
    zoom.zoomTo(8);
    zoom.step(1);
    expect(zoom.view()?.zoom).toBe(8);
    zoom.zoomTo(0.0001);
    zoom.step(-1);
    expect(zoom.view()?.zoom).toBeCloseTo(0.1, 12);
  });

  it('「100%」(actual)は、倍率 1 の固定。密度 2 のとき、CSS の拡大率は 0.5', () => {
    const zoom = controller(EXAMPLE_1, AREA, 2);
    zoom.actual();
    expect(zoom.view()).toMatchObject({ mode: 'manual', zoom: 1, cssScale: 0.5, label: '100%' });
  });

  it('「画面に合わせる」(fit)で fit に戻る。新しい PDF の読み込み(reset)も fit に戻す', () => {
    const zoom = controller();
    zoom.zoomTo(3);
    zoom.fit();
    expect(zoom.view()?.mode).toBe('fit');
    zoom.zoomTo(3);
    zoom.reset();
    expect(zoom.view()?.mode).toBe('fit');
  });

  it('画像を表示しないとき(null)は、操作しても倍率を持たない', () => {
    const zoom = controller();
    zoom.setImage(null);
    zoom.step(1);
    zoom.actual();
    expect(zoom.view()).toBeNull();
  });
});

describe('ZoomController: 比で拡縮する(ホイール・ピンチ)', () => {
  it('今の倍率に比をかけて、固定モードにする', () => {
    const zoom = controller();
    zoom.zoomTo(1);
    zoom.zoomBy(1.5);
    expect(zoom.view()).toMatchObject({ mode: 'manual', zoom: 1.5 });
  });

  it('fit のときは、そのときの倍率(fit)からかける', () => {
    const zoom = controller();
    const fit = zoom.view()?.zoom as number;
    zoom.zoomBy(2);
    expect(zoom.view()?.zoom).toBeCloseTo(fit * 2, 12);
  });

  it('範囲の端に達したあとは、端の倍率から動く(範囲外に溜め込まない)', () => {
    const zoom = controller();
    zoom.zoomTo(8);
    zoom.zoomBy(2);
    zoom.zoomBy(2);
    expect(zoom.view()?.zoom).toBe(8);
    zoom.zoomBy(0.5);
    expect(zoom.view()?.zoom).toBe(4);
  });

  it('画像がないときは何もしない。比が正でない(0、負、NaN)ときは例外にする', () => {
    const empty = new ZoomController();
    empty.zoomBy(2);
    expect(empty.view()).toBeNull();
    for (const bad of [0, -1, Number.NaN]) expect(() => controller().zoomBy(bad)).toThrow(RangeError);
  });
});

describe('ZoomController: 不正な入力', () => {
  it('数でない倍率は、例外にする', () => {
    expect(() => controller().zoomTo(Number.NaN)).toThrow(RangeError);
  });

  it('大きさが 0 の領域(非表示の間)でも、倍率を計算できる(範囲の下限は 0 の fit)', () => {
    const zoom = controller(EXAMPLE_1, { width: 0, height: 0 });
    expect(zoom.view()?.zoom).toBe(0);
  });
});
