/**
 * Open-access PDF locator — find a legal OA PDF for a library entry and report a
 * URL the caller can download + attach. Runs in the MAIN process (no renderer
 * CORS). The matching/scoring helpers are **pure and exported** for unit testing;
 * the orchestrator `locateOa` takes its two network calls as injectable deps so it
 * too can be tested headless.
 *
 * Engine:
 *   - **Unpaywall** (`/v2/{doi}?email=…`) — free, ~100k DOIs/day — turns a DOI into
 *     a direct OA PDF URL. Requires a contact email ({@link setContactEmail}).
 *   - **Crossref** (`query.bibliographic`) — resolves a best-match DOI for entries
 *     that have only a title/author/year, then that DOI goes to Unpaywall.
 * (OpenAlex was the original engine but its free tier became a tiny credit quota —
 * unusable for bulk lookup.)
 *
 * Acquisition only: this finds and downloads the file. Reading it is another app's
 * job.
 */

const UA = 'Bibliofile (bibliography manager)';

// --- pure helpers (exported for tests) --------------------------------------

/** Lower-case, de-TeX, strip diacritics + punctuation → bag-of-words basis. */
export function normalizeTitle(s: string): string {
  return s
    .replace(/\$[^$]*\$/g, ' ') // inline math
    .replace(/\\[a-zA-Z]+/g, ' ') // \word commands → word boundary
    .replace(/\\[^a-zA-Z]/g, '') // \" \' \^ \~ … accents → drop, keep the base letter
    .replace(/[{}]/g, '') // braces → drop (no space) so {\"o}del glues into "odel"
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTokens(s: string): Set<string> {
  return new Set(normalizeTitle(s).split(' ').filter(Boolean));
}

/** Jaccard token overlap of two titles, 0..1 (1 = identical word sets). */
export function titleSimilarity(a: string, b: string): number {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** First author's surname from a BibTeX `author` field, for match scoring. */
export function firstAuthorSurname(authorField: string): string {
  const firstPerson = (authorField.split(/\s+and\s+/i)[0] ?? '').trim();
  if (!firstPerson) return '';
  if (firstPerson.includes(',')) return firstPerson.split(',')[0]!.trim(); // "Last, First"
  const parts = firstPerson.split(/\s+/); // "First Last"
  return parts[parts.length - 1] ?? '';
}

/** True if a buffer's first bytes are the `%PDF-` signature. */
export function looksLikePdf(buf: Uint8Array): boolean {
  return buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d;
}

/** A bibliographic record to score against the entry we're looking up (e.g. a
 *  Crossref hit), carrying the DOI we'd then resolve to a PDF. */
export interface Candidate {
  doi?: string;
  title: string;
  year?: number;
  authors?: string[]; // display names ("Given Family")
}

export interface MatchScore {
  /** Title similarity (0..1), the headline number shown to the user. */
  score: number;
  /** Confident enough to attach without asking. */
  confident: boolean;
  /** Above the floor for showing as a "possible match" (vs. discarding). */
  plausible: boolean;
}

/** Score a bibliographic candidate against the entry we're looking up. */
export function scoreCandidate(
  input: { title: string; year?: string; authorLast?: string },
  cand: Candidate,
): MatchScore {
  const A = titleTokens(input.title);
  const B = titleTokens(cand.title);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const jaccard = A.size && B.size ? inter / (A.size + B.size - inter) : 0;
  const coverage = A.size ? inter / A.size : 0; // how much of OUR title the candidate covers

  const yearOk = !input.year || !cand.year || Math.abs(Number(input.year) - cand.year) <= 1;
  // De-TeX + diacritic-fold both sides so "G{\"o}del" matches "Gödel".
  const last = input.authorLast ? normalizeTitle(input.authorLast) : '';
  const authorOk = !last || (cand.authors ?? []).some((n) => normalizeTitle(n).includes(last));

  // Coverage handles subtitles ("Learning to Signal" ⊂ "Learning to Signal: …");
  // the A.size ≥ 3 guard stops generic 1–2-word titles from over-matching.
  const strongTitle = jaccard >= 0.7 || (coverage >= 0.85 && A.size >= 3);
  const plausibleTitle = jaccard >= 0.45 || (coverage >= 0.7 && A.size >= 3);
  return {
    score: Math.max(jaccard, coverage),
    confident: strongTitle && yearOk && authorOk,
    plausible: plausibleTitle && yearOk,
  };
}

// --- orchestrator -----------------------------------------------------------

export interface LocateInput {
  doi?: string;
  title?: string;
  year?: string;
  authorLast?: string;
}

export type LocateOutcome =
  | { status: 'attach'; pdfUrl: string; via: 'doi' | 'fuzzy'; matchedTitle?: string; score?: number; license?: string }
  | { status: 'candidate'; matchedTitle: string; year?: string; score: number; pdfUrl?: string; reason: string }
  | { status: 'none'; reason: string };

export interface LocateDeps {
  /** Unpaywall: DOI → a direct OA PDF URL, or null when none is open-access. */
  oaPdfForDoi(doi: string): Promise<{ pdfUrl: string; license?: string } | null>;
  /** Crossref: best-matching works for a title (to resolve a DOI). */
  resolveByTitle(input: { title: string; year?: string; authorLast?: string }): Promise<Candidate[]>;
}

/**
 * Resolve an OA PDF URL for one entry. With a DOI: ask Unpaywall directly. Without
 * one: resolve a DOI from the title via Crossref (top candidate must clear a
 * confidence gate), then ask Unpaywall. A plausible-but-unconfident match is
 * returned as a `candidate` (reported, never silently attached). Network is
 * injected via {@link LocateDeps}.
 */
export async function locateOa(input: LocateInput, deps: LocateDeps = defaultDeps): Promise<LocateOutcome> {
  if (input.doi) {
    const hit = await deps.oaPdfForDoi(input.doi);
    if (hit) return { status: 'attach', via: 'doi', pdfUrl: hit.pdfUrl, license: hit.license };
    return { status: 'none', reason: 'No open-access copy is available for this DOI.' };
  }

  const title = (input.title ?? '').trim();
  if (!title) return { status: 'none', reason: 'No DOI or title to search with.' };

  const cands = await deps.resolveByTitle({ title, year: input.year, authorLast: input.authorLast });
  const scored = cands
    .map((c) => ({ c, s: scoreCandidate({ title, year: input.year, authorLast: input.authorLast }, c) }))
    .filter((x) => !!x.c.doi) // need a DOI to resolve to a PDF
    .sort((a, b) => b.s.score - a.s.score);
  if (scored.length === 0 || !scored[0]!.s.plausible) return { status: 'none', reason: 'No matching record found.' };

  // The same work often appears under several DOIs (preprint + published); the
  // preprint may have no OA copy while the published version does. So try the top
  // couple of confident matches' DOIs and take the first OA hit (kept small to
  // bound requests per entry).
  const confident = scored.filter((x) => x.s.confident).slice(0, 2);
  for (const x of confident) {
    const hit = await deps.oaPdfForDoi(x.c.doi!);
    if (hit) return { status: 'attach', via: 'fuzzy', pdfUrl: hit.pdfUrl, matchedTitle: x.c.title, score: x.s.score, license: hit.license };
  }
  if (confident.length > 0) {
    return { status: 'none', reason: `Matched “${confident[0]!.c.title}” but no open-access PDF was found.` };
  }
  // Only plausible (not confident): worth surfacing ONLY if there's actually an OA
  // PDF to review — otherwise there's nothing to attach, so report "no OA copy"
  // rather than a dead-end "possible match".
  const top = scored[0]!;
  const hit = await deps.oaPdfForDoi(top.c.doi!);
  if (!hit) return { status: 'none', reason: 'No open-access PDF found.' };
  return {
    status: 'candidate',
    matchedTitle: top.c.title,
    year: top.c.year ? String(top.c.year) : undefined,
    score: top.s.score,
    pdfUrl: hit.pdfUrl,
    reason: 'Possible match — review before attaching.',
  };
}

// --- network: throttle + timeout + retry (shared by Unpaywall + Crossref) ----
//
// Both services are generous but polite: we serialise requests with a minimum gap,
// time each out (so a stalled host can never hang the batch), and retry 429/5xx
// with exponential backoff (honouring a short `Retry-After`).

const MIN_GAP_MS = 35; // ≥35 ms between request starts → ≤ ~28/s (Crossref allows 50/s)
const MAX_RETRIES = 3;
const LOOKUP_TIMEOUT_MS = 15_000;
const PDF_TIMEOUT_MS = 45_000;

let contactEmail = '';
let nextSlot = 0; // earliest timestamp the next request may start

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Set the contact email used for Unpaywall (required) and the Crossref polite
 *  pool. Call once per run from the host, sourced from settings. */
export function setContactEmail(email: string): void {
  contactEmail = (email ?? '').trim();
}

/** The configured contact email, or '' if none. */
export function getContactEmail(): string {
  return contactEmail;
}

/** A rate-limit that survived all retries — lets the caller stop a big batch. */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/** `fetch` with a hard timeout: an unresponsive server aborts instead of hanging
 *  forever (critical for a long sequential batch). The signal stays armed through
 *  body reading via `read` (so a stalled download body also bails). */
async function fetchWithTimeout(
  url: string,
  opts: RequestInit,
  timeoutMs: number,
  read?: (res: Response) => Promise<unknown>,
): Promise<{ res: Response; body: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const body = read ? await read(res) : undefined;
    return { res, body };
  } finally {
    clearTimeout(timer);
  }
}

/** Backoff (ms) before retry `attempt` (1-based): honour `Retry-After` (capped low
 *  so we don't stall on a huge value — the caller's circuit breaker handles a real
 *  outage), else exponential 0.5s→16s with jitter. Exported for testing. */
export function nextBackoffMs(attempt: number, retryAfter?: string | null, jitter = Math.random()): number {
  const ra = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(ra) && ra >= 0) return Math.min(ra * 1000, 5_000);
  const base = Math.min(500 * 2 ** (attempt - 1), 16_000);
  return Math.round(base * (1 + 0.25 * jitter));
}

