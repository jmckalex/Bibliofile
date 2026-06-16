/**
 * Brace-aware low-level helpers shared by the name-list splitter and the
 * single-name (Patashnik / btparse) splitter.
 *
 * BibTeX brace semantics: a `{...}` group is "protected" and its contents are
 * opaque to splitting (on ` and `, on spaces, and on commas). Brace depth is
 * tracked left-to-right; only depth-0 delimiters split. We intentionally do not
 * treat `\{` / `\}` as escapes here: btparse's `bt_split_list` /
 * `find_commas` / `find_tokens` count raw `{` / `}` characters, so we match that
 * behaviour exactly for parity with the original BibDesk parser.
 */

/** Collapse all internal whitespace runs to a single space and trim ends. */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Split `s` on top-level (brace-depth-0) occurrences of `sep`, case-insensitive,
 * where `sep` must be surrounded by whitespace (BibTeX ` and ` rules).
 *
 * Mirrors btparse `bt_split_list(str, "and", ...)` and BibDesk's
 * `__BDSKArrayOfNames`: leading/trailing delimiters are ignored, the delimiter
 * must be flanked by spaces, matching is case-insensitive, and delimiters at
 * non-zero brace depth do not split. Returns `null` when braces are unbalanced
 * (BibDesk's error sentinel).
 */
export function splitTopLevelDelimited(s: string, sep: string): string[] | null {
  const lowerSep = sep.toLowerCase();
  const sepLen = lowerSep.length;
  const lower = s.toLowerCase();
  const len = s.length;

  const pieces: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;

  while (i < len) {
    const ch = s[i]!;
    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth--;
      i++;
      continue;
    }
    // Candidate delimiter: at depth 0, preceded by whitespace, the delimiter
    // text matches, and it is followed by whitespace.
    if (
      depth === 0 &&
      i > 0 &&
      isSpace(s[i - 1]!) &&
      lower.startsWith(lowerSep, i) &&
      i + sepLen < len &&
      isSpace(s[i + sepLen]!)
    ) {
      // The whitespace before the delimiter belongs to the preceding piece's
      // trailing trim; emit the piece up to (but not including) that space.
      pieces.push(s.slice(start, i - 1));
      i += sepLen + 1; // skip delimiter and the single following space
      start = i;
      continue;
    }
    i++;
  }

  if (depth !== 0) return null;
  pieces.push(s.slice(start));
  return pieces;
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

/**
 * Token classification for von detection. Returns the case of the token's first
 * "letter" as btparse sees it: btparse's `find_lc_tokens` simply tests
 * `islower(token[0])` on the raw first byte.
 *
 *   - a token starting with a lowercase ASCII letter -> 'lower'
 *   - anything else (uppercase letter, `{`, `\`, digit, accented byte, ...) ->
 *     'upper' (i.e. not a von token)
 *
 * This deliberately matches btparse byte-for-byte: a brace group `{...}` or a
 * control sequence `\xx` at the start of a token is NOT treated as von, and an
 * accented first character that is not a literal ASCII a-z is NOT von either.
 */
export function tokenFirstLetterIsLower(token: string): boolean {
  const c = token.charCodeAt(0);
  return c >= 0x61 && c <= 0x7a; // 'a'..'z'
}
