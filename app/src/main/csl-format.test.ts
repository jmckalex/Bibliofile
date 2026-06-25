import { describe, it, expect } from 'vitest';
import { renderCite, renderBibliography } from './csl-format.js';

const DB: Record<string, Record<string, unknown>> = {
  smith2020: {
    id: 'smith2020',
    type: 'article-journal',
    title: 'On things',
    author: [
      { family: 'Smith', given: 'Jane' },
      { family: 'Doe', given: 'John' },
    ],
    issued: { 'date-parts': [[2020]] },
    'container-title': 'Journal of Things',
    volume: '7',
  },
  jones1999: {
    id: 'jones1999',
    type: 'book',
    title: 'A Book',
    author: [{ family: 'Jones' }, { family: 'Baker' }, { family: 'Williams' }],
    issued: { 'date-parts': [[1999]] },
    publisher: 'OUP',
  },
};
const resolve = (k: string): Record<string, unknown> | null => DB[k] ?? null;
const render = (cmd: string): string => renderCite(cmd, resolve, 'apa');
// the visible text (strip tags + decode the &amp; entity)
const text = (cmd: string): string => render(cmd).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();

describe('renderCite (inline \\cite commands)', () => {
  it('renders \\citep as parenthetical', () => {
    expect(text('\\citep{smith2020}')).toBe('(Smith & Doe, 2020)');
  });

  it('renders \\citet / bare \\cite as textual', () => {
    expect(text('\\citet{smith2020}')).toBe('Smith & Doe (2020)');
    expect(text('\\cite{smith2020}')).toBe('Smith & Doe (2020)');
  });

  it('places pre/post notes natbib-style', () => {
    expect(text('\\citep[see][p. 5]{smith2020}')).toBe('(see Smith & Doe, 2020, p. 5)');
    expect(text('\\citet[ch. 2]{jones1999}')).toBe('Jones et al. (1999, ch. 2)');
  });

  it('renders \\citeauthor (et al.) and \\citeauthor* (all)', () => {
    expect(text('\\citeauthor{jones1999}')).toBe('Jones et al.');
    expect(text('\\citeauthor*{jones1999}')).toBe('Jones, Baker, and Williams');
  });

  it('renders \\fullcite as a full reference entry, inline (no block div)', () => {
    const out = render('\\fullcite{smith2020}');
    expect(out).toContain('class="bd-icite"');
    expect(out).not.toContain('<div'); // flows inline — citeproc's block div is unwrapped
    expect(text('\\fullcite{smith2020}')).toContain('On things');
    expect(text('\\fullcite{smith2020}')).toContain('Journal of Things');
  });

  it('renders \\nocite as nothing', () => {
    expect(render('\\nocite{smith2020}')).toBe('');
  });

  it('handles multiple keys', () => {
    const t = text('\\citep{smith2020,jones1999}');
    expect(t).toContain('Smith & Doe');
    expect(t).toContain('Jones et al.');
  });

  it('marks an unknown key without throwing', () => {
    expect(render('\\citep{ghost2001}')).toContain('bd-icite--missing');
    expect(text('\\citep{ghost2001}')).toBe('?ghost2001');
  });

  it('wraps a resolved citation in a clickable data-cite span', () => {
    expect(render('\\citet{smith2020}')).toContain('data-cite="smith2020"');
  });

  it('carries ALL resolved keys on data-cite (multi-entry click selects them all)', () => {
    expect(render('\\citep{smith2020,jones1999}')).toContain('data-cite="smith2020,jones1999"');
  });
});

describe('renderBibliography (@references)', () => {
  const bib = (keys: string[]): string => renderBibliography(keys, resolve, 'apa');

  it('formats a bibliography of the cited works', () => {
    const out = bib(['smith2020', 'jones1999']);
    expect(out).toContain('bd-references');
    expect(out).toContain('On things'); // smith2020
    expect(out).toContain('A Book'); // jones1999
  });

  it('de-duplicates repeated keys', () => {
    const out = bib(['smith2020', 'smith2020']);
    expect(out.match(/On things/g)?.length).toBe(1);
  });

  it('skips unknown keys and returns empty when nothing resolves', () => {
    expect(bib(['ghost'])).toBe('');
    expect(bib([])).toBe('');
  });
});
