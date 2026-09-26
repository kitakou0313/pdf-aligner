import type { StatusLine } from '../core/state.ts';

/** メッセージ 1 行の要素を作る(文言は、HTML ではなくテキストとして入れる)。 */
function lineElement(line: StatusLine): HTMLElement {
  const element = document.createElement('p');
  element.className = `line ${line.kind}`;
  element.textContent = line.text;
  return element;
}

/** ステータス行の内容を、メッセージの行に置き換える。 */
export function renderStatus(container: HTMLElement, lines: readonly StatusLine[]): void {
  container.replaceChildren(...lines.map(lineElement));
}
