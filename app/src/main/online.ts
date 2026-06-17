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

// --- DOI (CrossRef single work) ---------------------------------------------

/** Look up one DOI via CrossRef `/works/{doi}` (accepts a bare DOI or a doi.org URL). */
async function searchDoi(query: string): Promise<OnlineResult[]> {
  const doi = query.trim().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)/i, '');
  if (!doi) return [];
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`DOI lookup HTTP ${res.status}`);
  const json = (await res.json()) as { message?: CrossrefItem };
  // Reuse the list parser by wrapping the single work as a one-item message.
  return json.message ? parseCrossref({ message: { items: [json.message] } }) : [];
}

// --- OpenAlex ---------------------------------------------------------------

const OPENALEX_TYPE: Record<string, string> = {
  article: 'article',
  'journal-article': 'article',
  'proceedings-article': 'inproceedings',
  'book-chapter': 'incollection',
  book: 'book',
  monograph: 'book',
  dissertation: 'phdthesis',
  report: 'techreport',
  dataset: 'misc',
  preprint: 'article',
};

interface OpenAlexWork {
  title?: string;
  display_name?: string;
  publication_year?: number;
  type?: string;
  doi?: string;
  authorships?: { author?: { display_name?: string }; raw_author_name?: string }[];
  primary_location?: { source?: { display_name?: string } };
  biblio?: { volume?: string; issue?: string; first_page?: string; last_page?: string };
}

/** Parse an OpenAlex `/works` JSON response into normalised results. */
export function parseOpenAlex(json: unknown): OnlineResult[] {
  const works = (json as { results?: OpenAlexWork[] })?.results ?? [];
  return works.map((w) => {
    const names = asArray(w.authorships)
      .map((a) => a.author?.display_name ?? a.raw_author_name ?? '')
      .filter(Boolean);
    const doi = (w.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '');
    const b = w.biblio ?? {};
    const pages = b.first_page ? (b.last_page ? `${b.first_page}--${b.last_page}` : b.first_page) : '';
    return makeResult('openalex', OPENALEX_TYPE[w.type ?? ''] ?? 'article', {
      title: w.title ?? w.display_name ?? '',
      authorsBib: names.join(' and '), // OpenAlex gives "Given Family"; our parser handles it
      authorsDisplay: names.join(', '),
      year: String(w.publication_year ?? ''),
      venue: w.primary_location?.source?.display_name ?? '',
      ...(doi ? { doi, url: `https://doi.org/${doi}` } : {}),
      extra: { Volume: b.volume ?? '', Number: b.issue ?? '', Pages: pages },
    });
  });
}

async function searchOpenAlex(query: string): Promise<OnlineResult[]> {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=20`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);
  return parseOpenAlex(await res.json());
}

// --- ISBN (Open Library) ----------------------------------------------------

/** Parse an Open Library `jscmd=data` response for one ISBN into a book result. */
export function parseOpenLibrary(json: unknown, isbn: string): OnlineResult[] {
  const book = (json as Record<string, OpenLibraryBook>)[`ISBN:${isbn}`];
  if (!book) return [];
  const authors = asArray(book.authors)
    .map((a) => a.name ?? '')
    .filter(Boolean);
  return [
    makeResult('isbn', 'book', {
      title: book.title ?? '',
      authorsBib: authors.join(' and '),
      authorsDisplay: authors.join(', '),
      year: (book.publish_date ?? '').match(/\d{4}/)?.[0] ?? '',
      extra: {
        Publisher: asArray(book.publishers).map((p) => p.name ?? '').filter(Boolean).join(', '),
        Address: asArray(book.publish_places).map((p) => p.name ?? '').filter(Boolean).join(', '),
        Isbn: isbn,
        ...(book.url ? { Url: book.url } : {}),
      },
    }),
  ];
}

interface OpenLibraryBook {
  title?: string;
  authors?: { name?: string }[];
  publishers?: { name?: string }[];
  publish_places?: { name?: string }[];
  publish_date?: string;
  url?: string;
}

async function searchIsbn(query: string): Promise<OnlineResult[]> {
  const isbn = query.replace(/[^0-9Xx]/g, '');
  if (!isbn) return [];
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Open Library HTTP ${res.status}`);
  return parseOpenLibrary(await res.json(), isbn);
}

// --- PubMed (NCBI E-utilities) ----------------------------------------------

