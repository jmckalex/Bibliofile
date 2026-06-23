/**
 * Unicode/TeX string transforms used by the cite-key + auto-file sanitizers.
 *
 * Ports the relevant `NSString (BDSKExtensions)` methods:
 *   - `lossyASCIIString`              -> {@link lossyASCII}
 *   - `replaceComposedCharacters`     -> {@link replaceComposedCharacters}
 *   - `stringByRemovingCurlyBraces`   -> {@link removeCurlyBraces}
 *   - `acronymValueIgnoringWordLength:` -> {@link acronym}
 *
 * De-TeXification (`stringByDeTeXifyingString`, `stringByRemovingTeX`) is
 * delegated to `@bibdesk/tex`'s `detexify`, re-exported via `@bibdesk/names`.
 */

import { detexify } from '@bibdesk/names';

/**
 * The 48-entry composed-character map from `CFString_BDSKExtensions.m`
 * `__BDReplaceComposedCharacters`. Maps ligatures / special letters with no NFD
 * decomposition to ASCII equivalents. Applied AFTER combining-mark stripping.
 */
const COMPOSED_CHAR_MAP: ReadonlyMap<number, string> = new Map<number, string>([
  [0x0132, 'IJ'],
  [0x0133, 'ij'],
  [0x0198, 'AE'], // BibDesk maps U+0198 (Ƙ) to "AE" verbatim; ported as-is.
  [0x00e6, 'ae'],
  [0x0152, 'OE'],
  [0x0153, 'oe'],
  [0xa74e, 'OO'],
  [0xa74f, 'oo'],
  [0xa732, 'AA'],
  [0xa733, 'aa'],
  [0xa734, 'AO'],
  [0xa735, 'ao'],
  [0xa736, 'AU'],
  [0xa737, 'au'],
  [0xa738, 'AV'],
  [0xa739, 'av'],
  [0xa73a, 'AV'],
  [0xa73b, 'av'],
  [0xa73c, 'AY'],
  [0xa73d, 'ay'],
  [0xa728, 'TZ'],
  [0xa729, 'tz'],
  [0xa760, 'VY'],
  [0xa761, 'vy'],
  [0x1d6b, 'ue'],
  [0xfb00, 'ff'],
  [0xfb01, 'fi'],
  [0xfb02, 'fl'],
  [0xfb03, 'ffi'],
  [0xfb04, 'ffl'],
  [0x1e9e, 'SS'],
  [0x00df, 'ss'],
  [0xfb05, 'it'],
  [0xfb06, 'st'],
  [0x00d8, 'O'],
  [0x00f8, 'o'],
  [0x0110, 'D'],
  [0x0111, 'd'],
  [0x0126, 'H'],
  [0x0127, 'h'],
  [0x0140, 'L'],
  [0x0141, 'l'],
  [0x0166, 'T'],
  [0x0167, 't'],
  [0x00d0, 'D'],
  [0x00f0, 'd'],
  [0x00de, 'TH'],
  [0x00fe, 'th'],
]);

/** Matches Unicode combining marks (the `kCFStringTransformStripCombiningMarks`). */
const COMBINING_MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;

/**
 * Strip combining marks (decompose with NFD, then drop combining marks), then
 * apply the composed-character ligature map. Mirrors
 * `NSString.stringByReplacingComposedCharacters` /
 * `__BDReplaceComposedCharacters`.
 */
export function replaceComposedCharacters(s: string): string {
  // NFD then strip combining marks => "remove all accents"
  const stripped = s.normalize('NFD').replace(COMBINING_MARKS, '');
  // map remaining ligatures/special letters
  let out = '';
  for (const ch of stripped) {
    const repl = COMPOSED_CHAR_MAP.get(ch.codePointAt(0)!);
    out += repl ?? ch;
  }
  return out;
}