/** Rate-limit request *starts* to ≥ MIN_GAP_MS apart **without serialising** — so
 *  several lookups can be in flight at once (the caller bounds concurrency). This
 *  caps the request rate while letting a parallel batch overlap network latency. */
async function throttle(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_GAP_MS;
  const wait = slot - now;
  if (wait > 0) await sleep(wait);
}

/** Friendly error for a status that survived all retries. 429 → {@link RateLimitError}. */
function rateLimitError(status: number): Error {
  return status === 429
    ? new RateLimitError('The lookup service is rate-limiting requests — wait a moment or run a smaller selection.')
    : new Error(`Lookup HTTP ${status}`);
}

/**
 * GET a URL → its parsed JSON, throttled, **timed out**, and retried on 429/5xx
 * (and network/timeout errors) with backoff. Returns `{status, json}` (json
 * undefined for non-2xx). Throws {@link RateLimitError} when a 429 survives every
 * retry, or the underlying error when a timeout/network failure does.
 */
async function politeGet(url: string, ua: string = UA): Promise<{ status: number; json?: unknown }> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await throttle();
    try {
      const { res, body } = await fetchWithTimeout(
        url,
        { headers: { 'User-Agent': ua } },
        LOOKUP_TIMEOUT_MS,
        (r) => (r.ok ? r.json() : Promise.resolve(undefined)),
      );
      if (res.status === 429 || res.status >= 500) {
        if (attempt === MAX_RETRIES) throw rateLimitError(res.status);
        await sleep(nextBackoffMs(attempt + 1, res.headers.get('retry-after')));
        continue;
      }
      return { status: res.status, json: body };
    } catch (e) {
      if (e instanceof RateLimitError) throw e;
      if (attempt === MAX_RETRIES) throw e; // timeout / network — give up on this entry
      await sleep(nextBackoffMs(attempt + 1));
    }
  }
  throw new Error('Lookup request failed');
}

