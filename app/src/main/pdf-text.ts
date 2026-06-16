/**
 * Best-effort PDF text extraction for the full-text index, using pdfjs-dist's
 * legacy (no-worker) build in the main process. Always resolves (returns '' on
 * any failure — encrypted/scanned/corrupt PDFs, missing files, etc.). Capped to
 * a page limit so a huge PDF can't stall indexing.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Extract up to `maxPages` of text from a local PDF. Never throws. */
export async function extractPdfText(absPath: string, maxPages = 40): Promise<string> {
  if (!/\.pdf$/i.test(absPath)) return '';
  try {
    const pdfjs: any = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
    const data = new Uint8Array(readFileSync(absPath));
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false })
      .promise;
    const pages = Math.min(doc.numPages, maxPages);
    let text = '';
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map((i: any) => (typeof i.str === 'string' ? i.str : '')).join(' ') + '\n';
    }
    await doc.destroy?.();
    return text;
  } catch {
    return '';
  }
}
