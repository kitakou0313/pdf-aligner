import type { PageSource } from '../../../../src/core/compose.ts';
import type { PageSize, Placement } from '../../../../src/core/layout.ts';

/** n ページ目の描画の振る舞い(成功する、失敗する、待たされるなど)。 */
export type Behavior = (index: number, signal: AbortSignal) => Promise<void>;

/** 何もせず、すぐに成功する既定の振る舞い。 */
export async function succeedNow(): Promise<void> {}

/** PageSource の偽物。描画の呼び出し(順序、配置、同時実行数)を記録し、振る舞いは差し替えられる。 */
export class FakeSource implements PageSource {
  readonly pageCount: number;
  readonly calls: number[] = [];
  readonly placements: Placement[] = [];
  maxInFlight = 0;
  private inFlight = 0;
  private readonly sizes: readonly PageSize[];
  private readonly behavior: Behavior;
  private readonly unreadable: ReadonlySet<number>;

  /**
   * 各ページの大きさ、描画の振る舞い(既定は即座に成功)、大きさが読めなかったページ(0 始まり。既定はなし)から、偽物を作る。
   * 読めなかったページの大きさ(sizes の要素)は、本物と同じく、代わりの大きさを渡す。
   */
  constructor(sizes: readonly PageSize[], behavior: Behavior = succeedNow, unreadable: readonly number[] = []) {
    this.sizes = sizes;
    this.pageCount = sizes.length;
    this.behavior = behavior;
    this.unreadable = new Set(unreadable);
  }

  /** n ページ目の大きさ。 */
  pageSize(index: number): PageSize {
    return this.sizes[index] as PageSize;
  }

  /** n ページ目の大きさが読めたか。 */
  isReadable(index: number): boolean {
    return !this.unreadable.has(index);
  }

  /** 呼び出しを記録し、同時に走る描画の数を数えながら、決めた振る舞いを実行する。 */
  async renderPage(index: number, placement: Placement, signal: AbortSignal): Promise<void> {
    this.calls.push(index);
    this.placements.push(placement);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await this.behavior(index, signal);
    } finally {
      this.inFlight -= 1;
    }
  }
}
