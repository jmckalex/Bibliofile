// Core TeXify / deTeXify codec — a faithful TypeScript port of BibDesk's
// `BDSKConverter.m` (`copyStringByTeXifyingString:` / `copyStringByDeTeXifyingString:`
// and the static helpers `convertComposedCharacterToTeX` / `convertTeXStringToComposedCharacter`).
//
// Strategy (identical to the Obj-C original):
//   1. A verbatim dictionary lookup from CharacterConversion.plist.
//   2. An algorithmic accent codec that composes/decomposes a base letter + a single
//      combining mark via Unicode NFC/NFD (`String.prototype.normalize`, which maps
//      directly onto the `CFStringNormalize` calls in the original).
//
// Platform-agnostic: no Node/DOM/Electron APIs, no runtime file reads.

import {
  ONE_WAY_CONVERSIONS,
  ROMAN_TO_TEX,
  TEX_TO_ROMAN,
  ROMAN_TO_TEX_ACCENTS,
  TEX_TO_ROMAN_ACCENTS,
} from './data/conversionTable.js';

// ---------------------------------------------------------------------------
// Derived lookup tables (built once at module load, mirroring BDSKConverter -loadDict).
// ---------------------------------------------------------------------------

/**
 * Standalone special-letter commands that the upstream CharacterConversion.plist does NOT
 * include but that real-world BibTeX and the task spec require: bare dotless i/j.
 *
 * BibDesk's plist has `{\ss}`, `{\o}`, `{\l}`, `{\aa}`, `{\ae}`, `{\oe}`, etc., but no
 * standalone `{\i}` / `{\j}`; in the original app a lone `{\i}` would pass through
 * unconverted. We add them here (and their inverse) so dotless i/j round-trip.
 *   - "ı" = U+0131 LATIN SMALL LETTER DOTLESS I
 *   - "ȷ" = U+0237 LATIN SMALL LETTER DOTLESS J
 */
export const EXTRA_TEX_TO_ROMAN: Readonly<Record<string, string>> = {
  '{\\i}': 'ı',
  '{\\j}': 'ȷ',
};

export const EXTRA_ROMAN_TO_TEX: Readonly<Record<string, string>> = {
  'ı': '{\\i}',
  'ȷ': '{\\j}',
};

/**
 * Unicode -> TeX dictionary used by {@link texify}.
 * Equivalent to `texifyConversions` = "Roman to TeX" + "One-Way Conversions", plus the
 * dotless i/j additions (see EXTRA_ROMAN_TO_TEX).
 * (One-way entries are appended last; per the plist they do not collide with Roman-to-TeX.)
 */
export const TEXIFY_DICTIONARY: Readonly<Record<string, string>> = {
  ...ROMAN_TO_TEX,
  ...ONE_WAY_CONVERSIONS,
  ...EXTRA_ROMAN_TO_TEX,
};

/**
 * TeX -> Unicode dictionary used by {@link detexify}.
 * Equivalent to `detexifyConversions` = "TeX to Roman", plus the dotless i/j additions.
 */
export const DETEXIFY_DICTIONARY: Readonly<Record<string, string>> = {
  ...TEX_TO_ROMAN,
  ...EXTRA_TEX_TO_ROMAN,
};

/** combining-mark -> TeX accent command (e.g. U+0301 -> "'", U+030C -> "v "). */
export const TEXIFY_ACCENTS: Readonly<Record<string, string>> = ROMAN_TO_TEX_ACCENTS;

/** TeX accent command char -> combining mark (e.g. "'" -> U+0301, "v" -> U+030C). */
export const DETEXIFY_ACCENTS: Readonly<Record<string, string>> = TEX_TO_ROMAN_ACCENTS;

// Set of single chars that the algorithmic accent codec accepts as combining marks.
const ACCENT_MARK_SET: ReadonlySet<string> = new Set(Object.keys(TEXIFY_ACCENTS));

/**
 * TeX -> Unicode dictionary keys that are NOT anchored on the "{\" prefix and therefore
 * cannot be reached by the "{\"-scanning loop in {@link detexify}. The plist contains
 * exactly one such entry — `{!'}` -> `¡` (inverted exclamation mark). In the original
 * `BDSKConverter`, `copyStringByDeTeXifyingString:` only searches for `{\\`, so this key
 * is effectively dead on detexify and `¡` is one-way there (texify produces `{!'}`, but
 * detexify never reconstructs `¡`).
 *
 * We deliberately handle these literal keys with a small pre-pass so that `¡` round-trips
 * (`detexify(texify('¡')) === '¡'`), strengthening the round-trip contract the codec is
 * specified to provide for representable characters. Sorted longest-first so longer keys
 * win over any (currently nonexistent) shorter prefixes.
 */
