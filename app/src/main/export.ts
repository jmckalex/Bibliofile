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

// --- Templates (Handlebars) ---------------------------------------------------

/** Per-entry context exposed to user-authored export templates. */
export interface TemplateEntry {
  readonly citeKey: string;
  readonly type: string;
  /** Locally-set BibTeX fields, display-formatted; keys use canonical casing. */
  readonly fields: Record<string, string>;
  /** Author display strings (split on ` and `). */
  readonly authors: string[];
  /** Authors joined with ", ". */
  readonly authorsText: string;
  readonly title: string;
  readonly year: string;
  /** Journal, or Booktitle when there is no Journal. */
  readonly venue: string;
  readonly volume: string;
  readonly pages: string;
  readonly doi: string;
}

const BDSK_FILE_FIELD = /^bdsk-file-\d+$/i;

/** Build the Handlebars context for one entry. */
function templateEntry(item: BibItem): TemplateEntry {
  const fields: Record<string, string> = {};
  for (const name of item.fieldNames()) {
    if (BDSK_FILE_FIELD.test(name)) continue; // managed attachment blobs
    const v = disp(item, name);
    if (v) fields[name] = v;
  }
  const authors = authorList(item);
  return {
    citeKey: item.citeKey,
    type: item.type,
    fields,
    authors,
    authorsText: authors.join(', '),
    title: disp(item, 'Title'),
    year: disp(item, 'Year'),
    venue: disp(item, 'Journal') || disp(item, 'Booktitle'),
    volume: disp(item, 'Volume'),
    pages: disp(item, 'Pages'),
    doi: disp(item, 'Doi'),
  };
}

// Helpers available in every template.
Handlebars.registerHelper('join', (arr: unknown, sep: unknown) =>
  Array.isArray(arr) ? arr.join(typeof sep === 'string' ? sep : ', ') : '',
);
// Case-insensitive field lookup on the current entry: {{field "journal"}}.
Handlebars.registerHelper('field', function (this: TemplateEntry, name: unknown): string {
  if (typeof name !== 'string' || !this || !this.fields) return '';
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(this.fields)) if (k.toLowerCase() === lower) return v;
  return '';
});

/**
 * Render `items` through a user (Handlebars) template. Context is
 * `{ title, count, entries: TemplateEntry[] }`; values are auto-escaped. Throws
 * a readable `Template error: …` if the body fails to compile or render.
 */
export function renderTemplate(
  body: string,
  items: readonly BibItem[],
  data: { title?: string } = {},
): string {
  const entries = items.map(templateEntry);
  try {
    const tmpl = Handlebars.compile(body, { noEscape: false });
    return tmpl({ title: data.title ?? 'Bibliography', count: entries.length, entries });
  } catch (e) {
    throw new Error(`Template error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Built-in default HTML bibliography template (also a worked example). */
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
  .ref .venue { font-style: italic; }
  .ref .key { color: #888; font: 12px ui-monospace, monospace; }
  .count { color: #888; }
</style>
</head>
<body>
<h1>{{title}} <span class="count">({{count}})</span></h1>
{{#each entries}}
<p class="ref">
  {{#if authorsText}}<span class="authors">{{authorsText}}</span> {{/if}}
  {{#if year}}({{year}}). {{/if}}
  {{#if title}}<span class="title">{{title}}</span>. {{/if}}
  {{#if venue}}<span class="venue">{{venue}}</span>{{#if volume}}, {{volume}}{{/if}}{{#if pages}}, {{pages}}{{/if}}. {{/if}}
  {{#if doi}}<a href="https://doi.org/{{doi}}">https://doi.org/{{doi}}</a> {{/if}}
  <span class="key">[{{citeKey}}]</span>
</p>
{{/each}}
</body>
</html>
`;

/** Render items to a styled, self-contained HTML bibliography (built-in template). */
export function exportHtml(items: readonly BibItem[], title = 'Bibliography'): string {
  return renderTemplate(HTML_TEMPLATE, items, { title });
}
