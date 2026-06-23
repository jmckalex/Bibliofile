/**
 * Best-effort PDF text extraction for the full-text index, using pdfjs-dist's
 * legacy (no-worker) build in the main process. Always resolves (returns '' on
 * any failure — encrypted/scanned/corrupt PDFs, missing files, etc.). Capped to
 * a page limit so a huge PDF can't stall indexing.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * pdfjs warns "Ensure that the `standardFontDataUrl` API parameter is provided"
 * once per PDF that references a standard font when it can't find the bundled
 * font metrics. Point it at pdfjs-dist's `standard_fonts/` directory (which sits
 * at the package root, beside `legacy/`) so the warning never fires and font
 * metrics load. Resolved once and memoised.
 */
let standardFontDataUrl: string | undefined;
function fontDataUrl(pdfMjsPath: string): string {
  if (standardFontDataUrl === undefined) {
    // <root>/legacy/build/pdf.mjs → fonts at <root>/standard_fonts/ (trailing slash required).
    const root = dirname(dirname(dirname(pdfMjsPath)));
    standardFontDataUrl = pathToFileURL(join(root, 'standard_fonts')).href + '/';
  }
  return standardFontDataUrl;
}

/** Extract up to `maxPages` of text from a local PDF (`maxPages <= 0` = all
 * pages, for full-text indexing of long/scanned PDFs). Never throws. */
export async function extractPdfText(absPath: string, maxPages = 40): Promise<string> {
  if (!/\.pdf$/i.test(absPath)) return '';
  try {
    const pdfMjsPath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfjs: any = await import(pdfMjsPath);
    const data = new Uint8Array(readFileSync(absPath));
    const doc = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: false,
      standardFontDataUrl: fontDataUrl(pdfMjsPath),
      verbosity: 0, // errors only — silence pdfjs's per-PDF info/warning chatter
    }).promise;
    const pages = maxPages > 0 ? Math.min(doc.numPages, maxPages) : doc.numPages;
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