/** Quick check: does the string contain only ASCII (code units < 128)? */
function isPureASCII(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

/**
 * Transliterate to ASCII, lossily. Mirrors `NSString.lossyASCIIString`:
 *   1. If already representable as ASCII, return unchanged.
 *   2. Otherwise transliterate to Latin + strip combining marks (NFKD here as a
 *      close approximation to `kCFStringTransformToLatin` for the Latin-script
 *      cases BibDesk cares about), apply the ligature map, then drop any
 *      remaining non-ASCII code unit (the final lossy ASCII conversion).
 *
 * Note: full ICU `Any-Latin` transliteration (Greek/Cyrillic/CJK) is not
 * reproducible without ICU; for Latin-script accented text — the dominant
 * cite-key case — NFKD + combining-mark stripping + the ligature map matches
 * BibDesk. Non-Latin code points are dropped (lossy), as BibDesk's final
 * `allowLossyConversion:YES` ASCII step also drops them.
 */
export function lossyASCII(s: string): string {
  if (isPureASCII(s)) return s;
  // transliterate-ish: NFKD folds compatibility forms (e.g. ﬁ -> fi, ① -> 1),
  // then strip combining marks.
  const decomposed = s.normalize('NFKD').replace(COMBINING_MARKS, '');
  let out = '';
  for (const ch of decomposed) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0x7f) {
      out += ch;
      continue;
    }
    const mapped = COMPOSED_CHAR_MAP.get(cp);
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    // drop any remaining non-ASCII code point (lossy)
  }
  return out;
}

/**
 * Remove unescaped curly braces. Mirrors `stringByRemovingCurlyBraces`
 * (`deleteUnescapedCharactersInCharacterSet:` over `{}`): a brace preceded by a
 * backslash is kept (escaped); otherwise it is removed.
 */
export function removeCurlyBraces(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '{' || ch === '}') {
      const escaped = i > 0 && s[i - 1] === '\\';
      if (!escaped) continue;
    }
    out += ch;
  }
  return out;
}

/**
 * De-TeXify a string (TeX/LaTeX accents/commands -> Unicode). Thin wrapper over
 * `@bibdesk/names` `detexify` (which itself wraps `@bibdesk/tex`). Matches
 * `stringByDeTeXifyingString`.
 */
export function deTeXify(s: string): string {
  return detexify(s);
}

/**
 * Strip structural TeX/LaTeX markup so a value is safe + readable in a filename:
 * math-mode `$…$` delimiters, command backslashes (`\log` → `log`, keeping the
 * word), and grouping braces. Run AFTER {@link deTeXify} (which turns
 * `{\'e}`-style accent spans into Unicode), so only plain markup remains here.
 * Example: `$O(\log n)$` → `O(log n)`. Used for local-file (AutoFile) names,
 * where macOS otherwise happily keeps `$`/`\` and produces an ugly filename.
 */
export function removeTeX(s: string): string {
  if (!/[$\\{}]/.test(s)) return s; // fast path: nothing TeX-like
  return s
    .replace(/\\([a-zA-Z]+)/g, '$1') // \log → log (keep the command word)
    .replace(/[${}\\]/g, ''); // math delimiters, braces, residual backslash-escapes
}

/**
 * Acronym value: first letter of each space-separated word longer than
 * `ignoreLength` (a trailing-period word always counts), uppercased and
 * concatenated. Mirrors `acronymValueIgnoringWordLength:`.
 */
export function acronym(s: string, ignoreLength = 3): string {
  let result = '';
  for (const raw of s.split(' ')) {
    let currentIgnore = ignoreLength;
    let component = raw;
    if (component !== '') component = component.trim();
    if (component.length > 1 && component[component.length - 1] === '.') {
      currentIgnore = 0;
    }
    if (component !== '') {
      // trim leading/trailing non-alphanumerics
      component = trimNonAlphanumeric(component);
    }
    if (component.length > currentIgnore) {
      result += component.charAt(0).toUpperCase();
    }
  }
  return result;
}

function isAlphanumeric(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

function trimNonAlphanumeric(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && !isAlphanumeric(s[start]!)) start++;
  while (end > start && !isAlphanumeric(s[end - 1]!)) end--;
  return s.slice(start, end);
}

/**
 * Collapse runs of whitespace to a single space and trim ends. Mirrors
 * `stringByCollapsingWhitespaceAndRemovingSurroundingWhitespace`.
 */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
