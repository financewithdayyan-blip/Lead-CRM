import * as pdfjsLib from 'pdfjs-dist';
// Vite bundles the worker as its own asset and gives us the built URL —
// pdf.js can't run its parsing on the main thread without this pointed
// somewhere real.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export { pdfjsLib };

/** Renders one PDF page onto a freshly created canvas at the given CSS width.
 * The backing store is sized for the device pixel ratio so text stays sharp
 * on a retina phone screen instead of looking blurry when the CSS box and
 * the canvas's own pixel buffer are the same 1:1 size. */
export async function renderPdfPageToCanvas(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  targetWidth: number,
): Promise<{ canvas: HTMLCanvasElement; widthPt: number; heightPt: number }> {
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = targetWidth / baseViewport.width;
  const viewport = page.getViewport({ scale });

  const outputScale = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const ctx = canvas.getContext('2d')!;
  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
  await page.render({ canvasContext: ctx, viewport, canvas, transform }).promise;

  return { canvas, widthPt: baseViewport.width, heightPt: baseViewport.height };
}

export async function loadPdf(url: string): Promise<pdfjsLib.PDFDocumentProxy> {
  return pdfjsLib.getDocument({ url }).promise;
}
