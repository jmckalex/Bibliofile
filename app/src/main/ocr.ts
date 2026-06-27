/**
 * OCR for scanned (image-only) PDFs — turns a PDF with no text layer into a
 * **searchable PDF** (the page image plus an invisible, selectable text layer),
 * the same idea as ocrmypdf but **fully bundled**: no Python, no system install.
 *
 * Stack (all permissively licensed): pdf.js (Apache) rasterizes each page via
 * `@napi-rs/canvas` (MIT); `tesseract.js` (Apache) + its WASM core OCR the page
 * image and emit a per-page searchable PDF; `pdf-lib` (MIT) stitches the pages
 * back into one document. Runs in the MAIN process; the heavy OCR runs in
 * tesseract.js's own worker thread, so the main loop stays responsive.
 *
 * Electron-free and unit-testable: callers inject the bundled asset paths (worker
 * / WASM core / `tessdata`), so this module never imports `electron`.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as Canvas from '@napi-rs/canvas';
import { createWorker, type Worker } from 'tesseract.js';
import { PDFDocument } from 'pdf-lib';

const require = createRequire(import.meta.url);

// pdf.js renders glyphs/transforms with the GLOBAL Path2D/DOMMatrix/ImageData,
// which Node lacks — point them at @napi-rs/canvas's. Safe in main (nothing else
// in the main process uses these browser globals).
(globalThis as Record<string, unknown>).Path2D ??= Canvas.Path2D;
(globalThis as Record<string, unknown>).DOMMatrix ??= Canvas.DOMMatrix;
(globalThis as Record<string, unknown>).ImageData ??= Canvas.ImageData;

/* eslint-disable @typescript-eslint/no-explicit-any */

let pdfjsPromise: Promise<any> | undefined;
let standardFontDataUrl: string | undefined;
/** Load pdf.js (legacy/no-worker build) once, and resolve its bundled font dir. */
function ensurePdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    const pdfMjs = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    standardFontDataUrl = pathToFileURL(join(dirname(dirname(dirname(pdfMjs))), 'standard_fonts')).href + '/';
    pdfjsPromise = import(pdfMjs);
  }
  return pdfjsPromise;
}

/** Bundled WASM-core directory for tesseract.js. (In Node we do NOT set a
 *  `workerPath` — tesseract.js uses its own `worker_threads` script; the browser
 *  `dist/worker.min.js` would crash with `addEventListener is not a function`.) */
export function defaultCorePath(): string {
  return dirname(require.resolve('tesseract.js-core/package.json'));
}

export interface OcrSessionOptions {
  /** Tesseract language code(s), e.g. `eng`, `fra`, `eng+fra`. Default `eng`. */
  lang?: string;
  /** Directory holding `<lang>.traineddata(.gz)`. */
  langPath: string;
  /** Bundled WASM-core directory (default: resolved from `node_modules`). */
  corePath?: string;
}

export interface OcrSession {
  /** OCR a PDF (raw bytes) → a searchable PDF (raw bytes). */
  ocrPdf(pdfBytes: Uint8Array, onPage?: (done: number, total: number) => void): Promise<Uint8Array>;
  /** Tear down the worker thread. */
  close(): Promise<void>;
}

/** Render one PDF page to a PNG buffer at the given DPI (72 = native). */
async function renderPageToPng(page: any, dpi: number): Promise<Buffer> {
  const viewport = page.getViewport({ scale: dpi / 72 });
  const w = Math.ceil(viewport.width);
  const h = Math.ceil(viewport.height);
  const canvas = Canvas.createCanvas(w, h);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
  return canvas.toBuffer('image/png');
}

/**
 * Open a reusable OCR session (creates the tesseract.js worker once — its ~0.6s
 * init is paid a single time for a whole batch). Always `close()` it.
 */
export async function createOcrSession(opts: OcrSessionOptions): Promise<OcrSession> {
  const worker: Worker = await createWorker(opts.lang ?? 'eng', 1, {
    corePath: opts.corePath ?? defaultCorePath(),
    langPath: opts.langPath,
    gzip: true,
    cacheMethod: 'none', // we manage the bundled/downloaded traineddata ourselves
  });

  const ocrPdf = async (
    pdfBytes: Uint8Array,
    onPage?: (done: number, total: number) => void,
  ): Promise<Uint8Array> => {
    const pdfjs = await ensurePdfjs();
    // slice(): pdf.js detaches the buffer; keep the caller's bytes intact.
    const doc = await pdfjs.getDocument({ data: pdfBytes.slice(), standardFontDataUrl }).promise;
    const out = await PDFDocument.create();
    onPage?.(0, doc.numPages);
    try {
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const png = await renderPageToPng(page, 200); // 200 DPI: good OCR / size balance
        page.cleanup();
        const { data } = await worker.recognize(png, {}, { pdf: true });
        // tesseract emits a one-page searchable PDF (image + invisible text); graft it on.
        const pagePdf = await PDFDocument.load(Uint8Array.from(data.pdf as number[]));
        const [copied] = await out.copyPages(pagePdf, [0]);
        out.addPage(copied);
        onPage?.(n, doc.numPages);
      }
    } finally {
      await doc.cleanup();
    }
    return out.save();
  };

  return {
    ocrPdf,
    close: async () => {
      await worker.terminate();
    },
  };
}

/**
 * Quick "is this a scan?" check: extract the text layer (capped) and report true
 * when a multi-page PDF yields almost no text — the signature of an image-only
 * (un-OCR'd) document. Never throws.
 */
export async function isLikelyScanned(pdfBytes: Uint8Array): Promise<boolean> {
  try {
    const pdfjs = await ensurePdfjs();
    const doc = await pdfjs.getDocument({ data: pdfBytes.slice(), standardFontDataUrl }).promise;
    try {
      const pages = Math.min(doc.numPages, 5);
      let chars = 0;
      for (let n = 1; n <= pages; n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        chars += content.items.reduce((s: number, it: any) => s + (it.str?.length ?? 0), 0);
        page.cleanup();
      }
      // < ~50 characters per scanned page ⇒ effectively no text layer.
      return chars < pages * 50;
    } finally {
      await doc.cleanup();
    }
  } catch {
    return false; // unreadable → don't claim it's a scan
  }
}