const LITERAL_DETEXIFY_ENTRIES: ReadonlyArray<readonly [string, string]> = Object.entries(
  DETEXIFY_DICTIONARY,
)
  .filter(([key]) => !key.startsWith('{\\'))
  .sort((a, b) => b[0].length - a[0].length);

// The dictionary keys are single-UTF-16-code-unit Unicode characters (BMP). We collect
// them into a Set so texify only attempts work on characters it can possibly convert,
// mirroring `finalCharacterSet`. We also include the algorithmically-decomposable Latin
// ranges so accented chars absent from the dictionary still get the accent treatment.
const TEXIFY_DICT_KEYS: ReadonlySet<string> = new Set(Object.keys(TEXIFY_DICTIONARY));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAsciiLetter(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
}

// Latin ranges that BibDesk's `finalCharacterSet` intersected with the decomposable set:
// Latin-1 Supplement / Latin Extended-A / Latin Extended-B (0x80..0x24F) and
// Latin Extended Additional (0x1E00..0x1EFF). We use this as a cheap gate before
// attempting the (more expensive) NFD decomposition path.
function isInLatinAccentRange(cp: number): boolean {
  return (cp >= 0x80 && cp <= 0x24f) || (cp >= 0x1e00 && cp <= 0x1eff);
}

// ---------------------------------------------------------------------------
// Algorithmic accent codec
// ---------------------------------------------------------------------------

/**
 * Convert a single composed Unicode character to its TeX accent form, e.g.
 *   "é" -> "{\'e}",  "Š" -> "{\v S}",  "í" -> "{\'\i}".
 * Returns `null` if the character is not a [a-zA-Z] base + a single known combining mark.
 *
 * Faithful port of `convertComposedCharacterToTeX`.
 */
export function texifyChar(composed: string): string | null {
  // decompose to canonical form (NFD)
  const decomposed = composed.normalize('NFD');
  const len = decomposed.length;

  // need a base [a-zA-Z] letter first
  if (len === 0) return null;
  const base = decomposed[0]!;
  if (!isAsciiLetter(base)) return null;

  // a bare base letter is a no-op (will essentially never happen here)
  if (len === 1) return base;

  // exactly base + one known combining mark; reject anything longer (BibDesk does too)
  if (len > 2) return null;
  const mark = decomposed[1]!;
  if (!ACCENT_MARK_SET.has(mark)) return null;

  const accent = TEXIFY_ACCENTS[mark]!; // e.g. "'", "v ", "c "

  // dotless i/j: \i \j are used with most accents, but NOT with the under-dot / cedilla /
  // under-bar / ogonek accents (c d b k), which sit below the letter and keep the dot.
  let character = base;
  if (
    (base === 'i' || base === 'j') &&
    accent !== 'c ' &&
    accent !== 'd ' &&
    accent !== 'b ' &&
    accent !== 'k '
  ) {
    character = '\\' + base;
  }

  return '{\\' + accent + character + '}';
}

/**
 * Convert a TeX accent span such as "{\'i}", "{\v S}" or "{\' i}" to its composed
 * Unicode character. Returns `null` if the span is not a convertible accent form
 * (the caller then falls back / leaves it untouched).
 *
 * Faithful port of `convertTeXStringToComposedCharacter`. The input is expected to be
 * a full "{\...}" span (including the braces).
 */
export function detexifyAccentSpan(span: string): string | null {
  const length = span.length;
  let idx = 0;

  // require "{\" prefix
  if (span[idx++] !== '{') return null;
  if (span[idx++] !== '\\') return null;

  const accentCh = span[idx++];
  if (accentCh === undefined) return null;

  const mark = DETEXIFY_ACCENTS[accentCh];
  if (mark === undefined) return null;

  // character immediately following the accent command
  let ch = span[idx];

  // if the accent command is itself a letter (e.g. {\v S}), it MUST be followed by a
  // space or backslash; "{\vS}" is invalid TeX and is rejected.
  if (isAsciiLetter(accentCh) && ch !== ' ' && ch !== '\\') return null;
  // TeX accepts both "{\' i}" and "{\'i}" — skip the optional single separating space.
  if (ch === ' ') idx++;

  const letterStart = idx;

  // scan to the closing brace; we don't know the base-letter length in advance.
  for (; idx < length; idx++) {
    ch = span[idx];
    if (ch !== '}') continue;

    let character = span.slice(letterStart, idx);

    // old-style dotless i/j: "\i"/"\j" lose the backslash for above-letter accents, but
    // keep it for the below-letter accents (c d b k) — matching the Obj-C special case.
    if (
      (character === '\\i' || character === '\\j') &&
      accentCh !== 'c' &&
      accentCh !== 'd' &&
      accentCh !== 'b' &&
      accentCh !== 'k'
    ) {
      character = character.slice(1);
    }

    if (character.length !== 1) return null;

    const composed = (character + mark).normalize('NFC');
    // must compose to a single character or we can't round-trip it back to TeX.
    if (composed.length !== 1) return null;
    return composed;
  }

  return null; // no closing brace
}

