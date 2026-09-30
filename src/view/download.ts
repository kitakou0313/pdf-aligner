// 生成した URL を無効にするまでの待ち時間(ダウンロードの開始を妨げないため、少し置く)
const REVOKE_DELAY_MS = 10_000;

/** canvas を PNG の Blob にする。生成できなかったとき(巨大すぎるなど)は null。 */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** 切り出した PDF のバイト列を、指定したファイル名でダウンロードさせる。 */
export function savePdfBytes(data: Uint8Array, fileName: string): void {
  saveBlob(new Blob([data as BlobPart], { type: 'application/pdf' }), fileName);
}

/** Blob を、指定したファイル名でダウンロードさせる(一時的な URL を作ってリンクを押し、後で URL を無効にする)。 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
