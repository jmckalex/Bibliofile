/**
 * OCR must not be able to stop the app launching.
 *
 * 0.12.0 crashed before a window opened because a dependency of tesseract.js was
 * missing from the bundle, and the main bundle loaded the OCR stack at startup.
 * ocr.ts statically imports tesseract.js, pdf-lib and @napi-rs/canvas, which ship
 * as real node_modules. So only ocr.ts may import them, and index.ts may load
 * ocr.ts only lazily (`import('./ocr.js')`). Then a packaging slip costs OCR, not
 * the app.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const MAIN_DIR = fileURLToPath(new URL('./', import.meta.url));
const OCR_STACK = ['tesseract.js', 'pdf-lib', '@napi-rs/canvas'];
const sources = readdirSync(MAIN_DIR)
  .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(join(MAIN_DIR, f), 'utf8') }));

/** Static (value) imports of `spec`: `import … from 'spec'`, not `import type`, not `import()`. */
const staticImport = (spec: string): RegExp =>
  new RegExp(`^import\\s+(?!type\\b)[^;]*?from\\s+'${spec.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}';`, 'm');

describe('the OCR stack loads only when OCR runs', () => {
  it('only ocr.ts imports tesseract.js, pdf-lib or @napi-rs/canvas', () => {
    for (const pkg of OCR_STACK) {
      const importers = sources.filter((s) => staticImport(pkg).test(s.text)).map((s) => s.file);
      expect(importers, pkg).toEqual(['ocr.ts']);
    }
  });

  it('no main module imports ocr.js statically; index.ts loads it with import()', () => {
    const staticOcr = sources.filter((s) => staticImport('./ocr.js').test(s.text)).map((s) => s.file);
    expect(staticOcr).toEqual([]);
    const index = sources.find((s) => s.file === 'index.ts')!.text;
    expect(index).toMatch(/import\('\.\/ocr\.js'\)/);
  });

  // The built bundle is what launches, so check it too when a build is present
  // (`pnpm build:app && pnpm test`, as in CI).
  const builtIndex = fileURLToPath(new URL('../../out/main/index.js', import.meta.url));
  it.runIf(existsSync(builtIndex))('the built main bundle does not load the OCR stack', () => {
    const bundle = readFileSync(builtIndex, 'utf8');
    for (const pkg of OCR_STACK) {
      expect(bundle, pkg).not.toMatch(new RegExp(`(from|import\\(|require\\()\\s*"${pkg.replace(/[.\\/]/g, '\\$&')}"`));
    }
    expect(bundle).toMatch(/import\("\.\/chunks\/ocr-[\w-]+\.js"\)/);
  });
});

describe('PDF text extraction does not depend on the OCR module', () => {
  // ocr.ts installs global Path2D/DOMMatrix/ImageData for pdf.js rendering. While it
  // loaded at startup, main-thread extraction (drop-a-PDF import) always ran after
  // that. This file never imports ocr.ts, as the indexing worker never has.
  it('extracts text from a real PDF', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    page.drawText('Bibliofile lazy OCR check', { font: await doc.embedFont(StandardFonts.Helvetica), x: 50, y: 700 });
    const path = join(mkdtempSync(join(tmpdir(), 'bd-pdftext-')), 'text.pdf');
    writeFileSync(path, await doc.save());

    const { extractPdfText } = await import('./pdf-text.js');
    expect(await extractPdfText(path)).toContain('Bibliofile lazy OCR check');
    expect(sources.some((s) => s.file === 'pdf-text.ts' && staticImport('./ocr.js').test(s.text))).toBe(false);
  });
});