// ---------------------------------------------------------------------------
// texify: Unicode -> TeX
// ---------------------------------------------------------------------------

/**
 * Convert a Unicode string to TeX/LaTeX source (e.g. "é" -> "{\'e}").
 * Inverse of {@link detexify} for representable characters.
 *
 * Port of `copyStringByTeXifyingString:`. The input is NFC-normalized first (the plist
 * keys are precomposed). Each candidate character is tried against the dictionary, then
 * the algorithmic accent codec; anything else passes through untouched.
 */
export function texify(input: string): string {
  if (input.length === 0) return input;

  const precomposed = input.normalize('NFC');
  let out = '';

  // iterate by code point to keep astral chars / surrogate pairs intact
  for (const chPoint of precomposed) {
    // multi-code-unit code points (astral) can't be in our BMP tables; pass through.
    if (chPoint.length > 1) {
      out += chPoint;
      continue;
    }

    const ch = chPoint;
    const cp = ch.codePointAt(0)!;

    // dictionary first
    const dictHit = TEXIFY_DICTIONARY[ch];
    if (dictHit !== undefined) {
      out += dictHit;
      continue;
    }

    // only attempt the accent codec on plausible candidates (dict keys gate covered above;
    // here we gate the decomposition path on the Latin accent ranges, like finalCharacterSet).
    if (TEXIFY_DICT_KEYS.has(ch) || isInLatinAccentRange(cp)) {
      const accented = texifyChar(ch);
      if (accented !== null && accented !== ch) {
        out += accented;
        continue;
      }
    }

    out += ch;
  }

  return out;
}

// ---------------------------------------------------------------------------
// detexify: TeX -> Unicode
// ---------------------------------------------------------------------------

/**
 * Convert TeX/LaTeX source to Unicode (e.g. "{\'e}" -> "é").
 * Tolerant on input form: "{\'e}", "{\' e}" and (via the dictionary) the canonical
 * variants are all accepted. Inverse of {@link texify} for representable characters.
 *
 * Port of `copyStringByDeTeXifyingString:`. Scans for "{\" spans, finds the next "}",
 * and tries the dictionary then the algorithmic accent codec on the enclosed span.
 * On a failed span the search advances by one character (so a non-matching "{\" is not
 * retried), and an unbalanced/missing brace bails out leaving the remainder untouched.
 *
 * A small pre-pass first handles literal dictionary keys that are not "{\"-anchored
 * (currently only `{!'}` -> `¡`), which BibDesk's "{\"-only scanner could not reach;
 * this makes `¡` round-trip. See LITERAL_DETEXIFY_ENTRIES.
 */
export function detexify(input: string): string {
  if (input.length === 0) return input;

  let working = input;
  let convertedLiteral = false;

  // Pre-pass: literal dictionary keys that are not "{\"-anchored (currently only `{!'}`),
  // which the "{\"-scanning loop below cannot see. See LITERAL_DETEXIFY_ENTRIES.
  for (const [key, value] of LITERAL_DETEXIFY_ENTRIES) {
    if (working.indexOf(key) !== -1) {
      working = working.split(key).join(value);
      convertedLiteral = true;
    }
  }

  // fast path: nothing that looks like a TeX accent/command group.
  if (working.indexOf('{\\') === -1) return convertedLiteral ? working : input;

  let result = working;
  let searchFrom = 0;
  let converted = false;

  // re-find from the current position each iteration; lengths shift as we replace.
  let openIdx = result.indexOf('{\\', searchFrom);

  while (openIdx !== -1) {
    const spanStart = openIdx;
    const closeIdx = result.indexOf('}', spanStart + 2);

    if (closeIdx === -1) {
      // missing closing brace: bail (the Obj-C original logs and stops here).
      break;
    }

    const span = result.slice(spanStart, closeIdx + 1); // includes "{\" ... "}"

    let replacement: string | null = null;
    const dictHit = DETEXIFY_DICTIONARY[span];
    if (dictHit !== undefined) {
      replacement = dictHit;
    } else {
      replacement = detexifyAccentSpan(span);
    }

    if (replacement !== null) {
      result = result.slice(0, spanStart) + replacement + result.slice(closeIdx + 1);
      converted = true;
      // continue searching from just after the start of the replaced region; advancing
      // by one char avoids re-matching a "{\" that failed (matches the Obj-C +1 advance).
      searchFrom = spanStart + 1;
    } else {
      // failed conversion: advance one char so we don't loop on the same "{\".
      searchFrom = spanStart + 1;
    }

    openIdx = result.indexOf('{\\', searchFrom);
  }

  return converted || convertedLiteral ? result : input;
}
