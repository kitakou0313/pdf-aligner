import { planLayout, type Layout, type LayoutPlan, type PageSize, type Placement } from './layout.ts';
import type { CanvasLimits } from './limits.ts';

/** ページの供給元。pdf.js の実物は pdf/ 層が、テストでは偽物が、この形で提供する。 */
export interface PageSource {
  readonly pageCount: number;
  /** n ページ目の大きさ(pt)。読めなかったページ(isReadable が false)は、代わりの大きさ。 */
  pageSize(index: number): PageSize;
  /** n ページ目の大きさが読めたか(読めなかったページは、壊れたページ)。 */
  isReadable(index: number): boolean;
  /** n ページ目を、出力画像の placement の位置・大きさで描く(白で塗ってから描く責務も、ここにある)。 */
  renderPage(index: number, placement: Placement, signal: AbortSignal): Promise<void>;
}

/** 全ページの合成の設定と、通知の受け取り口。 */
export interface ComposeOptions {
  readonly columns: number;
  readonly signal: AbortSignal;
  readonly limits?: CanvasLimits;
  /** レイアウトが決まったとき(出力先の大きさと背景を用意し、縮小の通知を出すために)。 */
  readonly onLayout?: (plan: LayoutPlan) => void;
  /** 1 ページを処理するたびに(失敗したページも数える)。 */
  readonly onProgress?: (done: number, total: number) => void;
}

/** 合成の結果。failedPages は、描画に失敗したページの番号(0 始まり、昇順)。 */
export interface ComposeResult {
  readonly status: 'done' | 'cancelled';
  readonly failedPages: number[];
  readonly layout: Layout | null;
}

/** 供給元の全ページの大きさを、順に集める。 */
function sizesOf(source: PageSource): PageSize[] {
  return Array.from({ length: source.pageCount }, (_, index) => source.pageSize(index));
}

/** 1 ページを描く。失敗は failed に記録して続行し、キャンセルされていたら false を返す。 */
async function renderOne(source: PageSource, placement: Placement, signal: AbortSignal, failed: number[]): Promise<boolean> {
  if (signal.aborted) return false;
  try {
    await source.renderPage(placement.index, placement, signal);
  } catch {
    if (!signal.aborted) failed.push(placement.index);
  }
  return !signal.aborted;
}

/** 全ページを、1 ページずつ順番に描く。キャンセルされたら、その時点で中断する。 */
async function renderAll(source: PageSource, layout: Layout, options: ComposeOptions): Promise<ComposeResult> {
  const failedPages: number[] = [];
  let done = 0;
  for (const placement of layout.placements) {
    if (!(await renderOne(source, placement, options.signal, failedPages))) {
      return { status: 'cancelled', failedPages, layout };
    }
    done += 1;
    options.onProgress?.(done, source.pageCount);
  }
  return { status: 'done', failedPages, layout };
}

/**
 * 全ページを、レイアウトどおりに、行方向の順で 1 ページずつ描く。
 * 列数やページ数が不正なら、何も通知・描画せずに RangeError で拒否する。
 * ページ単位の失敗は、空セルのまま続行して failedPages に記録する。
 * キャンセル(signal)されたら、以降の通知も描画もせずに cancelled を返す。
 */
export async function composePages(source: PageSource, options: ComposeOptions): Promise<ComposeResult> {
  if (options.signal.aborted) return { status: 'cancelled', failedPages: [], layout: null };
  const plan = planLayout(sizesOf(source), options.columns, options.limits);
  options.onLayout?.(plan);
  options.onProgress?.(0, source.pageCount);
  return renderAll(source, plan.layout, options);
}
