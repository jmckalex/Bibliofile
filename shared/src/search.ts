/**
 * Pure, environment-neutral parser for the publications search box. Splits a raw
 * query into tokens, honouring double-quoted phrases ("those exact words, in
 * that order"). Shared by the main-process FTS5 query builder and the renderer's
 * substring fallback so both interpret quotes identically.
 */

/** One parsed search token. */
export interface SearchToken {
  /** Lowercased, FTS5-operator-stripped words. Never empty. */
  readonly words: readonly string[];
  /**
   * True when the user double-quoted these words: they must appear adjacent and
   * in order (a phrase). A bare (unquoted) token is always a single word matched
   * on its own.
   */
  readonly phrase: boolean;
}

/**
 * Parse a raw query into tokens. Text inside double quotes becomes one phrase
 * token (an unterminated opening quote runs to end-of-input); every other
 * whitespace-separated run becomes a single-word token. FTS5 operator characters
 * (`*`, `(`, `)`) are stripped from words and empty tokens are dropped. Returns
 * `[]` for a blank/whitespace-only query.
 */
export function parseSearchQuery(input: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  // Alternation: a (possibly unterminated) double-quoted run, or a bare run of
  // non-space, non-quote characters. Both alternatives match ≥1 char, so the
  // global exec loop always advances (whitespace between matches is skipped).
  const re = /"([^"]*)"?|([^\s"]+)/g;
  const lower = input.toLowerCase();
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    const quoted = m[1] !== undefined;
    const words = (quoted ? m[1]! : m[2]!)
      .split(/\s+/)
      .map((w) => w.replace(/[*()]/g, '').trim())
      .filter((w) => w.length > 0);
    if (words.length === 0) continue;
    tokens.push({ words, phrase: quoted });
  }
  return tokens;
}

/**
 * Substring matcher for the renderer's client-side fallback: `text` satisfies the
 * query when every token is present — a phrase as a contiguous (single-space-
 * joined) substring, a bare word as a substring. An empty query matches anything.
 */
export function searchTokensMatch(text: string, tokens: readonly SearchToken[]): boolean {
  if (tokens.length === 0) return true;
  const hay = text.toLowerCase();
  return tokens.every((tk) => hay.includes(tk.words.join(' ')));
}
