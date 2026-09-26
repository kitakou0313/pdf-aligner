import { expect, test } from './helpers/fixtures.ts';
import { Sink } from './helpers/sink.ts';

// 外部サーバーの代役(127.0.0.1)を使い、実際のインターネットには出ずに「通信ゼロ」を検証する
let sink: Sink;
test.beforeAll(async () => {
  sink = await Sink.start();
});
test.afterAll(async () => {
  await sink.close();
});

test('CSP が、ページから外部への fetch を止める', async ({ page, net, shot }) => {
  await page.goto('/');
  const outcome = await page.evaluate(async (url) => {
    try {
      await fetch(url, { mode: 'no-cors' });
      return 'sent';
    } catch {
      return 'blocked';
    }
  }, sink.url);
  await shot('fetch の結果');
  expect(outcome).toBe('blocked');
  expect(sink.hits()).toBe(0);
  net.reset(); // 試みた記録(ブロックされた要求)は、意図したものなのでここで消す
});

test('CSP が、外部の画像の読み込みも止める', async ({ page, net }) => {
  await page.goto('/');
  const outcome = await page.evaluate(
    (url) =>
      new Promise<string>((resolve) => {
        const image = new Image();
        image.addEventListener('load', () => resolve('loaded'));
        image.addEventListener('error', () => resolve('blocked'));
        image.src = url;
      }),
    sink.url,
  );
  expect(outcome).toBe('blocked');
  expect(sink.hits()).toBe(0);
  net.reset();
});

test('検査は空振りしない: 外部への通信を、実際に検出できる', async ({ page, net }) => {
  const before = sink.hits();
  await page.goto(sink.url); // CSP のない別文書へ移動する = 外部への通信
  expect(net.external()).toContain(sink.url);
  expect(sink.hits()).toBeGreaterThan(before);
  net.reset();
});