function cleanDoi(doi: string): string {
  return doi.trim().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)/i, '');
}

// --- Unpaywall (DOI → OA PDF) ----------------------------------------------

interface UnpaywallLoc {
  url_for_pdf?: string | null;
  license?: string | null;
}
interface UnpaywallResp {
  is_oa?: boolean;
  best_oa_location?: UnpaywallLoc | null;
  oa_locations?: UnpaywallLoc[] | null;
}

async function unpaywallPdf(doi: string): Promise<{ pdfUrl: string; license?: string } | null> {
  if (!contactEmail) throw new Error('Set a contact email in Preferences → Citations to use Find Open-Access PDFs.');
  const clean = cleanDoi(doi);
  if (!clean) return null;
  const { status, json } = await politeGet(
    `https://api.unpaywall.org/v2/${clean}?email=${encodeURIComponent(contactEmail)}`,
  );
  if (status === 404 || status === 422) return null; // unknown / invalid DOI
  if (status < 200 || status >= 300) throw rateLimitError(status);
  const d = (json ?? {}) as UnpaywallResp;
  const best = d.best_oa_location;
  if (best?.url_for_pdf) return { pdfUrl: best.url_for_pdf, license: best.license ?? undefined };
  for (const loc of d.oa_locations ?? []) {
    if (loc?.url_for_pdf) return { pdfUrl: loc.url_for_pdf, license: loc.license ?? undefined };
  }
  return null;
}

