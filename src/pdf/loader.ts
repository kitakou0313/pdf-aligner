import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import type { OpenedPdf } from '../core/controller.ts';
import { configurePdfjs, documentOptions } from './config.ts';
import { toOpenFailure } from './errors.ts';
import { readPageSizes } from './page-sizes.ts';
import { createPageSource, type RenderSurface } from './source.ts';
import { renderThumbnailPage } from './thumbnail-render.ts';

/** 開いた文書から、描画元(ページの大きさと、読めたかどうかは、ここで全ページ分を読む)と、閉じる処理を作る。 */
async function wrap(doc: PDFDocumentProxy, surface: RenderSurface): Promise<OpenedPdf> {
  const source = createPageSource(doc, await readPageSizes(doc), surface);
  return {
    source,
    /** 元PDFプレビュー(F11)のサムネイル描画は、最終の出力画像とは別に、直接 canvas へ描く。 */
    renderThumbnail: (index, targetWidth, canvas, signal) => renderThumbnailPage(doc, index + 1, targetWidth, canvas, signal),
    /** 作業用の canvas を手放し、pdf.js の文書と Worker を破棄する。 */
    close: () => {
      source.release();
      void doc.loadingTask.destroy();
    },
  };
}

/**
 * PDF ファイルを、pdf.js で開く。開けなかったときは、パスワード付きか、壊れている(または PDF ではない)かに
 * 分けた OpenFailure で拒否する。ページは、surface(最終の出力先)へ描かれる。
 */
export async function openPdf(file: File, surface: RenderSurface): Promise<OpenedPdf> {
  configurePdfjs();
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), ...documentOptions() });
  try {
    return await wrap(await task.promise, surface);
  } catch (error) {
    void task.destroy();
    throw toOpenFailure(error);
  }
}
