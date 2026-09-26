// 列数の入力を画像に反映するまでの待ち時間(blueprint の F4)
export const COLUMNS_DEBOUNCE_MS = 300;

/** デバウンスした関数。cancel で、待っている実行を取り消す。 */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

/** 呼ばれてから delayMs 経つまで実行を待ち、その間にまた呼ばれたら待ち直して、最後の引数で 1 回だけ実行する関数を作る。 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, delayMs: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** 待ち時間を数え直して、最後の引数での実行を予約する。 */
  const debounced = (...args: A): void => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
  /** 予約している実行を取り消す(何も予約していなければ何もしない)。 */
  debounced.cancel = (): void => clearTimeout(timer);
  return debounced;
}
