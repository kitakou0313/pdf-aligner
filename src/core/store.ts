/** 状態の入れ物。イベントを reducer に通して状態を更新し、変わったときだけ購読者に知らせる。 */
export interface Store<S, E> {
  getState(): S;
  dispatch(event: E): void;
  /** 状態が変わったときに呼ばれる関数を登録する。戻り値を呼ぶと登録を解除する。 */
  subscribe(listener: (state: S) => void): () => void;
}

/** reducer を通して状態を更新するストアの実装。 */
class ReducerStore<S, E> implements Store<S, E> {
  private state: S;
  private readonly reduce: (state: S, event: E) => S;
  private readonly listeners = new Set<(state: S) => void>();

  /** 初期状態と reducer から作る。 */
  constructor(initial: S, reduce: (state: S, event: E) => S) {
    this.state = initial;
    this.reduce = reduce;
  }

  /** 現在の状態。 */
  getState(): S {
    return this.state;
  }

  /** イベントを適用する。状態が変わったときだけ(reducer が同じ値を返したら何もしない)、購読者に知らせる。 */
  dispatch(event: E): void {
    const next = this.reduce(this.state, event);
    if (next === this.state) return;
    this.state = next;
    notifyAll(this.listeners, () => this.state);
  }

  /** 購読者を登録する。戻り値の関数で解除できる。 */
  subscribe(listener: (state: S) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}

/** 初期状態と reducer(同じ値を返したら「変化なし」)から、ストアを作る。 */
export function createStore<S, E>(initial: S, reduce: (state: S, event: E) => S): Store<S, E> {
  return new ReducerStore(initial, reduce);
}

/**
 * 全ての購読者に、その時点の最新の状態を渡す。購読者が例外を投げても、残りへの通知は続け、
 * 最初の例外を最後に投げ直す(入れ子の dispatch があっても、各購読者は最新の状態を受け取る)。
 */
function notifyAll<S>(listeners: ReadonlySet<(state: S) => void>, latest: () => S): void {
  const failures: unknown[] = [];
  for (const listener of [...listeners]) {
    try {
      listener(latest());
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}
