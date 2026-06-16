/**
 * Single-name splitting into the four BibTeX/Patashnik parts: first / von /
 * last / jr.
 *
 * This is a faithful TypeScript port of btparse's `bt_split_name` (the engine
 * BibDesk drives via `BDSKBibTeXParser nameComponents:`), preserving its token,
 * comma, von, and brace logic. Patashnik's three forms:
 *
 *   "First von Last"            (no comma)
 *   "von Last, First"           (1 comma)
 *   "von Last, Jr, First"       (2 commas; >2 commas: extras dropped)
 *
 * von tokens are the run of whitespace-separated tokens whose first byte is a
 * lowercase ASCII letter (brace groups `{...}` and control sequences `\xx`
 * count as uppercase, i.e. not von) — matching btparse byte-for-byte.
 */
import { collapseWhitespace, tokenFirstLetterIsLower } from './brace.js';

/** The four BibTeX name parts. Empty parts are the empty string, never undefined. */
export interface ParsedName {
  /** Given/first names (may include middle names), space-joined. */
  readonly first: string;
  /** "von" / nobiliary particle run (e.g. `von`, `de la`), space-joined. */
  readonly von: string;
  /** Family/last name, space-joined. */
  readonly last: string;
  /** Generational suffix (`Jr`, `III`, ...), space-joined. */
  readonly jr: string;
  /** Tokenized parts, in case a consumer wants them. */
  readonly firstTokens: readonly string[];
  readonly vonTokens: readonly string[];
  readonly lastTokens: readonly string[];
  readonly jrTokens: readonly string[];
}

const MAX_COMMAS = 2;

interface Tokenized {
  /** Top-level (brace-depth-0) tokens. */
  tokens: string[];
  /** For each comma (in order), the index of the token immediately preceding it. */
  commaTokens: number[];
}

/**
 * Port of btparse `find_commas` + `find_tokens`. Splits a *whitespace-collapsed*
 * name into tokens (delimited by space or comma at brace depth 0), records the
 * token index preceding each top-level comma, drops trailing commas, and caps
 * the comma count at {@link MAX_COMMAS} (excess commas are treated as spaces).
 */
function tokenizeName(name: string): Tokenized {
  // --- find_commas: locate top-level commas, demote excess ones to spaces ---
  const chars = [...name];
  let depth = 0;
  let commaCount = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      commaCount++;
      if (commaCount > MAX_COMMAS) chars[i] = ' ';
    }
  }
  // Re-collapse whitespace if we demoted any commas (btparse re-postprocesses).
  let working = chars.join('');
  if (commaCount > MAX_COMMAS) working = collapseWhitespace(working);

  // Remove whitespace around top-level commas and any trailing comma(s).
  working = stripSpacesAroundCommas(working);

  // --- find_tokens: split on space/comma at depth 0 ---
  const tokens: string[] = [];
  const commaTokens: number[] = [];
  depth = 0;
  let cur = '';
  let started = false;
  for (let i = 0; i < working.length; i++) {
    const ch = working[i]!;
    if (depth === 0 && (ch === ' ' || ch === ',')) {
      // Record the token index preceding this comma. btparse records
      // `num_tok - 1` at the comma; if we are still inside the current token
      // (started), that token has not been pushed yet, so its eventual index is
      // `tokens.length`; otherwise the preceding token is `tokens.length - 1`.
      if (ch === ',') commaTokens.push(started ? tokens.length : tokens.length - 1);
      if (started) {
        tokens.push(cur);
        cur = '';
        started = false;
      }
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    cur += ch;
    started = true;
  }
  if (started) tokens.push(cur);

  return { tokens, commaTokens };
}

/** Remove whitespace immediately around top-level commas, and trailing commas. */
function stripSpacesAroundCommas(name: string): string {
  let depth = 0;
  let out = '';
  for (let i = 0; i < name.length; i++) {
    const ch = name[i]!;
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth === 0 && ch === ',') {
      while (out.length > 0 && out[out.length - 1] === ' ') out = out.slice(0, -1);
      out += ',';
      // skip following spaces
      while (i + 1 < name.length && name[i + 1] === ' ') i++;
      continue;
    }
    out += ch;
  }
  // drop trailing comma(s)
  while (out.length > 0 && out[out.length - 1] === ',') out = out.slice(0, -1);
  return out;
}

