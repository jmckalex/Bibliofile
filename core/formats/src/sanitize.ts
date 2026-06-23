/**
 * Field sanitizers — ports of `BDSKFormatParser`
 *   `stringBySanitizingString:forField:`        -> {@link sanitize}
 *   `stringByStrictlySanitizingString:forField:` -> {@link strictlySanitize}
 *
 * Plus the public cite-key / filename cleaning + validation helpers.
 */

import type { TypeManager } from '@bibdesk/model';
import {
  type FieldKind,
  invalidCharsForKind,
  strictInvalidCharsForKind,
  veryStrictInvalidCharsForKind,
  isInvalidCiteKeyChar,
  isFragileCiteKeyChar,
  stripChars,
  replaceChars,
} from './charsets.js';
import {
  deTeXify,
  removeTeX,
  removeCurlyBraces,
  replaceComposedCharacters,
  lossyASCII,
} from './transforms.js';

/** Special field-name sentinels matching BibDesk's `BDSKStringConstants`. */
export const CITE_KEY_FIELD = 'Cite Key';
export const LOCAL_FILE_FIELD = 'Local-Url';
export const REMOTE_URL_FIELD = 'Url';

/**
 * Cite-key cleaning option (`BDSKCiteKeyCleanOptionKey`):
 *   0 = none, 1 = remove braces, 2 = remove TeX.
 */
export type CiteKeyCleanOption = 0 | 1 | 2;

/**
 * Local-file cleaning option (`BDSKLocalFileCleanOptionKey`):
 *   0 = none, 1 = remove braces, 2 = remove TeX,
 *   3 = remove TeX + very-strict char set, 4 = remove TeX + lossy ASCII + very-strict.
 */
export type LocalFileCleanOption = 0 | 1 | 2 | 3 | 4;

/** Whitespace/newline code units (NSCharacterSet whitespaceAndNewlineCharacterSet, the common subset). */
const WHITESPACE_NEWLINE = /[\s\u00a0\u2028\u2029]/g;

/**
 * Classify a field name into the family of char sets that applies. Uses the
 * (model) {@link TypeManager} for the local-file/remote-URL membership tests,
 * exactly like `BDSKTypeManager invalidCharactersForField:`.
 */
export function fieldKind(
  fieldName: string,
  typeManager: TypeManager,
): FieldKind {
  if (fieldName === CITE_KEY_FIELD) return 'citeKey';
  if (
    typeManager.isLocalFileField(fieldName) ||
    fieldName === LOCAL_FILE_FIELD
  ) {
    return 'localFile';
  }
  if (
    typeManager.isRemoteURLField(fieldName) ||
    fieldName === REMOTE_URL_FIELD
  ) {
    return 'remoteURL';
  }
  return 'general';
}

function isGeneralLocalFile(fieldName: string, tm: TypeManager): boolean {
  return tm.isLocalFileField(fieldName) || fieldName === LOCAL_FILE_FIELD;
}
function isGeneralRemoteURL(fieldName: string, tm: TypeManager): boolean {
  return tm.isRemoteURLField(fieldName) || fieldName === REMOTE_URL_FIELD;
}

/**
 * Mirror of BibDesk's `+[NSString isEmptyString:]`: true only for nil / the
 * empty string. A whitespace-only string is NOT empty (this matters: `%T`
 * sanitizes a literal " " separator into "-" for cite keys).
 */
function isEmpty(s: string | undefined | null): boolean {
  return s === undefined || s === null || s.length === 0;
}

/**
 * `stringBySanitizingString:forField:` — the milder cleaning used for old
 * filenames / document filenames (the `%l/%L/%e/%E/%b` specifiers).
 *
 *   cite key:   deTeXify, replaceComposedCharacters, whitespace->'-', strip invalid
 *   local file: deTeXify, strip invalid
 *   remote URL: deTeXify, replaceComposedCharacters, strip invalid
 *   general:    strip invalid
 */
export function sanitize(
  s: string,
  fieldName: string,
  tm: TypeManager,
): string {
  const kind = fieldKind(fieldName, tm);
  if (fieldName === CITE_KEY_FIELD) {
    if (isEmpty(s)) return '';
    let out = deTeXify(s);
    out = replaceComposedCharacters(out);
    out = out.replace(WHITESPACE_NEWLINE, '-');
    out = stripChars(out, invalidCharsForKind('citeKey'));
    return out;
  }
  if (isGeneralLocalFile(fieldName, tm)) {
    if (isEmpty(s)) return '';
    let out = deTeXify(s);
    out = removeTeX(out); // strip $…$, \commands, braces — never wanted in a filename
    out = stripChars(out, invalidCharsForKind('localFile'));
    return out;
  }
  if (isGeneralRemoteURL(fieldName, tm)) {
    if (isEmpty(s)) return '';
    let out = deTeXify(s);
    out = replaceComposedCharacters(out);
    out = stripChars(out, invalidCharsForKind('remoteURL'));
    return out;
  }
  // general
  return stripChars(s, invalidCharsForKind(kind));
}

/** Options consumed by {@link strictlySanitize} (mirror the relevant prefs). */
export interface StrictSanitizeOptions {
  citeKeyCleanOption?: CiteKeyCleanOption;
  localFileCleanOption?: LocalFileCleanOption;
}

