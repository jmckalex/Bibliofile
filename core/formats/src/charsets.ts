/**
 * Per-field invalid-character sets, ported verbatim from `BDSKTypeManager.m`
 * (initializer, lines 146-189). Each set is expressed as a predicate over a
 * UTF-16 code unit (`number`) plus the field-kind classification BibDesk uses
 * to pick which set applies.
 *
 * Three strictness levels exist, exactly as in BibDesk:
 *   - **invalid** (`invalidCharactersForField:`)        — manual-entry warning set.
 *   - **strict**  (`strictInvalidCharactersForField:`)  — used for generated keys/urls.
 *   - **veryStrict** (`veryStrictInvalidCharactersForField:`) — generated local files,
 *     adds Windows-incompatible filename chars.
 *
 * A "char set" here is the set of *invalid* characters (the thing BibDesk
 * strips). `isInvalidX(c)` returns true when code unit `c` must be removed.
 */

/** Which family of invalid-char sets applies to a field. */
export type FieldKind = 'citeKey' | 'localFile' | 'remoteURL' | 'general';

// --- Cite key ---------------------------------------------------------------

/**
 * invalidCiteKeyCharSet (BDSKTypeManager.m:149-152):
 *   start from printable ASCII [32,126) i.e. 32..125, remove the explicit
 *   "valid" punctuation, then INVERT. The invalid set is therefore: everything
 *   outside printable ASCII 32..125, plus the explicitly-forbidden punctuation
 *   ` '"@,\#}{~%()=` (note: a literal space is in the forbidden list).
 *
 *   NB BibDesk's range is `characterSetWithRange:NSMakeRange(32, 126-32)` =
 *   locations 32..125 inclusive (126 `~` is NOT in the base "valid" range, but
 *   `~` is also in the removed list, so it stays invalid either way).
 */
const CITEKEY_ALLOWED_PUNCT_REMOVED = new Set<number>(
  [..." '\"@,\\#}{~%()="].map((c) => c.charCodeAt(0)),
);

export function isInvalidCiteKeyChar(c: number): boolean {
  // base "valid" range is 32..125 inclusive
  const inPrintableBase = c >= 32 && c <= 125;
  if (!inPrintableBase) return true; // non-ASCII / control => invalid
  // within base, the removed punctuation is invalid
  return CITEKEY_ALLOWED_PUNCT_REMOVED.has(c);
}

/**
 * fragileCiteKeyCharSet (BDSKTypeManager.m:154): `&$^`. These are valid but
 * "fragile" in TeX — BibDesk warns (recoverable) but does not strip them.
 */
const FRAGILE_CITEKEY = new Set<number>([..."&$^"].map((c) => c.charCodeAt(0)));
export function isFragileCiteKeyChar(c: number): boolean {
  return FRAGILE_CITEKEY.has(c);
}

/**
 * strictInvalidCiteKeyCharSet (BDSKTypeManager.m:156-161): the *valid* set is
 *   a-z, A-Z, and the 15 characters starting at '-' (0x2D): `-./0123456789:;`
 *   (range `NSMakeRange('-', 15)` = code units 45..59). Inverted => the strict
 *   invalid set. This is what GENERATED cite keys are stripped against.
 */
export function isStrictInvalidCiteKeyChar(c: number): boolean {
  const isAlpha = (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a);
  const isDashRange = c >= 0x2d && c <= 0x3b; // '-' .. ';' (45..59)
  return !(isAlpha || isDashRange);
}

// --- Local file / URL -------------------------------------------------------

/**
 * invalidLocalUrlCharSet (BDSKTypeManager.m:164): just `:`.
 * strictInvalidLocalUrlCharSet is a copy of the same (line 167).
 */
const COLON = ':'.charCodeAt(0);
export function isInvalidLocalUrlChar(c: number): boolean {
  return c === COLON;
}
export const isStrictInvalidLocalUrlChar = isInvalidLocalUrlChar;

/**
 * veryStrictInvalidLocalUrlCharSet (BDSKTypeManager.m:169-173): control chars
 *   1..31 plus `?<>\:*|"` — i.e. Windows-incompatible filename characters
 *   (the `:` from the base set is implicitly included via the explicit list).
 */
const VERY_STRICT_LOCAL_FILE_EXTRA = new Set<number>(
  [...'?<>\\:*|"'].map((c) => c.charCodeAt(0)),
);
export function isVeryStrictInvalidLocalUrlChar(c: number): boolean {
  if (c >= 1 && c <= 31) return true;
  return VERY_STRICT_LOCAL_FILE_EXTRA.has(c);
}

// --- Remote URL -------------------------------------------------------------

/**
 * invalidRemoteUrlCharSet (BDSKTypeManager.m:176-182): the *valid* set is the
 *   URI-permitted characters: a-z A-Z 0-9 and `-._~:/?#[]@!$&'()*+,;=`. Inverted
 *   => the invalid set. strictInvalidRemoteUrlCharSet is the same object.
 */
const REMOTE_URL_VALID_PUNCT = new Set<number>(
  [..."-._~:/?#[]@!$&'()*+,;="].map((c) => c.charCodeAt(0)),
);
export function isInvalidRemoteUrlChar(c: number): boolean {
  const isAlnum =
    (c >= 0x61 && c <= 0x7a) ||
    (c >= 0x41 && c <= 0x5a) ||
    (c >= 0x30 && c <= 0x39);
  if (isAlnum) return false;
  return !REMOTE_URL_VALID_PUNCT.has(c);
}
export const isStrictInvalidRemoteUrlChar = isInvalidRemoteUrlChar;

// --- General (no restriction) -----------------------------------------------

export function isInvalidGeneralChar(_c: number): boolean {
  return false;
}

// --- Selection by field kind ------------------------------------------------

/** A predicate matching one code unit against an invalid-char set. */
export type CharPredicate = (c: number) => boolean;

/** Pick the `invalidCharactersForField:` predicate for a field kind. */
export function invalidCharsForKind(kind: FieldKind): CharPredicate {
  switch (kind) {
    case 'citeKey':
      return isInvalidCiteKeyChar;
    case 'localFile':
      return isInvalidLocalUrlChar;
    case 'remoteURL':
      return isInvalidRemoteUrlChar;
    default:
      return isInvalidGeneralChar;
  }
}

/** Pick the `strictInvalidCharactersForField:` predicate for a field kind. */
export function strictInvalidCharsForKind(kind: FieldKind): CharPredicate {
  switch (kind) {
    case 'citeKey':
      return isStrictInvalidCiteKeyChar;
    case 'localFile':
      return isStrictInvalidLocalUrlChar;
    case 'remoteURL':
      return isStrictInvalidRemoteUrlChar;
    default:
      return isInvalidGeneralChar;
  }
}

/** Pick the `veryStrictInvalidCharactersForField:` predicate for a field kind. */
export function veryStrictInvalidCharsForKind(kind: FieldKind): CharPredicate {
  if (kind === 'localFile') return isVeryStrictInvalidLocalUrlChar;
  return strictInvalidCharsForKind(kind);
}

/** Remove every code unit matching `pred` from `s`. */
export function stripChars(s: string, pred: CharPredicate): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (!pred(s.charCodeAt(i))) out += s[i];
  }
  return out;
}

/** Replace every code unit matching `pred` with `replacement`. */
export function replaceChars(
  s: string,
  pred: CharPredicate,
  replacement: string,
): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    out += pred(s.charCodeAt(i)) ? replacement : s[i];
  }
  return out;
}
