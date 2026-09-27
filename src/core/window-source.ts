import type { PageSource } from './compose.ts';
import type { PageSize, Placement } from './layout.ts';

/**
 * 窓の中で、大きさが読めなかったページの代わりの大きさ。窓の中で最初に読めたページの大きさ。
 * 窓の中に読めたページがなければ、元の供給元が持つ代わりの大きさ(PDF 全体で最初に読めたページの大きさ)。
 */
function substituteSize(inner: PageSource, first: number, count: number): PageSize {
  for (let index = first; index < first + count; index += 1) {
    if (inner.isReadable(index)) return inner.pageSize(index);
  }
  return inner.pageSize(first);
}

/** 元のページ供給元の、first ページ目(0 始まり)から count ページの範囲だけを見せる窓。ページの番号は、窓の中で 0 から数える。 */
class WindowSource implements PageSource {
  readonly pageCount: number;
  private readonly inner: PageSource;
  private readonly first: number;
  private readonly substitute: PageSize;

  /** 元の供給元と範囲から作る。読めなかったページの代わりの大きさは、ここで一度だけ決める。 */
  constructor(inner: PageSource, first: number, count: number) {
    [this.inner, this.first, this.pageCount] = [inner, first, count];
    this.substitute = substituteSize(inner, first, count);
  }

  /** n 番目のページの大きさ(元の first + n 番目)。読めなかったページは、窓の中の代わりの大きさ。 */
  pageSize(index: number): PageSize {
    return this.isReadable(index) ? this.inner.pageSize(this.first + index) : this.substitute;
  }

  /** n 番目のページの大きさが読めたか(元の first + n 番目)。 */
  isReadable(index: number): boolean {
    return this.inner.isReadable(this.first + index);
  }

  /** n 番目のページを、元の first + n 番目のページとして描く。 */
  renderPage(index: number, placement: Placement, signal: AbortSignal): Promise<void> {
    return this.inner.renderPage(this.first + index, placement, signal);
  }
}

/** 窓が、元のページの範囲に収まる(first が 0 以上の整数、count が 1 以上の整数)ことを確かめる(そうでなければ RangeError)。 */
function assertWindow(source: PageSource, first: number, count: number): void {
  const integers = Number.isInteger(first) && Number.isInteger(count);
  if (!integers || first < 0 || count < 1 || first + count > source.pageCount) {
    throw new RangeError(`窓が範囲外です: first=${first}, count=${count}, 総ページ数=${source.pageCount}`);
  }
}

/**
 * 元のページ供給元の、first ページ目(0 始まり)から count ページだけを見せる供給元を作る(セグメントの範囲だけを描くために使う)。
 * 範囲が元のページの外に及ぶときは RangeError。
 */
export function windowSource(source: PageSource, first: number, count: number): PageSource {
  assertWindow(source, first, count);
  return new WindowSource(source, first, count);
}
