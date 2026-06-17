/**
 * EndNote importer — parses the two formats people actually export from EndNote
 * (and that journal sites / Google Scholar's "EndNote" button emit) into the
 * same BibTeX-shaped `{ entryType, fields }` records the RIS importer produces,
 * ready for the document store to add as entries:
 *
 *  - **Refer/tagged** (`.enw`): line-oriented `%X value` tags (Google Scholar's
 *    "EndNote" download). Records are separated by blank lines.
 *  - **EndNote XML** (`.xml`): the rich `<xml><records><record>…` interchange,
 *    where text nodes are commonly wrapped in `<style>` runs.
 *
 * {@link parseEndnote} sniffs which format the text is and dispatches.
 */

import { XMLParser } from 'fast-xml-parser';

import type { RisRecord } from './ris-import.js';

/** EndNote reference-type label → BibTeX entry type (used by both formats). */
const BIBTEX_TYPE: Record<string, string> = {
  'journal article': 'article',
  'electronic article': 'article',
  book: 'book',
  'edited book': 'book',
  'book section': 'incollection',
  'conference proceedings': 'inproceedings',
  'conference paper': 'inproceedings',
  thesis: 'phdthesis',
  report: 'techreport',
  manuscript: 'unpublished',
  'unpublished work': 'unpublished',
  'web page': 'misc',
  generic: 'misc',
};

function bibType(label: string): string {
  return BIBTEX_TYPE[label.trim().toLowerCase()] ?? 'misc';
}

/** Normalise a page range so a single hyphen between numbers becomes `--`. */
function normPages(v: string): string {
  return v.replace(/(\d)\s*[-–—]\s*(\d)/, '$1--$2');
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// --- Refer / tagged (.enw) --------------------------------------------------

/**
 * Parse the Refer/tagged EndNote format. Each line is `%X value`; `%A`/`%E`/`%K`
 * repeat. A record ends at a blank line (or `%0`/EOF). `%0` is the type label;
 * `%J`/`%B` map to Journal/Booktitle by entry type; `%@` is ISSN for articles,
 * else ISBN.
 */
export function parseEndnoteTagged(text: string): RisRecord[] {
  const records: RisRecord[] = [];
  let cur:
    | { typeLabel: string; authors: string[]; editors: string[]; keywords: string[]; fields: Record<string, string> }
    | null = null;

  const start = (): void => {
    cur = { typeLabel: '', authors: [], editors: [], keywords: [], fields: {} };
  };
  const flush = (): void => {
    if (!cur) return;
    const f = cur.fields;
    if (cur.authors.length) f['Author'] = cur.authors.join(' and ');
    if (cur.editors.length) f['Editor'] = cur.editors.join(' and ');
    if (cur.keywords.length) f['Keywords'] = cur.keywords.join(', ');
    if (Object.keys(f).length) records.push({ entryType: bibType(cur.typeLabel), fields: f });
    cur = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const m = rawLine.match(/^%(.)\s?(.*)$/);
    if (!m) {
      if (rawLine.trim() === '') flush(); // blank line ends a record
      continue;
    }
    const tag = m[1]!;
    const value = m[2]!.trim();
    if (tag === '0') {
      flush();
      start();
      cur!.typeLabel = value;
      continue;
    }
    if (!cur) start();
    if (!value) continue;
    const f = cur!.fields;
    switch (tag) {
      case 'A':
        cur!.authors.push(value);
        break;
      case 'E':
        cur!.editors.push(value);
        break;
      case 'K':
        // Some exporters put all keywords on one %K line, comma/semicolon-separated.
        for (const k of value.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) cur!.keywords.push(k);
        break;
      case 'T':
        f['Title'] = value;
        break;
      case 'J':
        f['Journal'] = value;
        break;
      case 'B':
        f['Booktitle'] = value;
        break;
      case 'D':
        f['Year'] = value.replace(/.*(\d{4}).*/, '$1');
        break;
      case 'V':
        f['Volume'] = value;
        break;
      case 'N':
        f['Number'] = value;
        break;
      case 'P':
        f['Pages'] = normPages(value);
        break;
      case 'I':
        f['Publisher'] = value;
        break;
      case 'C':
        f['Address'] = value;
        break;
      case 'X':
        f['Abstract'] = value;
        break;
      case 'U':
        f['Url'] = value;
        break;
      case 'R':
        f['Doi'] = value.replace(/^doi:\s*/i, '');
        break;
      case '@':
        f[/^\d{4}-\d{3}[\dxX]$/.test(value) ? 'Issn' : 'Isbn'] = value;
        break;
      case 'Z':
      case '1':
        f['Note'] = value;
        break;
      case 'G':
        f['Language'] = value;
        break;
      default:
        break;
    }
  }
  flush();
  return records;
}

// --- EndNote XML (.xml) -----------------------------------------------------

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/** Recursively extract plain text from an EndNote XML value (unwraps `<style>`). */
function xmlText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(xmlText).join(' ').trim();
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('#text' in o) return xmlText(o['#text']);
    if ('style' in o) return xmlText(o.style);
    return Object.entries(o)
      .filter(([k]) => !k.startsWith('@_'))
      .map(([, val]) => xmlText(val))
      .join(' ')
      .trim();
  }
  return '';
}

