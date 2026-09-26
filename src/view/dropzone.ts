/** ドラッグ&ドロップでファイルを受け取る領域を作る。ドロップされたファイルの一覧を onFiles に渡す。 */
export function bindDropzone(zone: HTMLElement, onFiles: (files: File[]) => void): void {
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('dragging');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('dragging');
    onFiles([...(event.dataTransfer?.files ?? [])]);
  });
}

/** 領域の外に PDF をドロップしても、ブラウザがそのファイルを開いて画面が遷移しないようにする。 */
export function blockStrayDrops(target: Document): void {
  for (const type of ['dragover', 'drop']) target.addEventListener(type, (event) => event.preventDefault());
}
