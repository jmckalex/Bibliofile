import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { findTexBin, renderTexPreview, renderTexPreviewSvg } from './tex-preview';

// These tests run the real pdflatex/bibtex pipeline when a TeX install is
// present, and are skipped otherwise (e.g. in CI without TeX).
const hasTex = !!findTexBin('pdflatex') && !!findTexBin('bibtex');
// The SVG path additionally needs `latex` + `dvisvgm` (the DVI→SVG toolchain).
const hasDvisvgm = !!findTexBin('latex') && !!findTexBin('bibtex') && !!findTexBin('dvisvgm');

describe('findTexBin', () => {
  it('returns undefined for a binary that does not exist anywhere', () => {
    expect(findTexBin('definitely-not-a-real-tex-binary-xyz')).toBeUndefined();
  });

  it.runIf(hasTex)('locates pdflatex when TeX is installed', () => {
    const p = findTexBin('pdflatex');
    expect(p).toBeTruthy();
    expect(/pdflatex(\.exe)?$/.test(p!)).toBe(true);
  });
});

describe('renderTexPreview', () => {
  it.runIf(hasTex)(
    'typesets a small library into a PDF',
    async () => {
      const bib =
        '@article{a2020, author = {Smith, Jane}, title = {On Things}, ' +
        'journal = {Journal of Things}, year = {2020}, volume = {1}, pages = {1--9} }\n';
      const res = await renderTexPreview({ bibText: bib, bstStyle: 'plain' });
      expect(res.error).toBeUndefined();
      expect(res.pdfPath).toBeTruthy();
      expect(existsSync(res.pdfPath!)).toBe(true);
    },
    60_000,
  );

  it.runIf(hasTex)(
    'reports a compile error for a bogus .bst style',
    async () => {
      const bib = '@misc{x, title = {x}, year = {2020} }\n';
      const res = await renderTexPreview({ bibText: bib, bstStyle: 'no-such-style-zzz' });
      expect(res.pdfPath).toBeUndefined();
      expect(res.error).toMatch(/compile failed|\.bst/i);
    },
    60_000,
  );
});

describe('renderTexPreviewSvg', () => {
  it.runIf(hasDvisvgm)(
    'typesets a selection into inline SVG page(s)',
    async () => {
      const bib =
        '@article{a2020, author = {Smith, Jane}, title = {On Things}, ' +
        'journal = {Journal of Things}, year = {2020}, volume = {1}, pages = {1--9} }\n';
      const res = await renderTexPreviewSvg({
        bibText: bib,
        citeKeys: ['a2020'],
        bstStyle: 'plain',
      });
      expect(res.error).toBeUndefined();
      expect(res.svgs?.length).toBeGreaterThan(0);
      expect(res.svgs![0]).toContain('<svg');
    },
    60_000,
  );
});
