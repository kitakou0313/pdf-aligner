import { createHash } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import type { DecodedPng, Rgba } from './png-decode.ts';

/** 画像上の座標(px)。 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 背景色(blueprint の F2: 薄いグレー。RGB 230, 230, 230。不透明)。 */
export const BACKGROUND: readonly [number, number, number] = [230, 230, 230];

/** 画面の canvas の、指定した点の色を読む。 */
export async function canvasPixels(page: Page, points: readonly Point[]): Promise<Rgba[]> {
  return page.evaluate((pts) => {
    const ctx = document.querySelector<HTMLCanvasElement>('#canvas')?.getContext('2d');
    if (!ctx) throw new Error('canvas がありません');
    return pts.map(({ x, y }) => [...ctx.getImageData(x, y, 1, 1).data] as [number, number, number, number]);
  }, points);
}

/** 画面の canvas の、矩形の中にある「ほぼ黒」(各成分が 12 以下)の画素の数を数える(文字が描かれているかを調べるため)。 */
export async function countBlackPixels(page: Page, rect: { x: number; y: number; width: number; height: number }): Promise<number> {
  return page.evaluate(({ x, y, width, height }) => {
    const ctx = document.querySelector<HTMLCanvasElement>('#canvas')?.getContext('2d');
    if (!ctx) throw new Error('canvas がありません');
    const data = ctx.getImageData(x, y, width, height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) <= 12) count += 1;
    return count;
  }, rect);
}

/** 画面の canvas の大きさと、全画素(RGBA)の SHA-256(16 進)を求める。PNG の画素との一致を、全画素を運ばずに確かめるため。 */
export async function canvasHash(page: Page): Promise<{ width: number; height: number; sha256: string }> {
  return page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    const sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return { width: canvas.width, height: canvas.height, sha256 };
  });
}

/** 復号した PNG の全画素(RGBA)の SHA-256(16 進)。canvasHash と同じ方法で求める。 */
export function pngHash(png: DecodedPng): string {
  return createHash('sha256').update(png.rgba).digest('hex');
}

/** 色が、期待する RGB と、各成分の差 tolerance 以内で一致し、不透明(alpha 255)であることを確かめる。 */
export function expectColor(actual: Rgba, expected: readonly [number, number, number], tolerance: number, label: string): void {
  const [r, g, b, a] = actual;
  const within = [r, g, b].every((value, i) => Math.abs(value - (expected[i] as number)) <= tolerance);
  expect(within && a === 255, `${label}: 期待 rgb(${expected.join(', ')}) ±${tolerance}、実際 rgba(${actual.join(', ')})`).toBe(true);
}
