/**
 * Fetch a journal's cover/lead image from Wikipedia, for the "Download Missing
 * Journal Covers" scan. Uses the MediaWiki API's `pageimages` on the best search
 * match (biased toward academic journals), then downloads that thumbnail.
 *
 * Matching is inherently fuzzy — a name can hit the wrong article — so callers
 * present results for review before saving, and the user can always replace a
 * cover by dropping their own image.
 */

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
// Wikimedia asks for a descriptive User-Agent on API + image requests.
const UA = 'BibDesk-Electron/0.1 (journal cover fetcher; https://bibdesk.sourceforge.io)';
const TIMEOUT_MS = 8000;
const THUMB_PX = 512;

export interface WikipediaCover {
  readonly data: Uint8Array;
  /** File extension without the dot (jpg/png/…). */
  readonly ext: string;
  /** Direct URL of the downloaded thumbnail. */
  readonly sourceUrl: string;
  /** The Wikipedia article title the image came from (for review/attribution). */
  readonly wikiTitle: string;
}

interface WikiThumb {
  source?: string;
}
interface WikiPage {
  index?: number;
  title?: string;
  thumbnail?: WikiThumb;
}

async function withTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extFromUrl(u: string): string {
  const m = /\.(jpe?g|png|gif|webp|svg)(?:$|\?|#)/i.exec(u);
  const e = m?.[1]?.toLowerCase() ?? 'jpg';
  return e === 'jpeg' ? 'jpg' : e;
}

/**
 * Find the best Wikipedia page for `journal` that has a lead image and return its
 * downloaded thumbnail bytes, or null if no suitable image is found.
 */
export async function fetchWikipediaCover(journal: string): Promise<WikipediaCover | null> {
  const params = new URLSearchParams({
    format: 'json',
    action: 'query',
    generator: 'search',
    gsrsearch: `${journal} academic journal`,
    gsrlimit: '3',
    prop: 'pageimages',
    piprop: 'thumbnail',
    pithumbsize: String(THUMB_PX),
    redirects: '1',
    origin: '*',
  });

  let pages: WikiPage[];
  try {
    const res = await withTimeout(`${WIKI_API}?${params}`, { 'User-Agent': UA, 'Api-User-Agent': UA });
    if (!res.ok) return null;
    const json = (await res.json()) as { query?: { pages?: Record<string, WikiPage> } };
    pages = json.query?.pages ? Object.values(json.query.pages) : [];
  } catch {
    return null;
  }

  // Highest-ranked search hit that actually has a thumbnail.
  pages.sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  const page = pages.find((p) => p.thumbnail?.source);
  const src = page?.thumbnail?.source;
  if (!src) return null;

  try {
    const img = await withTimeout(src, { 'User-Agent': UA });
    if (!img.ok) return null;
    const data = new Uint8Array(await img.arrayBuffer());
    if (data.byteLength === 0) return null;
    return { data, ext: extFromUrl(src), sourceUrl: src, wikiTitle: page?.title ?? journal };
  } catch {
    return null;
  }
}
