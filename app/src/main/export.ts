/**
 * Export a set of {@link BibItem}s to non-BibTeX formats: **RIS** (tagged, for
 * EndNote/Zotero/Mendeley), **CSV** (spreadsheet), and **HTML** (a styled
 * bibliography rendered with Handlebars — the chosen template engine). BibTeX
 * export stays in the serializer; this module covers the interchange formats.
 *
 * All values are de-TeXified for display (these formats are not LaTeX), and HTML
 * is escaped by Handlebars. Field access inherits from the crossref parent.
 */

import Handlebars from 'handlebars';
import type { BibItem } from '@bibdesk/model';
import { detexify } from '@bibdesk/tex';

/** De-TeXify a field value and strip the outer protective braces for display. */
function disp(item: BibItem, field: string): string {
  const raw = item.stringValueOfField(field, true);
  if (!raw) return '';
  return detexify(raw).replace(/[{}]/g, '').trim();
}

/** Authors as a list of display strings (split on BibTeX ` and `). */
function authorList(item: BibItem, field = 'Author'): string[] {
  const raw = disp(item, field);
  if (!raw) return [];
  return raw
    .split(/\s+and\s+/i)
    .map((a) => a.trim())
    .filter(Boolean);
}

// --- RIS ---------------------------------------------------------------------

/** BibTeX entry type → RIS reference type (TY). */
const RIS_TYPE: Record<string, string> = {
  article: 'JOUR',
  book: 'BOOK',
  inbook: 'CHAP',
  incollection: 'CHAP',
  inproceedings: 'CPAPER',
  conference: 'CPAPER',
  proceedings: 'CONF',
  phdthesis: 'THES',
  mastersthesis: 'THES',
  techreport: 'RPRT',
  manual: 'GEN',
  unpublished: 'UNPB',
  misc: 'GEN',
  booklet: 'GEN',
};

/** Serialize items to RIS. One record per entry, terminated by `ER`. */
export function exportRis(items: readonly BibItem[]): string {
  const lines: string[] = [];
  const tag = (t: string, v: string): void => {
    if (v) lines.push(`${t}  - ${v}`);
  };
  for (const item of items) {
    lines.push(`TY  - ${RIS_TYPE[item.type.toLowerCase()] ?? 'GEN'}`);
    for (const a of authorList(item)) tag('AU', a);
    for (const e of authorList(item, 'Editor')) tag('A2', e);
    tag('TI', disp(item, 'Title'));
    tag('T2', disp(item, 'Journal') || disp(item, 'Booktitle'));
    tag('PY', disp(item, 'Year'));
    tag('VL', disp(item, 'Volume'));
    tag('IS', disp(item, 'Number'));
    const pages = disp(item, 'Pages').replace(/\s/g, '');
    const m = pages.match(/^(\d+)\D+(\d+)$/);
    if (m) {
      tag('SP', m[1]!);
      tag('EP', m[2]!);
    } else if (pages) {
      tag('SP', pages);
    }
    tag('PB', disp(item, 'Publisher'));
    tag('CY', disp(item, 'Address'));
    tag('SN', disp(item, 'Isbn') || disp(item, 'Issn'));
    tag('DO', disp(item, 'Doi'));
    tag('UR', disp(item, 'Url'));
    tag('AB', disp(item, 'Abstract'));
    for (const kw of disp(item, 'Keywords').split(/[,;]/).map((k) => k.trim()).filter(Boolean))
      tag('KW', kw);
    tag('ID', item.citeKey);
    lines.push('ER  - ');
    lines.push('');
  }
  return lines.join('\n');
}

// --- CSV ----------------------------------------------------------------------

const CSV_COLUMNS = ['Cite Key', 'Type', 'Authors', 'Title', 'Year', 'Journal', 'Volume', 'Pages', 'Publisher', 'DOI'];

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize items to CSV (a fixed set of common columns). */
export function exportCsv(items: readonly BibItem[]): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const item of items) {
    const cells = [
      item.citeKey,
      item.type,
      authorList(item).join('; '),
      disp(item, 'Title'),
      disp(item, 'Year'),
      disp(item, 'Journal') || disp(item, 'Booktitle'),
      disp(item, 'Volume'),
      disp(item, 'Pages'),
      disp(item, 'Publisher'),
      disp(item, 'Doi'),
    ];
    rows.push(cells.map(csvCell).join(','));
  }
  return rows.join('\n') + '\n';
}

// --- HTML (Handlebars) --------------------------------------------------------

/**
 * Default HTML export template. A self-contained document listing each entry as
 * a typographic reference. Handlebars escapes all interpolated values.
 */
const HTML_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{{title}}</title>
<style>
  body { font: 15px/1.5 -apple-system, system-ui, "Segoe UI", sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  .ref { margin: 0 0 1rem; padding-left: 2rem; text-indent: -2rem; }
  .ref .authors { font-weight: 600; }
  .ref .title { }
  .ref .venue { font-style: italic; }
  .ref .key { color: #888; font: 12px ui-monospace, monospace; }
  .count { color: #888; }
</style>
</head>
<body>
<h1>{{title}} <span class="count">({{entries.length}})</span></h1>
{{#each entries}}
<p class="ref">
  {{#if authors}}<span class="authors">{{authors}}</span> {{/if}}
  {{#if year}}({{year}}). {{/if}}
  {{#if titleText}}<span class="title">{{titleText}}</span>. {{/if}}
  {{#if venue}}<span class="venue">{{venue}}</span>{{#if volume}}, {{volume}}{{/if}}{{#if pages}}, {{pages}}{{/if}}. {{/if}}
  {{#if doi}}<a href="https://doi.org/{{doi}}">https://doi.org/{{doi}}</a> {{/if}}
  <span class="key">[{{citeKey}}]</span>
</p>
{{/each}}
</body>
</html>
`;

const renderHtml = Handlebars.compile(HTML_TEMPLATE, { noEscape: false });

/** Render items to a styled, self-contained HTML bibliography via Handlebars. */
export function exportHtml(items: readonly BibItem[], title = 'Bibliography'): string {
  const entries = items.map((item) => ({
    citeKey: item.citeKey,
    authors: authorList(item).join(', '),
    year: disp(item, 'Year'),
    titleText: disp(item, 'Title'),
    venue: disp(item, 'Journal') || disp(item, 'Booktitle'),
    volume: disp(item, 'Volume'),
    pages: disp(item, 'Pages'),
    doi: disp(item, 'Doi'),
  }));
  return renderHtml({ title, entries });
}