// --- Crossref (title → best-matching DOI) ----------------------------------

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  author?: { family?: string; given?: string; name?: string }[];
  issued?: { 'date-parts'?: number[][] };
}

async function crossrefResolve(input: { title: string; year?: string; authorLast?: string }): Promise<Candidate[]> {
  const params = new URLSearchParams({
    'query.bibliographic': input.title,
    rows: '5',
    select: 'DOI,title,author,issued',
  });
  if (contactEmail) params.set('mailto', contactEmail); // Crossref polite pool
  const ua = contactEmail ? `${UA} (mailto:${contactEmail})` : UA;
  const { status, json } = await politeGet(`https://api.crossref.org/works?${params.toString()}`, ua);
  if (status < 200 || status >= 300) throw rateLimitError(status);
  const items = (json as { message?: { items?: CrossrefItem[] } })?.message?.items ?? [];
  return items.map((it) => ({
    doi: it.DOI,
    title: it.title?.[0] ?? '',
    year: it.issued?.['date-parts']?.[0]?.[0],
    authors: (it.author ?? [])
      .map((a) => (a.family ? `${a.given ? a.given + ' ' : ''}${a.family}`.trim() : a.name ?? ''))
      .filter(Boolean),
  }));
}

const defaultDeps: LocateDeps = { oaPdfForDoi: unpaywallPdf, resolveByTitle: crossrefResolve };

/**
 * Download a PDF to memory, validating it really is a PDF (defends against an HTML
 * error/landing page served with a `.pdf` URL). Returns null if it doesn't fetch,
 * times out, or doesn't start with `%PDF-`. The timeout covers the whole body read
 * so a stalled host can't hang the batch.
 */
export async function downloadPdf(url: string): Promise<Buffer | null> {
  try {
    const { res, body } = await fetchWithTimeout(
      url,
      { headers: { 'User-Agent': UA }, redirect: 'follow' },
      PDF_TIMEOUT_MS,
      (r) => (r.ok ? r.arrayBuffer() : Promise.resolve(undefined)),
    );
    if (!res.ok || !body) return null;
    const buf = Buffer.from(body as ArrayBuffer);
    return looksLikePdf(buf) ? buf : null;
  } catch {
    return null; // timeout / network / abort → treat as "no PDF available"
  }
}