interface PubmedArticle {
  MedlineCitation?: {
    PMID?: string | { '#text'?: string };
    Article?: {
      ArticleTitle?: string;
      Abstract?: { AbstractText?: unknown };
      AuthorList?: { Author?: PubmedAuthor | PubmedAuthor[] };
      Journal?: {
        Title?: string;
        JournalIssue?: { Volume?: string; Issue?: string; PubDate?: { Year?: string; MedlineDate?: string } };
      };
      Pagination?: { MedlinePgn?: string };
      ELocationID?: unknown;
    };
  };
}
interface PubmedAuthor {
  LastName?: string;
  ForeName?: string;
  Initials?: string;
  CollectiveName?: string;
}

/** Parse a PubMed efetch XML response into normalised results. */
export function parsePubmed(xmlText: string): OnlineResult[] {
  const doc = xml.parse(xmlText) as { PubmedArticleSet?: { PubmedArticle?: PubmedArticle | PubmedArticle[] } };
  const articles = asArray(doc.PubmedArticleSet?.PubmedArticle);
  return articles.map((a) => {
    const art = a.MedlineCitation?.Article;
    const authors = asArray(art?.AuthorList?.Author).map((au) =>
      au.CollectiveName
        ? au.CollectiveName
        : au.LastName
          ? `${au.LastName}, ${au.ForeName ?? au.Initials ?? ''}`.trim().replace(/,\s*$/, '')
          : '',
    );
    const names = authors.filter(Boolean);
    const issue = art?.Journal?.JournalIssue;
    const year = issue?.PubDate?.Year ?? (issue?.PubDate?.MedlineDate ?? '').match(/\d{4}/)?.[0] ?? '';
    // ELocationID may carry the DOI (with an EIdType attribute).
    const doi = asArray(art?.ELocationID as unknown[])
      .map((e) => (typeof e === 'object' && e ? ((e as Record<string, unknown>)['@_EIdType'] === 'doi' ? String((e as Record<string, unknown>)['#text'] ?? '') : '') : ''))
      .find(Boolean);
    const pmidRaw = a.MedlineCitation?.PMID;
    const pmid = typeof pmidRaw === 'object' ? (pmidRaw?.['#text'] ?? '') : (pmidRaw ?? '');
    const abstractText = art?.Abstract?.AbstractText;
    const abstract = Array.isArray(abstractText)
      ? abstractText.map((t) => (typeof t === 'object' && t ? String((t as Record<string, unknown>)['#text'] ?? '') : String(t))).join(' ')
      : typeof abstractText === 'object' && abstractText
        ? String((abstractText as Record<string, unknown>)['#text'] ?? '')
        : String(abstractText ?? '');
    return makeResult('pubmed', 'article', {
      title: String(art?.ArticleTitle ?? '').replace(/\s+/g, ' ').trim(),
      authorsBib: names.join(' and '),
      authorsDisplay: names.join(', '),
      year: String(year),
      venue: art?.Journal?.Title ?? '',
      ...(doi ? { doi } : {}),
      extra: {
        Volume: issue?.Volume ?? '',
        Number: issue?.Issue ?? '',
        Pages: (art?.Pagination?.MedlinePgn ?? '').replace('-', '--'),
        ...(pmid ? { Pmid: String(pmid) } : {}),
        ...(abstract ? { Abstract: abstract } : {}),
      },
    });
  });
}

async function searchPubmed(query: string): Promise<OnlineResult[]> {
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  const esearch = await fetch(
    `${base}/esearch.fcgi?db=pubmed&retmode=json&retmax=20&term=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': UA } },
  );
  if (!esearch.ok) throw new Error(`PubMed esearch HTTP ${esearch.status}`);
  const ids = ((await esearch.json()) as { esearchresult?: { idlist?: string[] } }).esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];
  const efetch = await fetch(`${base}/efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(',')}`, {
    headers: { 'User-Agent': UA },
  });
  if (!efetch.ok) throw new Error(`PubMed efetch HTTP ${efetch.status}`);
  return parsePubmed(await efetch.text());
}

// --- dispatch ---------------------------------------------------------------

/** Search the given online source. Throws on network/HTTP error. */
export function searchOnline(source: OnlineSource, query: string): Promise<OnlineResult[]> {
  switch (source) {
    case 'arxiv':
      return searchArxiv(query);
    case 'openalex':
      return searchOpenAlex(query);
    case 'doi':
      return searchDoi(query);
    case 'isbn':
      return searchIsbn(query);
    case 'pubmed':
      return searchPubmed(query);
    case 'crossref':
    default:
      return searchCrossref(query);
  }
}
