/**
 * Canonical field-name casing.
 *
 * The model stores field names in canonical Capitalized form (source of truth)
 * and looks them up case-insensitively. On serialize, BibDesk lower-cases every
 * field name (`BibItem.m:1823`), so the stored casing only affects internal
 * lookups (which are all case-insensitive anyway). We still canonicalize to a
 * tidy, deterministic Capitalized-hyphenated form (`local-url` → `Local-Url`,
 * `date-added` → `Date-Added`, `bdsk-file-1` → `Bdsk-File-1`) so the in-memory
 * model is clean and matches the casing used elsewhere in `@bibdesk/model`.
 *
 * A short table covers the well-known BibDesk fields verbatim; everything else
 * falls back to the generic hyphen/space-word capitalizer.
 */

/** Well-known fields whose canonical casing is fixed by BibDesk constants. */
const KNOWN: Record<string, string> = {
  author: 'Author',
  editor: 'Editor',
  title: 'Title',
  booktitle: 'Booktitle',
  journal: 'Journal',
  year: 'Year',
  month: 'Month',
  volume: 'Volume',
  number: 'Number',
  pages: 'Pages',
  publisher: 'Publisher',
  address: 'Address',
  edition: 'Edition',
  series: 'Series',
  chapter: 'Chapter',
  crossref: 'Crossref',
  keywords: 'Keywords',
  note: 'Note',
  annote: 'Annote',
  abstract: 'Abstract',
  doi: 'Doi',
  url: 'Url',
  isbn: 'Isbn',
  issn: 'Issn',
  eprint: 'Eprint',
  read: 'Read',
  rating: 'Rating',
  'local-url': 'Local-Url',
  'date-added': 'Date-Added',
  'date-modified': 'Date-Modified',
  'citeseerurl': 'Citeseerurl',
  'cited-by': 'Cited-By',
  'cites': 'Cites',
  'rss-description': 'Rss-Description',
  'bdsk-color': 'Bdsk-Color',
};

/** Capitalize the first letter, lower-case the rest, of one word. */
function capWord(w: string): string {
  if (w.length === 0) return w;
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

/**
 * Canonicalize a parsed field name to its BibDesk-canonical casing. Known
 * fields use the fixed table; others are capitalized per hyphen/space-separated
 * word (so `bdsk-file-1` → `Bdsk-File-1`, `Item Number` → `Item Number`).
 */
export function canonicalFieldName(name: string): string {
  const lower = name.toLowerCase();
  const known = KNOWN[lower];
  if (known) return known;
  // generic: capitalize each hyphen- and space-separated word
  return lower
    .split(/(\s+|-)/)
    .map((part) => (part === '-' || /^\s+$/.test(part) ? part : capWord(part)))
    .join('');
}
