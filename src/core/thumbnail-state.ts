/** 元PDFプレビュー(F11)の、1 ページ分のサムネイルの状態。 */
export type ThumbnailStatus = 'pending' | 'rendering' | 'rendered' | 'failed';

/** サムネイルの状態を変えるイベント(index は付けない。呼び出し側がページを指定する)。 */
export type ThumbnailEvent = { readonly type: 'visible' | 'invisible' | 'succeeded' | 'failed' };

/** 全ページを pending にした、初期状態を作る。 */
export function initialThumbnailState(pageCount: number): readonly ThumbnailStatus[] {
  return Array.from({ length: pageCount }, () => 'pending' as const);
}

/**
 * 1 ページの状態に、イベントを適用する(Q7: 画面外になったら pending に戻す。Q11: 失敗は区別する)。
 * 状況に合わない古いイベント(不可視化された後に届いた描画結果など)は無視する。
 */
function reduceOne(status: ThumbnailStatus, event: ThumbnailEvent): ThumbnailStatus {
  if (event.type === 'visible') return status === 'pending' ? 'rendering' : status;
  if (event.type === 'invisible') return status === 'pending' ? status : 'pending';
  if (event.type === 'succeeded') return status === 'rendering' ? 'rendered' : status;
  return status === 'rendering' ? 'failed' : status; // event.type === 'failed'
}

/** index 番目のページの状態にだけイベントを適用した配列を返す。変化がなければ同じ配列を返す。 */
export function reduceThumbnail(state: readonly ThumbnailStatus[], index: number, event: ThumbnailEvent): readonly ThumbnailStatus[] {
  const current = state[index];
  if (current === undefined) throw new RangeError(`範囲外のページ: ${index}`);
  const next = reduceOne(current, event);
  return next === current ? state : state.map((status, i) => (i === index ? next : status));
}
