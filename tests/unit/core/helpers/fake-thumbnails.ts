import type { ThumbnailPriority } from '../../../../src/core/controller.ts';

/** テストから settled/unsettled を自由に切り替えられる、元PDFプレビュー優先の偽物。 */
export class FakeThumbnails implements ThumbnailPriority {
  private settled: boolean;
  private readonly listeners = new Set<(settled: boolean) => void>();

  /** 初期状態(既定は settled)から作る。 */
  constructor(settled = true) {
    this.settled = settled;
  }

  /** 今の settled。 */
  isSettled(): boolean {
    return this.settled;
  }

  /** 変わるたびに呼ぶ。返り値で購読解除する。 */
  onSettledChange(listener: (settled: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** テストから、settled を切り替えて、変わったときだけ購読者に知らせる。 */
  setSettled(value: boolean): void {
    if (value === this.settled) return;
    this.settled = value;
    for (const listener of [...this.listeners]) listener(value);
  }
}
