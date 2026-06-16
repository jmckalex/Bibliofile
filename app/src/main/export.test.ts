/**
 * Export-format tests — RIS / CSV / HTML over a small parsed library.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@bibdesk/bibtex';
import { exportRis, exportCsv, exportHtml } from './export.js';

const BIB = [
  '@article{euler1748,',
  '  Author = {Leonhard Euler and Daniel Bernoulli},',
  '  Title = {On the sums of series of reciprocals},',
  '  Journal = {Comm. Acad. Sci.},',
  '  Year = {1748}, Volume = {7}, Pages = {123--134}, Doi = {10.1000/euler},',
  '  Keywords = {analysis, series}}',
  '@book{gauss1801, Author = {C. F. Gauss}, Title = {Disquisitiones}, Year = {1801}, Publisher = {Fleischer}}',
].join('\n');

const items = parse(BIB).items;

describe('exportRis', () => {
  it('emits a TY/ER-delimited record with mapped tags', () => {
    const ris = exportRis(items);
    expect(ris).toContain('TY  - JOUR');
    expect(ris).toContain('AU  - Leonhard Euler');
    expect(ris).toContain('AU  - Daniel Bernoulli');
    expect(ris).toContain('TI  - On the sums of series of reciprocals');
    expect(ris).toContain('PY  - 1748');
    expect(ris).toContain('SP  - 123');
    expect(ris).toContain('EP  - 134');
    expect(ris).toContain('DO  - 10.1000/euler');
    expect(ris).toContain('KW  - analysis');
    expect(ris).toContain('ER  - ');
    expect(ris).toContain('TY  - BOOK'); // the @book entry
  });
});

describe('exportCsv', () => {
  it('emits a header + one row per entry', () => {
    const csv = exportCsv(items);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('Cite Key,Type,Authors,Title');
    expect(lines).toHaveLength(3); // header + 2 entries
    expect(csv).toContain('euler1748');
    expect(csv).toContain('Leonhard Euler; Daniel Bernoulli');
    expect(csv).toContain('123--134'); // pages have no comma → unquoted
  });

  it('quotes cells containing commas', () => {
    const tricky = parse('@misc{x, Title = {Widgets, gadgets and gizmos}, Year = {2020}}').items;
    const csv = exportCsv(tricky);
    expect(csv).toContain('"Widgets, gadgets and gizmos"');
  });
});

describe('exportHtml', () => {
  it('renders a self-contained HTML bibliography (Handlebars)', () => {
    const html = exportHtml(items, 'My Refs');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>My Refs</title>');
    expect(html).toContain('On the sums of series of reciprocals');
    expect(html).toContain('Leonhard Euler, Daniel Bernoulli');
    expect(html).toContain('[euler1748]');
    expect(html).toContain('https://doi.org/10.1000/euler');
  });

  it('escapes HTML in field values', () => {
    const tricky = parse('@misc{x, Title = {A & B <tag>}, Year = {2020}}').items;
    const html = exportHtml(tricky);
    expect(html).toContain('A &amp; B &lt;tag&gt;');
    expect(html).not.toContain('<tag>');
  });
});
