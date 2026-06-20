/**
 * Lazy PDF.js integration for the LaTeX-preview pane.
 *
 * Mirrors the MathJax lazy-load (`mathjax.ts`): the heavy `pdfjs-dist` library is
 * pulled in via a dynamic `import()` only on first use, so it doesn't weigh down
 * the initial renderer bundle. The worker is bundled by Vite via `?url` (no CDN),
 * matching how `mathjax.ts` resolves its offline bundle.
 */

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

type PdfjsModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfjsModule> | undefined;

/** Load pdfjs-dist once and point it at the bundled worker. */
function ensurePdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/**
 * Render every page of a PDF (raw bytes) to its own canvas, sized for the
 * device pixel ratio so text stays crisp. The caller appends the canvases to the
 * DOM and is responsible for clearing them when the source changes.
 */
export async function renderPdfToCanvases(
  bytes: Uint8Array,
  opts: { scale?: number } = {},
): Promise<HTMLCanvasElement[]> {
  const pdfjs = await ensurePdfjs();
  const dpr = window.devicePixelRatio || 1;
  const scale = (opts.scale ?? 1.3) * dpr;
  // getDocument transfers (detaches) the buffer to the worker; hand it a copy so
  // the store's pdfBytes survive a re-render.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    const canvases: HTMLCanvasElement[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${Math.ceil(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.ceil(viewport.height / dpr)}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
      canvases.push(canvas);
    }
    return canvases;
  } finally {
    await doc.destroy();
  }
}