/**
 * `stringByStrictlySanitizingString:forField:` — the aggressive cleaning used
 * for the generated content of every value-bearing specifier (`%a/%t/%f` etc.).
 *
 *   cite key:   deTeXify, [removeBraces|removeTeX], replaceComposed, ws->'-',
 *               lossyASCII, strip STRICT invalid
 *   local file: deTeXify, [removeBraces|removeTeX(+lossyASCII)], strip invalid
 *               (very-strict set when cleanOption>=3)
 *   remote URL: deTeXify, lossyASCII, removeTeX, replaceComposed, strip STRICT invalid
 *   general:    strip STRICT invalid (empty set => unchanged)
 */
export function strictlySanitize(
  s: string,
  fieldName: string,
  tm: TypeManager,
  opts: StrictSanitizeOptions = {},
): string {
  if (isEmpty(s)) return '';

  if (fieldName === CITE_KEY_FIELD) {
    const clean = opts.citeKeyCleanOption ?? 0;
    let out = deTeXify(s);
    if (clean === 1) out = removeCurlyBraces(out);
    else if (clean === 2) out = deTeXify(out); // removeTeX ~ deTeXify here
    out = replaceComposedCharacters(out);
    out = out.replace(WHITESPACE_NEWLINE, '-');
    out = lossyASCII(out);
    out = stripChars(out, strictInvalidCharsForKind('citeKey'));
    return out;
  }

  if (isGeneralLocalFile(fieldName, tm)) {
    const clean = opts.localFileCleanOption ?? 0;
    const pred =
      clean >= 3
        ? veryStrictInvalidCharsForKind('localFile')
        : strictInvalidCharsForKind('localFile');
    let out = deTeXify(s); // {\'e} accent spans -> Unicode
    // Always strip structural TeX markup ($…$, \commands, braces) — a filename
    // should never contain raw LaTeX (e.g. a title `$O(\log n)$` -> `O(log n)`).
    out = removeTeX(out);
    if (clean === 4) out = lossyASCII(out);
    out = stripChars(out, pred);
    return out;
  }

  if (isGeneralRemoteURL(fieldName, tm)) {
    // NB: BibDesk's source rebinds `newString = [string ...]` here (a known
    // quirk where intermediate results are discarded); we follow the *effective*
    // pipeline: deTeXify -> replaceComposed -> strip STRICT invalid.
    let out = deTeXify(s);
    out = replaceComposedCharacters(out);
    out = stripChars(out, strictInvalidCharsForKind('remoteURL'));
    return out;
  }

  // general: strict general char set is empty => unchanged
  return s;
}

// --- public cite-key / filename helpers ------------------------------------

/**
 * Clean an arbitrary string into a valid GENERATED cite key (strict set),
 * applying the same transforms as auto-generation.
 */
export function cleanForCiteKey(
  s: string,
  tm: TypeManager,
  opts: StrictSanitizeOptions = {},
): string {
  return strictlySanitize(s, CITE_KEY_FIELD, tm, opts);
}

/**
 * Clean a string for use as a generated local filename component (strict /
 * optionally very-strict via `localFileCleanOption`).
 */
export function cleanForFilename(
  s: string,
  tm: TypeManager,
  opts: StrictSanitizeOptions = {},
): string {
  return strictlySanitize(s, LOCAL_FILE_FIELD, tm, opts);
}

/**
 * True if `key` contains only characters valid for MANUAL cite-key entry
 * (`invalidCiteKeyCharSet`). Mirrors the `BDSKCiteKeyFormatter` accept set:
 * printable ASCII minus `` space '"@,\#}{~%()= ``. Empty keys are invalid.
 */
export function isValidCiteKey(key: string): boolean {
  if (key.length === 0) return false;
  for (let i = 0; i < key.length; i++) {
    if (isInvalidCiteKeyChar(key.charCodeAt(i))) return false;
  }
  return true;
}

/** True if the cite key contains any "fragile" TeX character (`&$^`). */
export function citeKeyHasFragileChars(key: string): boolean {
  for (let i = 0; i < key.length; i++) {
    if (isFragileCiteKeyChar(key.charCodeAt(i))) return true;
  }
  return false;
}

/** Strip every character invalid for manual cite-key entry (live filtering). */
export function filterCiteKeyInput(key: string): string {
  return stripChars(key, isInvalidCiteKeyChar);
}

/** Whitespace-and-newline code units, as a predicate (no shared regex state). */
function isWhitespaceOrNewline(c: number): boolean {
  return (
    c === 0x20 || // space
    c === 0x09 || // tab
    c === 0x0a || // LF
    c === 0x0d || // CR
    c === 0x0c || // FF
    c === 0x0b || // VT
    c === 0xa0 || // NBSP
    c === 0x2028 || // line separator
    c === 0x2029 // paragraph separator
  );
}

/** Replace whitespace with `-` then strip invalid manual cite-key chars. */
export function manualCleanCiteKey(key: string): string {
  return filterCiteKeyInput(replaceChars(key, isWhitespaceOrNewline, '-'));
}
