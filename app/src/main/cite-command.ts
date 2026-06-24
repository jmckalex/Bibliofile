/**
 * LaTeX/natbib-style citation commands in annotations (`\cite{…}`, `\citep{…}`,
 * `\citet{…}`, `\citeauthor{…}`, `\fullcite{…}`, `\nocite{…}`, with optional
 * `[prenote][postnote]` arguments and comma-separated keys). This is the pure
 * grammar — recognising and parsing the command; the citation-js rendering lives
 * in `csl.ts` and the marked extension that fires on it in `markdown.ts`.
 *
 * Ported from the user's Biblify project (`parsing.js`) so the two stay in step.
 */

/**
 * Recognises one citation command. Capture groups:
 *   1 `full`  2 `no`  3 `author`  4 `t`|`p`  5 `*`  6 `[opt]`  7 `[opt]`  8 keys
 * so `\citep[see][p. 5]{a,b}` parses into prenote `[see]`, postnote `[p. 5]`,
 * keys `a,b`. Case-insensitive (so `\Citet` matches too — capitalisation is a
 * future variant the renderer can act on).
 */
export const CITE_PATTERN =
  /\\(full)?(no)?cite(author)?(t|p)?(\*)?(\[[^\]]*\])?(\[[^\]]*\])?\{([^}]*)\}/i;

/** The whole inline command, anchored at the start of a string (for the marked
 *  tokenizer, which is handed the remaining source at the current position). */
export const CITE_PATTERN_ANCHORED = new RegExp(`^${CITE_PATTERN.source}`, 'i');

/** Quick scan for where the next command *might* begin, for the tokenizer's `start`. */
export const CITE_START_RE = /\\(?:full|no)?cite/i;

/** The kind of inline output a command produces. */
export type CiteKind = 'textual' | 'parenthetical' | 'author' | 'full' | 'nocite';

/** A parsed citation command, normalised to a {@link CiteKind} + its arguments. */
export interface ParsedCite {
  readonly kind: CiteKind;
  /** All authors (`\citeauthor*`), not just the truncated "et al." form. */
  readonly allAuthors: boolean;
  /** Prenote — the first `[…]` argument's inner text, or '' if absent. */
  readonly prenote: string;
  /** Postnote — the second `[…]` (or the only `[…]`) argument's inner text. */
  readonly postnote: string;
  /** Cite keys, trimmed, in order. */
  readonly keys: readonly string[];
  /** The keys as a comma-joined string (for `data-cite`). */
  readonly keyString: string;
}

/** Strip the surrounding `[ ]` from an optional argument (undefined → ''). */
function optText(opt: string | undefined): string {
  return opt === undefined ? '' : opt.slice(1, -1).trim();
}

/**
 * Parse a matched command into a normalised {@link ParsedCite}, or null if it
 * isn't a citation command. Mirrors natbib/Biblify semantics:
 *   - a missing `t`/`p` type means **textual** (so bare `\cite` = `\citet`);
 *   - one optional arg is the **postnote**, two are **prenote** then postnote.
 */
export function parseCite(command: string): ParsedCite | null {
  const m = CITE_PATTERN.exec(command);
  if (!m) return null;
  const [, full, no, author, type, star, opt1, opt2] = m;
  const keys = (m[8] ?? '').split(',').map((k) => k.trim()).filter((k) => k.length > 0);

  let kind: CiteKind;
  if (no !== undefined) kind = 'nocite';
  else if (full !== undefined) kind = 'full';
  else if (author !== undefined) kind = 'author';
  else if (type === 'p') kind = 'parenthetical';
  else kind = 'textual'; // `\citet` or a bare `\cite`

  // One `[…]` is the postnote (e.g. page); two are prenote then postnote.
  const prenote = opt2 !== undefined ? optText(opt1) : '';
  const postnote = opt2 !== undefined ? optText(opt2) : optText(opt1);

  return {
    kind,
    allAuthors: star !== undefined,
    prenote,
    postnote,
    keys,
    keyString: keys.join(','),
  };
}
