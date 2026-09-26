import { test, expect } from './helpers/fixtures.ts';
import { chooseFile, downloadPng, expectRendered, ui } from './helpers/app.ts';
import { environmentOf, recordMeasurement, renderMilliseconds, startRenderTimer } from './helpers/perf.ts';
import { commitColumns } from './helpers/render-watch.ts';
import { readPngSize } from './helpers/png-decode.ts';

// 性能は、数値の目標を設けず、実測値を e2e-artifacts/performance/ に記録するだけ(blueprint の NFR 3)。閾値でテストは失敗させない。
// 計測は、A4・30 ページと A4・150 ページ(列数は既定の 10)の、選択から描画の完了までの時間と、PNG の生成にかかる時間。
const CASES = [
  { file: 'many-pages-30.pdf', pages: 30, changeTo: '5' },
  { file: 'many-pages-150.pdf', pages: 150, changeTo: '15' },
] as const;

for (const { file, pages, changeTo } of CASES) {
  test(`計測: A4・${pages} ページ(既定の列数)の、描画・列数の変更・PNG の生成にかかる時間を記録する`, async ({ page }) => {
    await page.goto('/');
    await startRenderTimer(page);
    await chooseFile(page, file);
    await expectRendered(page);
    const renderMs = await renderMilliseconds(page);
    const size = await ui(page).canvas.evaluate((c: HTMLCanvasElement) => ({ width: c.width, height: c.height }));
    const pngStart = Date.now();
    const png = await downloadPng(page);
    const pngMs = Date.now() - pngStart;
    await startRenderTimer(page);
    await commitColumns(page, changeTo);
    await expectRendered(page);
    const rerenderMs = await renderMilliseconds(page);
    expect(renderMs, '描画の所要時間が測れている').toBeGreaterThan(0);
    expect(readPngSize(png.data)).toEqual(size);
    await recordMeasurement(`${pages}pages`, {
      file,
      pages,
      defaultColumns: 10,
      canvas: size,
      megapixels: Math.round((size.width * size.height) / 1e6),
      renderMs: Math.round(renderMs),
      msPerPage: Math.round((renderMs / pages) * 10) / 10,
      pngGenerateAndSaveMs: pngMs,
      pngBytes: png.data.length,
      columnsChangedTo: Number(changeTo),
      rerenderMs: Math.round(rerenderMs),
      environment: await environmentOf(page),
    });
  });
}
