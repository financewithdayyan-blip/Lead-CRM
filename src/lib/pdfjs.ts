import * as pdfjsLib from 'pdfjs-dist';
// Vite bundles the worker as its own asset and gives us the built URL —
// pdf.js can't run its parsing on the main thread without this pointed
// somewhere real.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export { pdfjsLib };

/** Renders one PDF page onto a freshly created canvas at the given CSS width. */
export async function renderPdfPageToCanvas(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  targetWidth: number,
): Promise<{ canvas: HTMLCanvasElement; widthPt: number; heightPt: number }> {
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = targetWidth / baseViewport.width;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

  return { canvas, widthPt: baseViewport.width, heightPt: baseViewport.height };
}

export async function loadPdf(url: string): Promise<pdfjsLib.PDFDocumentProxy> {
  return pdfjsLib.getDocument({ url }).promise;
}
