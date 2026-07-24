/**
 * `x-bibdesk://` URL-scheme automation — the cross-platform hook that lets
 * AppleScript (`open location "x-bibdesk://…"` / `do shell script "open …"`),
 * shell scripts, and other apps drive a running BibDesk. This module is the pure
 * URL PARSER (unit-tested); the side effects (open a file, import, add an entry)
 * are dispatched in `index.ts`.
 *
 * NOTE: this is the pragmatic Electron-native automation surface. A full macOS
 * AppleScript dictionary (`.sdef` scriptable object model with queries returning
 * values) requires a native Cocoa scripting bridge — out of scope for pure
 * Electron. The URL scheme covers fire-and-forget *commands*.
 *
 * Grammar: `x-bibdesk://<command>?<query>` — e.g.
 *   x-bibdesk://open?file=/abs/lib.bib
 *   x-bibdesk://import?bibtex=<url-encoded @article{…}>
 *   x-bibdesk://import?doi=10.1000/xyz
 *   x-bibdesk://new?type=article&Title=Hello&Author=Ada%20Lovelace
 */

/** A parsed automation action: a command + its string parameters. */
export interface AppUrlAction {
  readonly command: string;
  readonly params: Readonly<Record<string, string>>;
}

/** Parse an `x-bibdesk://…` URL, or null if it isn't one / is malformed. */
export function parseAppUrl(raw: string): AppUrlAction | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'x-bibdesk:') return null;
  // The command is the authority (`//import?…`) or the first path segment.
  const command = (url.hostname || url.pathname.replace(/^\/+/, '').split('/')[0] || '').toLowerCase();
  if (!command) return null;
  const params: Record<string, string> = {};
  for (const [k, v] of url.searchParams) params[k] = v;
  return { command, params };
}

/**
 * May an `x-bibdesk://open?file=` request open this path?
 *
 * Only bibliographies. Any app — or any web page the user merely visits — can
 * emit one of these URLs, so an unrestricted `open?file=` is a local-file prober:
 * the app's response tells the sender whether a given path exists and parses
 * (audit rpt-02 SEV-6). Callers must ALSO confirm with the user; this is the
 * cheap categorical filter, not the whole gate.
 */
export function isOpenableBibPath(file: string): boolean {
  if (!file) return false;
  // Reject embedded NULs: the OS would truncate the path there, so the `.bib`
  // suffix we checked need not be the suffix that actually gets opened.
  // Spaces are perfectly legitimate here ("My Library.bib") — only NUL is not.
  if (file.includes('\u0000')) return false;
  return /\.bib$/i.test(file.trim());
}