interface XmlRecord {
  'ref-type'?: { '@_name'?: string } | string;
  contributors?: {
    authors?: { author?: unknown };
    'secondary-authors'?: { author?: unknown };
  };
  titles?: { title?: unknown; 'secondary-title'?: unknown };
  periodical?: { 'full-title'?: unknown };
  dates?: { year?: unknown };
  volume?: unknown;
  number?: unknown;
  pages?: unknown;
  publisher?: unknown;
  'pub-location'?: unknown;
  keywords?: { keyword?: unknown };
  urls?: { 'related-urls'?: { url?: unknown } };
  'electronic-resource-num'?: unknown;
  isbn?: unknown;
  abstract?: unknown;
}

/** Parse EndNote XML into BibTeX-shaped records. */
export function parseEndnoteXml(text: string): RisRecord[] {
  const doc = xml.parse(text) as { xml?: { records?: { record?: XmlRecord | XmlRecord[] } } };
  const recs = asArray(doc.xml?.records?.record);
  return recs.map((r) => {
    const rt = r['ref-type'];
    const typeLabel = typeof rt === 'string' ? '' : (rt?.['@_name'] ?? '');
    const entryType = bibType(typeLabel);
    const f: Record<string, string> = {};

    const authors = asArray(r.contributors?.authors?.author).map(xmlText).filter(Boolean);
    const editors = asArray(r.contributors?.['secondary-authors']?.author).map(xmlText).filter(Boolean);
    if (authors.length) f['Author'] = authors.join(' and ');
    if (editors.length) f['Editor'] = editors.join(' and ');

    const title = xmlText(r.titles?.title);
    if (title) f['Title'] = title;
    const venue = xmlText(r.titles?.['secondary-title']) || xmlText(r.periodical?.['full-title']);
    if (venue) f[entryType === 'article' ? 'Journal' : 'Booktitle'] = venue;

    const year = xmlText(r.dates?.year).replace(/.*(\d{4}).*/, '$1');
    if (year) f['Year'] = year;
    const volume = xmlText(r.volume);
    if (volume) f['Volume'] = volume;
    const number = xmlText(r.number);
    if (number) f['Number'] = number;
    const pages = xmlText(r.pages);
    if (pages) f['Pages'] = normPages(pages);
    const publisher = xmlText(r.publisher);
    if (publisher) f['Publisher'] = publisher;
    const place = xmlText(r['pub-location']);
    if (place) f['Address'] = place;

    const keywords = asArray(r.keywords?.keyword).map(xmlText).filter(Boolean);
    if (keywords.length) f['Keywords'] = keywords.join(', ');

    const url = xmlText(r.urls?.['related-urls']?.url);
    if (url) f['Url'] = url;
    const doi = xmlText(r['electronic-resource-num']).replace(/^doi:\s*/i, '');
    if (doi) f['Doi'] = doi;
    const isbn = xmlText(r.isbn);
    if (isbn) f[/^\d{4}-\d{3}[\dxX]$/.test(isbn) ? 'Issn' : 'Isbn'] = isbn;
    const abstract = xmlText(r.abstract);
    if (abstract) f['Abstract'] = abstract;

    return { entryType, fields: f };
  });
}

/** Sniff XML vs. tagged EndNote text and parse accordingly. */
export function parseEndnote(text: string): RisRecord[] {
  return /^\s*<(\?xml|xml\b)/i.test(text) ? parseEndnoteXml(text) : parseEndnoteTagged(text);
}