/** Port of btparse `find_lc_tokens`: first contiguous run of lowercase tokens. */
function findLcTokens(tokens: readonly string[]): { firstLc: number; lastLc: number } {
  let firstLc = -1;
  let lastLc = -1;
  let i = 0;
  while (i < tokens.length) {
    if (firstLc === -1 && tokenFirstLetterIsLower(tokens[i]!)) {
      firstLc = i;
      i++;
      while (i < tokens.length && tokenFirstLetterIsLower(tokens[i]!)) i++;
      lastLc = i - 1;
    } else {
      i++;
    }
  }
  return { firstLc, lastLc };
}

function range(tokens: readonly string[], lo: number, hi: number): string[] {
  if (hi - lo + 1 <= 0) return [];
  return tokens.slice(lo, hi + 1);
}

/**
 * Parse a single BibTeX name into first / von / last / jr.
 *
 * The input is whitespace-collapsed first. A name wrapped entirely in one
 * `{...}` group (a "corporate"/protected name such as `{Barnes and Noble, Inc.}`)
 * is treated as a single last-name unit with braces preserved — the protective
 * group means btparse sees a single depth-0 token.
 */
export function parseName(name: string): ParsedName {
  const collapsed = collapseWhitespace(name);
  if (collapsed.length === 0) return emptyParsed();

  const { tokens, commaTokens } = tokenizeName(collapsed);
  if (tokens.length === 0) return emptyParsed();

  const { firstLc, lastLc } = findLcTokens(tokens);
  const numCommas = Math.min(commaTokens.length, MAX_COMMAS);

  if (numCommas === 0) {
    return splitSimpleName(tokens, firstLc, lastLc);
  }
  return splitGeneralName(tokens, numCommas, commaTokens, firstLc, lastLc);
}

/** Port of btparse `split_simple_name` (no-comma "First von Last" form). */
function splitSimpleName(
  tokens: readonly string[],
  firstLc: number,
  lastLcIn: number,
): ParsedName {
  const end = tokens.length - 1;
  let lastLc = lastLcIn;

  let firstT: [number, number];
  let vonT: [number, number];
  let lastT: [number, number];

  if (firstLc > -1) {
    firstT = [0, firstLc - 1];
    if (lastLc === end) lastLc--; // keep at least one last-name token
    vonT = [firstLc, lastLc];
    lastT = [lastLc + 1, end];
  } else {
    vonT = [0, -1];
    firstT = [0, end - 1];
    lastT = [end, end];
  }

  return assemble(
    range(tokens, firstT[0], firstT[1]),
    range(tokens, vonT[0], vonT[1]),
    range(tokens, lastT[0], lastT[1]),
    [],
  );
}

/** Port of btparse `split_general_name` (1- or 2-comma forms). */
function splitGeneralName(
  tokens: readonly string[],
  numCommas: number,
  commaTokens: readonly number[],
  firstLc: number,
  lastLcIn: number,
): ParsedName {
  const end = tokens.length - 1;
  let lastLc = lastLcIn;

  let vonT: [number, number];
  if (firstLc === 0) {
    if (lastLc === commaTokens[0]!) lastLc--; // need a capitalized last name
    vonT = [firstLc, lastLc];
  } else {
    vonT = [0, -1];
  }

  const lastT: [number, number] = [vonT[1] + 1, commaTokens[0]!];

  let firstT: [number, number];
  let jrT: [number, number];
  if (numCommas === 1) {
    firstT = [commaTokens[0]! + 1, end];
    jrT = [0, -1];
  } else {
    jrT = [commaTokens[0]! + 1, commaTokens[1]!];
    firstT = [commaTokens[1]! + 1, end];
  }

  return assemble(
    range(tokens, firstT[0], firstT[1]),
    range(tokens, vonT[0], vonT[1]),
    range(tokens, lastT[0], lastT[1]),
    range(tokens, jrT[0], jrT[1]),
  );
}

function assemble(
  firstTokens: string[],
  vonTokens: string[],
  lastTokens: string[],
  jrTokens: string[],
): ParsedName {
  return {
    first: firstTokens.join(' '),
    von: vonTokens.join(' '),
    last: lastTokens.join(' '),
    jr: jrTokens.join(' '),
    firstTokens,
    vonTokens,
    lastTokens,
    jrTokens,
  };
}

function emptyParsed(): ParsedName {
  return {
    first: '',
    von: '',
    last: '',
    jr: '',
    firstTokens: [],
    vonTokens: [],
    lastTokens: [],
    jrTokens: [],
  };
}
