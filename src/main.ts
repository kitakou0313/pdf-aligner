/** アプリを root に表示する(現段階では、起動を確認するための見出しだけ)。 */
function mount(root: HTMLElement): void {
  const heading = document.createElement('h1');
  heading.textContent = 'pdf-aligner';
  root.append(heading);
}

const root = document.getElementById('app');
if (root) mount(root);
