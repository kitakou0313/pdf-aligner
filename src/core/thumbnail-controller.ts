import { initialThumbnailState, reduceThumbnail, type ThumbnailStatus } from './thumbnail-state.ts';

/** コントローラが頼る外部: 1 ページ分の描画と、状態が変わったときの通知。 */
export interface ThumbnailControllerDeps {
  /** index 番目のページを描く。失敗したら拒否する(中断されたら AbortError で拒否する)。 */
  render(index: number, signal: AbortSignal): Promise<void>;
  /** index 番目のページの状態が変わったとき。 */
  onChange(index: number, status: ThumbnailStatus): void;
}

/**
 * 元PDFプレビュー(F11)の、可視化イベントから render の呼び出しを調停する。
 * 状態そのものは core/thumbnail-state.ts の純関数が決め、ここは非同期の render と中断だけを扱う。
 */
export class ThumbnailController {
  private state: readonly ThumbnailStatus[] = [];
  private readonly aborts = new Map<number, AbortController>();
  private readonly deps: ThumbnailControllerDeps;

  /** 描画の関数と、変化の通知先から作る。 */
  constructor(deps: ThumbnailControllerDeps) {
    this.deps = deps;
  }

  /** 新しい文書に差し替える。進行中の render はすべて中断し、指定したページ数の pending に戻す。 */
  reset(pageCount: number): void {
    for (const controller of this.aborts.values()) controller.abort();
    this.aborts.clear();
    this.state = initialThumbnailState(pageCount);
  }

  /** index 番目のページが見えるようになった。pending だったときだけ、描画を始める。 */
  visible(index: number): void {
    const before = this.state[index];
    this.apply(index, { type: 'visible' });
    if (before === 'pending' && this.state[index] === 'rendering') this.startRender(index);
  }

  /** index 番目のページが見えなくなった。進行中の render を中断し、pending に戻す(Q7)。 */
  invisible(index: number): void {
    this.aborts.get(index)?.abort();
    this.aborts.delete(index);
    this.apply(index, { type: 'invisible' });
  }

  /** index 番目のページの、今の状態。 */
  statusOf(index: number): ThumbnailStatus {
    return this.state[index] as ThumbnailStatus;
  }

  /** render を呼び、結果(成功/失敗)を状態に反映する。 */
  private startRender(index: number): void {
    const controller = new AbortController();
    this.aborts.set(index, controller);
    this.deps.render(index, controller.signal).then(
      () => this.finishRender(index, { type: 'succeeded' }),
      () => this.finishRender(index, { type: 'failed' }),
    );
  }

  /** render が終わったときの後始末(中断の手段を手放して、状態に反映する)。 */
  private finishRender(index: number, event: { type: 'succeeded' | 'failed' }): void {
    this.aborts.delete(index);
    this.apply(index, event);
  }

  /** イベントを状態に適用し、実際に変わったときだけ通知する。 */
  private apply(index: number, event: { type: 'visible' | 'invisible' | 'succeeded' | 'failed' }): void {
    const before = this.state[index];
    this.state = reduceThumbnail(this.state, index, event);
    const after = this.state[index] as ThumbnailStatus;
    if (after !== before) this.deps.onChange(index, after);
  }
}
