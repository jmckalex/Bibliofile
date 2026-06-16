/**
 * `Author` value object — the TypeScript analogue of BibDesk's `BibAuthor`.
 *
 * Built from a single name string, it exposes the parsed four parts plus the
 * derived display variants BibDesk uses for display, sorting, abbreviation, and
 * duplicate detection. The shape is a frozen plain object (no class/getters) so
 * it is trivially structured-cloneable for IPC/clipboard. Variants are computed
 * eagerly in {@link makeAuthor} — there is no laziness because the cost is tiny
 * and frozen objects can't memoize.
 *
 * Variant semantics (matching `BibAuthor.m setupNames` / `setupAbbreviatedNames`):
 *   name            "First von Last, Jr"
 *   normalizedName  "von Last, Jr, First"   (canonical; used for equality)
 *   fullLastName    "von Last, Jr"
 *   sortableName    "Last First"            (no comma/von/jr, braces stripped, then deTeXified+lowercased)
 *   abbreviatedName "F. M. von Last, Jr"
 *   displayName     "First von Last, Jr" with TeX removed (default display)
 *   fuzzyName       von+last, deTeXified, punctuation-stripped, lowercased (dup detection)
 *   firstNames[]    individual first-name tokens, deTeXified
 */
import { detexify } from './tex.js';
import { parseName, type ParsedName } from './parseName.js';

export interface Author {
  /** The exact string this author was created from. */
  readonly originalName: string;

  // --- the four BibTeX parts (empty string when absent) ---
  readonly first: string;
  readonly von: string;
  readonly last: string;
  readonly jr: string;

  // --- display variants ---
  /** "First von Last, Jr" */
  readonly name: string;
  /** "von Last, Jr, First" — canonical, used for exact equality. */
  readonly normalizedName: string;
  /** "von Last, Jr" */
  readonly fullLastName: string;
  /** "Last First" sort key: braces stripped, deTeXified, lowercased. */
  readonly sortableName: string;
  /** "F. M. von Last, Jr" */
  readonly abbreviatedName: string;
  /** "von Last, Jr, F. M." */
  readonly abbreviatedNormalizedName: string;
  /** "von Last FM Jr" */
  readonly unpunctuatedAbbreviatedNormalizedName: string;
  /** Default display form: `name` with TeX removed. */
  readonly displayName: string;
  /** Duplicate-detection key: von+last, deTeXified, punctuation-stripped, lowercased. */
  readonly fuzzyName: string;
  /** Individual first-name tokens, deTeXified (drives initials + fuzzy match). */
  readonly firstNames: readonly string[];
}

/**
 * Build an {@link Author} from a name string. The result is deeply frozen and
 * safe to share/clone.
 */
export function makeAuthor(originalName: string): Author {
  const parsed = parseName(originalName);
  const variants = computeVariants(parsed);

  const author: Author = {
    originalName,
    first: parsed.first,
    von: parsed.von,
    last: parsed.last,
    jr: parsed.jr,
    ...variants,
  };
  Object.freeze(author.firstNames);
  return Object.freeze(author);
}

interface Variants {
  name: string;
  normalizedName: string;
  fullLastName: string;
  sortableName: string;
  abbreviatedName: string;
  abbreviatedNormalizedName: string;
  unpunctuatedAbbreviatedNormalizedName: string;
  displayName: string;
  fuzzyName: string;
  firstNames: readonly string[];
}

function computeVariants(p: ParsedName): Variants {
  const { first, von, last, jr } = p;

  // fullLastName = "von Last, Jr"
  const lastUnit = joinSpace(von, last);
  const fullLastName = jr ? appendComma(lastUnit, jr) : lastUnit;

  // normalizedName = "von Last, Jr, First"
  const normalizedName = first ? appendComma(fullLastName, first) : fullLastName;

  // name = "First von Last, Jr"
  const name = first ? joinSpace(first, fullLastName) : fullLastName;

  // sortableName = "Last First" (no von/jr/comma), braces stripped, deTeXified, lowercased.
  const sortableRaw = stripBraces(first ? joinSpace(last, first) : last);
  const sortableName = detexify(sortableRaw).toLowerCase();

  // firstNames: deTeXify the first name, then split on space + period, trim, drop empties.
  const firstNames: string[] = first ? splitFirstNames(detexify(first)) : [];

  // abbreviated forms
  const { abbrevFirst, shortAbbrevFirst } = abbreviateFirstNames(firstNames);
  const abbreviatedName = first
    ? joinSpace(abbrevFirst, fullLastName)
    : fullLastName;
  const abbreviatedNormalizedName = first
    ? appendComma(fullLastName, abbrevFirst)
    : fullLastName;
  const unpunctuatedAbbreviatedNormalizedName = buildUnpunctuated(
    von,
    last,
    shortAbbrevFirst,
    jr,
  );

  // displayName: default mask is "First von Last, Jr" with TeX removed.
  const displayName = detexify(name);

  // fuzzyName: von+last (no spaces), deTeXified, punctuation-stripped, lowercased.
  const fuzzyName = makeFuzzy(von + last);

  return {
    name,
    normalizedName,
    fullLastName,
    sortableName,
    abbreviatedName,
    abbreviatedNormalizedName,
    unpunctuatedAbbreviatedNormalizedName,
    displayName,
    fuzzyName,
    firstNames,
  };
}

