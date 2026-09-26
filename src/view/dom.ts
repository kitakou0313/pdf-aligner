/** root の中から、セレクタに合う要素を 1 つ取り出す。なければ(index.html と食い違っているので)例外にする。 */
export function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`要素が見つかりません: ${selector}`);
  return element;
}
