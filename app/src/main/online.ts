/**
 * Online bibliographic search (CrossRef + arXiv), run in the MAIN process to
 * avoid renderer CORS. Pure parsers (`parseCrossref`, `parseArxiv`) are exported
 * for unit testing; the `searchOnline` entry point does the HTTP fetch and
 * dispatches by source.
 */

import { XMLParser } from 'fast-xml-parser';
import type { OnlineResult, OnlineSource } from '@bibdesk/shared';

const UA = 'bibdesk-electron (https://bibdesk.sourceforge.io/)';

/** CrossRef work `type` → BibTeX entry type. */
const CROSSREF_TYPE: Record<string, string> = {
  'journal-article': 'article',
  'proceedings-article': 'inproceedings',
  'book-chapter': 'incollection',
  book: 'book',
  monograph: 'book',
  'edited-book': 'book',
  'reference-book': 'book',
  dissertation: 'phdthesis',
  'report': 'techreport',
  'posted-content': 'misc',
  dataset: 'misc',
};

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function first(v: unknown): string {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : '';
  return typeof v === 'string' ? v : '';
}

/** Build a normalised {@link OnlineResult} from common pieces. */
function makeResult(
  source: OnlineSource,
  entryType: string,
  parts: {
    title: string;
    authorsBib: string; // "Family, Given and …"
    authorsDisplay: string;
    year: string;
    venue?: string;
    doi?: string;
    url?: string;
    extra?: Record<string, string>;
  },
): OnlineResult {
  const fields: Record<string, string> = {};
  if (parts.authorsBib) fields.Author = parts.authorsBib;
  if (parts.title) fields.Title = parts.title;
  if (parts.year) fields.Year = parts.year;
  if (parts.venue) fields[entryType === 'article' ? 'Journal' : 'Booktitle'] = parts.venue;
  if (parts.doi) fields.Doi = parts.doi;
  if (parts.url) fields.Url = parts.url;
  for (const [k, v] of Object.entries(parts.extra ?? {})) if (v) fields[k] = v;
  return {
    source,
    entryType,
    title: parts.title,
    authorsDisplay: parts.authorsDisplay,
    year: parts.year,
    ...(parts.venue ? { venue: parts.venue } : {}),
    ...(parts.doi ? { doi: parts.doi } : {}),
    ...(parts.url ? { url: parts.url } : {}),
    fields,
  };
}

// --- CrossRef ---------------------------------------------------------------

interface CrossrefAuthor {
  family?: string;
  given?: string;
  name?: string;
}
interface CrossrefItem {
  title?: string[];
  author?: CrossrefAuthor[];
  'container-title'?: string[];
  issued?: { 'date-parts'?: number[][] };
  DOI?: string;
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  type?: string;
}

/** Parse a CrossRef `/works` JSON response into normalised results. */
export function parseCrossref(json: unknown): OnlineResult[] {
  const items = (json as { message?: { items?: CrossrefItem[] } })?.message?.items ?? [];
  return items.map((it) => {
    const entryType = CROSSREF_TYPE[it.type ?? ''] ?? 'article';
    const authors = asArray(it.author);
    const authorsBib = authors
      .map((a) => (a.family ? `${a.family}, ${a.given ?? ''}`.trim().replace(/,\s*$/, '') : a.name ?? ''))
      .filter(Boolean)
      .join(' and ');
    const authorsDisplay = authors
      .map((a) => (a.family ? `${a.given ? a.given + ' ' : ''}${a.family}` : a.name ?? ''))
      .filter(Boolean)
      .join(', ');
    const year = String(it.issued?.['date-parts']?.[0]?.[0] ?? '');
    const doi = it.DOI;
    return makeResult('crossref', entryType, {
      title: first(it.title),
      authorsBib,
      authorsDisplay,
      year,
      venue: first(it['container-title']),
      ...(doi ? { doi, url: `https://doi.org/${doi}` } : {}),
      extra: {
        Volume: it.volume ?? '',
        Number: it.issue ?? '',
        Pages: (it.page ?? '').replace('-', '--'),
        Publisher: it.publisher ?? '',
      },
    });
  });
}

async function searchCrossref(query: string): Promise<OnlineResult[]> {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=20`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`CrossRef HTTP ${res.status}`);
  return parseCrossref(await res.json());
}

// --- arXiv ------------------------------------------------------------------

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

interface ArxivAuthor {
  name?: string;
}
interface ArxivEntry {
  title?: string;
  author?: ArxivAuthor | ArxivAuthor[];
  summary?: string;
  published?: string;
  id?: string;
  'arxiv:doi'?: string;
}

/** Parse an arXiv Atom XML response into normalised results. */
export function parseArxiv(xmlText: string): OnlineResult[] {
  const doc = xml.parse(xmlText) as { feed?: { entry?: ArxivEntry | ArxivEntry[] } };
  const entries = asArray(doc.feed?.entry);
  return entries.map((e) => {
    const authors = asArray(e.author);
    const names = authors.map((a) => (a.name ?? '').trim()).filter(Boolean);
    const authorsBib = names.join(' and '); // arXiv gives "Given Family" already
    const authorsDisplay = names.join(', ');
    const year = (e.published ?? '').slice(0, 4);
    const id = (e.id ?? '').trim();
    const arxivId = id.replace(/^https?:\/\/arxiv\.org\/abs\//i, '');
    const doi = e['arxiv:doi'];
    const title = (e.title ?? '').replace(/\s+/g, ' ').trim();
    return makeResult('arxiv', 'article', {
      title,
      authorsBib,
      authorsDisplay,
      year,
      ...(doi ? { doi } : {}),
      url: id,
      extra: {
        Eprint: arxivId,
        Archiveprefix: 'arXiv',
        Abstract: (e.summary ?? '').replace(/\s+/g, ' ').trim(),
      },
    });
  });
}

async function searchArxiv(query: string): Promise<OnlineResult[]> {
  const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(
    'all:' + query,
  )}&max_results=20`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`);
  return parseArxiv(await res.text());
}

// --- dispatch ---------------------------------------------------------------

/** Search the given online source. Throws on network/HTTP error. */
export function searchOnline(source: OnlineSource, query: string): Promise<OnlineResult[]> {
  return source === 'arxiv' ? searchArxiv(query) : searchCrossref(query);
}