// --- helpers ---------------------------------------------------------------

function joinSpace(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

function appendComma(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a}, ${b}`;
}

function stripBraces(s: string): string {
  return s.replace(/[{}]/g, '');
}

/**
 * Split a (deTeXified) first-name string into name tokens. BibDesk splits on the
 * separator set `" ."` (space and period) and trims whitespace, dropping empty
 * fragments. So "Donald E." -> ["Donald", "E"] and "M.-P." -> ["M", "-P"]
 * (the dash stays attached to the following letter).
 */
function splitFirstNames(first: string): string[] {
  return first
    .split(/[ .]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Port of BibDesk's `appendFirstLetterCharacters` over all first-name tokens.
 *
 * For each token, take the first *letter* (not first char — fixes "M.-P." which
 * must not become "M. -.") of each dash-separated fragment:
 *   - tokens are separated by a single space in the long form
 *   - dash-separated fragments within a token are rejoined with "-"
 *   - the long form appends "." after each initial; the short form does not
 *
 * Examples:
 *   ["Donald","E"]   -> long "D. E.",   short "DE"
 *   ["M","-P"]       -> long "M.-P.",   short "MP"
 *   ["Jean","-Paul"] -> long "J.-P.",   short "JP"
 */
function abbreviateFirstNames(firstNames: readonly string[]): {
  abbrevFirst: string;
  shortAbbrevFirst: string;
} {
  let long = '';
  let short = '';
  firstNames.forEach((token, idx) => {
    appendFirstLetterCharacters(token, idx === 0, (chunk, isLong) => {
      if (isLong) long += chunk;
      else short += chunk;
    });
  });
  return { abbrevFirst: long, shortAbbrevFirst: short };
}

/**
 * Process one first-name token: for each dash-separated fragment, find the first
 * letter and emit it. `emit` receives chunks for the long form (isLong=true) and
 * the short form (isLong=false).
 */
function appendFirstLetterCharacters(
  fragment: string,
  isFirstToken: boolean,
  emit: (chunk: string, isLong: boolean) => void,
): void {
  // Split on dashes but remember whether a dash preceded each piece.
  const subFragments = splitKeepingDashPosition(fragment);
  for (const sf of subFragments) {
    const letter = firstLetter(sf.text);
    if (letter === null) continue;
    if (sf.precededByDash) {
      emit('-', true);
    } else if (!isFirstToken) {
      emit(' ', true);
    }
    emit(letter, true);
    emit('.', true);
    emit(letter, false);
  }
}

function splitKeepingDashPosition(
  fragment: string,
): { text: string; precededByDash: boolean }[] {
  const out: { text: string; precededByDash: boolean }[] = [];
  const parts = fragment.split('-');
  parts.forEach((text, i) => {
    out.push({ text, precededByDash: i > 0 });
  });
  return out;
}

/** Return the first Unicode letter in `s`, or null if none. */
function firstLetter(s: string): string | null {
  for (const ch of s) {
    if (/\p{L}/u.test(ch)) return ch;
  }
  return null;
}

/** "von Last FM Jr" (short initials, space-separated, no periods). */
function buildUnpunctuated(
  von: string,
  last: string,
  shortAbbrevFirst: string,
  jr: string,
): string {
  let out = '';
  if (von) out += `${von} `;
  if (last) out += last;
  if (shortAbbrevFirst) out += ` ${shortAbbrevFirst}`;
  if (jr) out += ` ${jr}`;
  return out;
}

/**
 * Build the fuzzy-match key: deTeXify, then strip everything that is not a
 * letter or digit, then lowercase. BibDesk uses von+last with whitespace already
 * collapsed away; we additionally drop punctuation/braces so e.g. `{Getty}` and
 * `Getty` collapse together.
 */
function makeFuzzy(vonLast: string): string {
  return detexify(vonLast)
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
}
