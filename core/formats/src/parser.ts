/**
 * `BDSKFormatParser` — the cite-key + auto-file format mini-language.
 *
 * Faithful port of `BDSKFormatParser.m`'s
 * `parseFormat:forField:linkedFile:ofItem:` plus the unique-string generator,
 * `hashedField`, `scanOptArg`, and `scanSignedDigit`.
 *
 * The original couples to NSURL/file-system checks (for local-file naming) and
 * to a publications collection (for cite-key uniqueness). Here those are
 * injected through {@link ParseOptions} as pure callbacks so the package stays
 * platform-agnostic: `existingCiteKeyOwner` plays the role of
 * `validCiteKey()`, and `fileExists` plays the role of the local-file
 * reachability check.
 */

import type { BibItem, TypeManager } from '@bibdesk/model';
import { Scanner, isDigit } from './scanner.js';
import {
  CITE_KEY_FIELD,
  LOCAL_FILE_FIELD,
  strictlySanitize,
  sanitize,
  type StrictSanitizeOptions,
} from './sanitize.js';
import { crc32 } from './crc32.js';
import { replaceComposedCharacters, collapseWhitespace } from './transforms.js';

/** A pseudo-random source for `%r`/`%R`/`%d` (deterministic for tests). */
export type RandomFn = () => number;

/** Options controlling format evaluation. */
export interface ParseOptions extends StrictSanitizeOptions {
  /** The type manager (defaults to the item's). */
  typeManager?: TypeManager;
  /** Lowercase the whole generated key/filename (`BDSKCiteKeyLowercaseKey`). */
  lowercase?: boolean;
  /** Random source for `%r`/`%R`/`%d`; defaults to `Math.random`. */
  random?: RandomFn;
  /**
   * Resolve `%f{Cite Key}` / `%f{...}` against another item's already-set cite
   * key etc. The default reads from the item itself.
   */
  documentFilename?: string;
  /** Document-info lookup for `%i{key}` (BibDesk `documentInfoForKey:`). */
  documentInfo?: (key: string) => string | undefined;
  /**
   * For cite-key uniqueness: given a candidate cite key, return it if no OTHER
   * item already owns it (i.e. it is unique/available), else return undefined.
   * Mirrors `validCiteKey()`. If omitted, every candidate is considered
   * available (no collision checking).
   */
  citeKeyAvailable?: (candidate: string) => boolean;
  /**
   * For local-file uniqueness: return true if a file already exists at the
   * (relative) path, so the generator must keep searching. If omitted, no path
   * is considered to exist.
   */
  fileExists?: (relativePath: string) => boolean;
  /** The item's current cite key (used by the `currentString` short-circuit). */
  currentCiteKey?: string;
  /** Hint that we are generating a cite key (default inferred from field). */
}

interface EvalState {
  item: BibItem;
  tm: TypeManager;
  fieldName: string;
  isCiteKey: boolean;
  isLocalFile: boolean;
  opts: ParseOptions;
  random: RandomFn;
}

/** Result of the optional-argument scan. */
interface OptArg {
  value: string;
  lastCharEscaped: boolean;
}

const SLASH_PRED = (c: number) => c === 0x2f; // '/'

// --- scanOptArg / scanSignedDigit -------------------------------------------

/** optArgStopChars = `%]`. */
function isOptArgStop(c: number): boolean {
  return c === 0x25 /* % */ || c === 0x5d /* ] */;
}

/**
 * Port of `scanOptArg`. If the next char is `[`, scan a `[...]` argument
 * (honoring `%x` escapes inside it) and return it; else return undefined.
 */
function scanOptArg(scanner: Scanner): OptArg | undefined {
  if (!scanner.scanString('[')) return undefined;
  let tmp: string | null = null;
  let str = '';
  let wasEscaped = false;
  for (;;) {
    const scanned = scanner.scanUpToCharacters(isOptArgStop);
    if (scanned !== undefined) {
      str = scanned;
      if (tmp !== null) {
        tmp += scanned;
        wasEscaped = false;
      }
    } else {
      str = '';
    }
    if (!scanner.scanString('%')) break;
    const esc = scanner.scanCharacter();
    if (esc === undefined) break;
    if (tmp === null) tmp = scanned ?? '';
    tmp += String.fromCharCode(esc);
    wasEscaped = true;
  }
  const value = tmp !== null ? tmp : str;
  scanner.scanString(']');
  return { value, lastCharEscaped: wasEscaped };
}

interface SignedDigit {
  digit: number;
  negative: boolean;
}

/** Port of `scanSignedDigit`: an optional `-` then a single digit 0-9. */
function scanSignedDigit(scanner: Scanner): SignedDigit | undefined {
  let isNeg = false;
  let next = scanner.peek();
  if (next === -1) return undefined;
  if (next === 0x2d /* - */) {
    scanner.location = scanner.location + 1;
    const after = scanner.peek();
    if (after !== -1 && isDigit(after)) {
      isNeg = true;
      next = after;
    } else {
      scanner.location = scanner.location - 1;
      next = 0x2d;
    }
  }
  if (isDigit(next)) {
    scanner.location = scanner.location + 1;
    return { digit: next - 0x30, negative: isNeg };
  }
  return undefined;
}

// --- main entry -------------------------------------------------------------

/**
 * Evaluate a format string for an item and field. Returns the generated string
 * (for local-file fields this is the relative path component; the original
 * prepends the papers folder, which this platform-agnostic version omits).
 */
export function parseFormat(
  format: string,
  item: BibItem,
  fieldName: string = CITE_KEY_FIELD,
  opts: ParseOptions = {},
): string {
  const tm = opts.typeManager ?? item.typeManager;
  const isCiteKey = fieldName === CITE_KEY_FIELD;
  const isLocalFile =
    tm.isLocalFileField(fieldName) || fieldName === LOCAL_FILE_FIELD;
  const state: EvalState = {
    item,
    tm,
    fieldName,
    isCiteKey,
    isLocalFile,
    opts,
    random: opts.random ?? Math.random,
  };

  const scanner = new Scanner(format);
  let parsed = '';
  let baseParsed: string | null = null;
  let uniqueNumber = 0;
  let uniqueSpecifier = 0; // 0 means none; 'u'/'U'/'n' as code units
  let uniquePrefix: string | null = null;
  let uniqueSuffix: string | null = null;
  let isUniversal = false;

  while (!scanner.isAtEnd()) {
    const text = scanner.scanUpToString('%');
    if (text !== undefined) parsed += text;
    scanner.scanString('%');
    const spec = scanner.scanCharacter();
    if (spec === undefined) continue;

    const s = String.fromCharCode(spec);
    switch (s) {
      case 'a':
      case 'p':
        parsed += evalAuthors(scanner, state, spec === 0x70 /* p */);
        break;
      case 'A':
      case 'P':
        parsed += evalAuthorsWithInitials(
          scanner,
          state,
          spec === 0x50 /* P */,
        );
        break;
      case 't':
        parsed += evalTitleChars(scanner, state);
        break;
      case 'T':
        parsed += evalTitleWords(scanner, state);
        break;
      case 'y':
        parsed += evalYear(state, false);
        break;
      case 'Y':
        parsed += evalYear(state, true);
        break;
      case 'm':
        parsed += evalMonth(state);
        break;
      case 'k':
        parsed += evalKeywords(scanner, state);
        break;
      case 'l':
        parsed += evalOldFilename(state, 'noExt');
        break;
      case 'L':
        parsed += evalOldFilename(state, 'withExt');
        break;
      case 'e':
        parsed += evalOldFilename(state, 'extDot');
        break;
      case 'E':
        parsed += evalOldFilename(state, 'extPlain', scanOptArg(scanner)?.value);
        break;
      case 'b':
        parsed += evalDocumentFilename(state);
        break;
      case 'f':
        parsed += evalField(scanner, state);
        break;
      case 'w':
        parsed += evalWords(scanner, state);
        break;
      case 'c':
        parsed += evalAcronym(scanner, state);
        break;
      case 's':
        parsed += evalBoolean(scanner, state);
        break;
      case 'i':
        parsed += evalDocumentInfo(scanner, state);
        break;
      case 'r':
        parsed += evalRandom(scanner, state, 'a', 26);
        break;
      case 'R':
        parsed += evalRandom(scanner, state, 'A', 26);
        break;
      case 'd':
        parsed += evalRandom(scanner, state, '0', 10);
        break;
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
      case '%':
      case '[':
      case ']':
      case '-':
        parsed += s;
        break;
      case 'u':
      case 'U':
      case 'n': {
        if (uniqueSpecifier === 0) {
          uniqueSpecifier = spec;
          baseParsed = parsed;
          const pfx = scanOptArg(scanner);
          const sfx = pfx ? scanOptArg(scanner) : undefined;
          uniquePrefix = pfx ? pfx.value : null;
          uniqueSuffix = sfx ? sfx.value : null;
          const n = scanner.scanUnsignedInteger();
          uniqueNumber = n === undefined ? 1 : n;
          // prefix/suffix useful only for n=0; for n>0 they name a field to
          // hash (kept verbatim as the field name).
          if (uniquePrefix !== null && uniquePrefix.length === 0)
            uniquePrefix = null;
          if (uniqueSuffix !== null && uniqueSuffix.length === 0)
            uniqueSuffix = null;
          parsed = '';
          isUniversal = uniqueNumber === 2 && format.startsWith('%a1:%Y%u[');
        }
        break;
      }
      default:
        // unknown specifier: ignored (BibDesk logs and drops it)
        break;
    }
  }

  // global lowercasing
  if (opts.lowercase) {
    parsed = parsed.toLowerCase();
    if (baseParsed !== null) baseParsed = baseParsed.toLowerCase();
    if (uniqueSpecifier === 0x55 /* U */) uniqueSpecifier = 0x75; // -> 'u'
  }

  if (isLocalFile && baseParsed !== null) {
    while (baseParsed.startsWith('/')) baseParsed = baseParsed.slice(1);
  }

  // never return empty for cite key / local file: force a numeric uniquifier
  if (
    parsed.length === 0 &&
    (baseParsed === null || baseParsed.length === 0) &&
    uniqueSpecifier === 0
  ) {
    uniqueSpecifier = 0x6e; // 'n'
    baseParsed = '';
  }

  if (uniqueSpecifier !== 0) {
    parsed = applyUniquifier(state, {
      uniqueSpecifier,
      uniqueNumber,
      uniquePrefix,
      uniqueSuffix,
      isUniversal,
      baseParsed: baseParsed ?? '',
      endParsed: parsed,
    });
  }

  return parsed;
}

// --- specifier evaluators ---------------------------------------------------

function strict(state: EvalState, value: string, field = state.fieldName): string {
  return strictlySanitize(value, field, state.tm, state.opts);
}

function evalAuthors(
  scanner: Scanner,
  state: EvalState,
  fallbackEditor: boolean,
): string {
  let numChars = 0;
  let numAuth = 0;
  let authSep = '';
  let etal = '';
  let isLast = false;
  let wasEscaped = false;

  if (!scanner.isAtEnd()) {
    const a1 = scanOptArg(scanner);
    authSep = a1 ? a1.value : '';
    if (a1) {
      const a2 = scanOptArg(scanner);
      if (a2) {
        etal = a2.value;
        wasEscaped = a2.lastCharEscaped;
      }
    }
    const sd = scanSignedDigit(scanner);
    if (sd) {
      numAuth = sd.digit;
      isLast = sd.negative;
      const nc = scanner.scanUnsignedInteger();
      numChars = nc === undefined ? 0 : nc;
    }
  }

  let authArray = state.item.peopleForField('Author');
  if (authArray.length === 0 && fallbackEditor) {
    authArray = state.item.peopleForField('Editor');
  }
  if (authArray.length === 0) return '';

  if (numAuth === 0 || numAuth > authArray.length) {
    numAuth = authArray.length;
  } else if (
    numAuth < authArray.length &&
    !wasEscaped &&
    etal.length > 0 &&
    isDigit(etal.charCodeAt(etal.length - 1))
  ) {
    const i = parseInt(etal.slice(etal.length - 1), 10);
    etal = etal.slice(0, etal.length - 1);
    if (i > 0 && i < numAuth) numAuth = i;
  }

  let out = '';
  for (let i = 0; i < numAuth; i++) {
    if (i > 0) out += authSep;
    const author = authArray[isLast ? authArray.length - numAuth + i : i]!;
    let name = strict(state, author.last);
    if (state.isLocalFile) name = replaceCharsStr(name, SLASH_PRED, '-');
    if (numChars > 0 && name.length > numChars) name = name.slice(0, numChars);
    out += name;
  }
  if (numAuth < authArray.length) out += etal;
  return out;
}

function evalAuthorsWithInitials(
  scanner: Scanner,
  state: EvalState,
  fallbackEditor: boolean,
): string {
  let numAuth = 0;
  let authSep = ';';
  let nameSep = '.';
  let etal = '';
  let isLast = false;
  let wasEscaped = false;

  if (!scanner.isAtEnd()) {
    const a1 = scanOptArg(scanner);
    if (a1) {
      authSep = a1.value;
      const a2 = scanOptArg(scanner);
      if (a2) {
        nameSep = a2.value;
        const a3 = scanOptArg(scanner);
        if (a3) {
          etal = a3.value;
          wasEscaped = a3.lastCharEscaped;
        }
      }
    }
    const sd = scanSignedDigit(scanner);
    if (sd) {
      numAuth = sd.digit;
      isLast = sd.negative;
    }
  }

  let authArray = state.item.peopleForField('Author');
  if (authArray.length === 0 && fallbackEditor) {
    authArray = state.item.peopleForField('Editor');
  }
  if (authArray.length === 0) return '';

  if (numAuth === 0 || numAuth > authArray.length) {
    numAuth = authArray.length;
  } else if (
    numAuth < authArray.length &&
    !wasEscaped &&
    etal.length > 0 &&
    isDigit(etal.charCodeAt(etal.length - 1))
  ) {
    const i = parseInt(etal.slice(etal.length - 1), 10);
    etal = etal.slice(0, etal.length - 1);
    if (i > 0 && i < numAuth) numAuth = i;
  }

  let out = '';
  for (let i = 0; i < numAuth; i++) {
    if (i > 0) out += authSep;
    const author = authArray[isLast ? authArray.length - numAuth + i : i]!;
    const firstName = strict(state, author.first);
    const lastName = strict(state, author.last);
    let name: string;
    if (firstName.length > 0) name = `${lastName}${nameSep}${firstName[0]}`;
    else name = lastName;
    if (state.isLocalFile) name = replaceCharsStr(name, SLASH_PRED, '-');
    out += name;
  }
  if (numAuth < authArray.length) out += etal;
  return out;
}

function evalTitleChars(scanner: Scanner, state: EvalState): string {
  let title = strict(state, state.item.stringValueOfField('Title'));
  if (title.length === 0) return '';
  if (state.isLocalFile) title = replaceCharsStr(title, SLASH_PRED, '-');
  const nc = scanner.scanUnsignedInteger();
  const numChars = nc === undefined ? 0 : nc;
  if (numChars > 0 && title.length > numChars) return title.slice(0, numChars);
  return title;
}

function evalTitleWords(scanner: Scanner, state: EvalState): string {
  let smallWordLength = 3;
  let hasNumString = false;
  const numString = scanOptArg(scanner);
  if (numString) {
    hasNumString = true;
    smallWordLength = parseInt(numString.value, 10) || 0;
  }
  const nw = scanner.scanUnsignedInteger();
  let numWords = nw === undefined ? 0 : nw;

  const title = state.item.stringValueOfField('Title');
  if (title.trim().length === 0) return '';

  const words = splitWhitespace(title);
  if (numWords === 0) numWords = words.length;
  let out = '';
  let isFirst = true;
  for (let i = 0; i < words.length && numWords > 0; i++) {
    let word = strict(state, words[i]!);
    if (state.isLocalFile) word = replaceCharsStr(word, SLASH_PRED, '-');
    if (!hasNumString || word.length > smallWordLength) {
      if (isFirst) isFirst = false;
      else out += strict(state, ' ');
      out += word;
      if (word.length > smallWordLength) numWords--;
    }
  }
  return out;
}

function evalYear(state: EvalState, fourDigit: boolean): string {
  const yearString = state.item.stringValueOfField('Year');
  if (yearString.trim().length === 0) return '';
  const y = yearFromString(yearString);
  if (fourDigit) return String(y);
  return pad2(((y % 100) + 100) % 100);
}

function evalMonth(state: EvalState): string {
  const monthString = state.item.stringValueOfField('Month');
  if (monthString.trim().length === 0) return '';
  const m = monthFromString(monthString) || 1;
  return pad2(m);
}

function evalKeywords(scanner: Scanner, state: EvalState): string {
  let slash = state.isLocalFile ? '-' : '/';
  let sep = '';
  const a1 = scanOptArg(scanner);
  if (a1) {
    slash = a1.value;
    const a2 = scanOptArg(scanner);
    if (a2) sep = a2.value;
  }
  const keywordsString = state.item.stringValueOfField('Keywords');
  const nw = scanner.scanUnsignedInteger();
  const numWords = nw === undefined ? 0 : nw;
  if (keywordsString.trim().length === 0) return '';

  // separator chars for keywords: BibDesk uses the group field separators
  // (default `,;`) plus we treat `:` as a divider (the comment in source).
  const sepSet = /[,;:]/;
  let keywords: string[];
  if (sepSet.test(keywordsString)) {
    keywords = keywordsString
      .split(/[,;:]/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
  } else {
    keywords = [keywordsString];
  }

  let out = '';
  for (let i = 0; i < keywords.length && (numWords === 0 || i < numWords); i++) {
    let keyword = keywords[i]!.trim();
    keyword = strict(state, keyword);
    if (slash !== '/') keyword = replaceCharsStr(keyword, SLASH_PRED, slash);
    if (i > 0 && keyword.length > 0 && sep.length > 0) out += sep;
    out += keyword;
  }
  return out;
}

type OldFileMode = 'noExt' | 'withExt' | 'extDot' | 'extPlain';

function evalOldFilename(
  state: EvalState,
  mode: OldFileMode,
  defaultExt?: string,
): string {
  // Without a real file-system / linked-file URL in this layer, derive from the
  // item's local-file field string value if present.
  const path = state.item.stringValueOfField(LOCAL_FILE_FIELD);
  if (mode === 'extPlain') {
    let ext = pathExtension(path);
    if (ext.length === 0) ext = defaultExt ?? '';
    if (ext.length === 0) return '';
    return sanitize(ext, state.fieldName, state.tm);
  }
  if (path.length === 0) return '';
  if (mode === 'noExt') {
    return sanitize(deletePathExtension(lastPathComponent(path)), state.fieldName, state.tm);
  }
  if (mode === 'withExt') {
    return sanitize(lastPathComponent(path), state.fieldName, state.tm);
  }
  // extDot
  const ext = pathExtension(path);
  if (ext.length === 0) return '';
  return '.' + sanitize(ext, state.fieldName, state.tm);
}

function evalDocumentFilename(state: EvalState): string {
  const name = state.opts.documentFilename;
  if (!name) return '';
  const base = deletePathExtension(lastPathComponent(name));
  return sanitize(base, state.fieldName, state.tm);
}

function evalField(scanner: Scanner, state: EvalState): string {
  const key = scanBracedKey(scanner);
  if (key === undefined) return '';
  let slash = state.isLocalFile ? '-' : '/';
  const a1 = scanOptArg(scanner);
  if (a1) slash = a1.value;
  const nc = scanner.scanUnsignedInteger();
  const numChars = nc === undefined ? 0 : nc;

  let value: string;
  if (!state.isCiteKey && key === CITE_KEY_FIELD) {
    value = state.item.citeKey;
  } else {
    value = state.item.stringValueOfField(key);
  }
  if (value.trim().length === 0) return '';
  value = strict(state, value);
  if (slash !== '/') value = replaceCharsStr(value, SLASH_PRED, slash);
  if (numChars > 0 && value.length > numChars) return value.slice(0, numChars);
  return value;
}

function evalWords(scanner: Scanner, state: EvalState): string {
  const key = scanBracedKey(scanner);
  if (key === undefined) return '';
  let sepChars = ' ';
  let slash = state.isLocalFile ? '-' : '/';
  let sep = '';
  const a1 = scanOptArg(scanner);
  if (a1) {
    sepChars = a1.value;
    const a2 = scanOptArg(scanner);
    if (a2) {
      slash = a2.value;
      const a3 = scanOptArg(scanner);
      if (a3) sep = a3.value;
    }
  }
  if (sepChars.length === 0) sepChars = ' ';
  const wordsString = state.item.stringValueOfField(key);
  const nw = scanner.scanUnsignedInteger();
  const numWords = nw === undefined ? 0 : nw;
  if (wordsString.trim().length === 0) return '';

  const sepSet = new Set([...sepChars].map((c) => c.charCodeAt(0)));
  const isSep = (c: number) => sepSet.has(c);
  let words: string[];
  if (anyCharMatches(wordsString, isSep)) {
    words = splitOnPredicate(wordsString, isSep);
  } else {
    words = [wordsString];
  }

  let out = '';
  for (let i = 0; i < words.length && (numWords === 0 || i < numWords); i++) {
    let word = words[i]!.trim();
    word = strict(state, word);
    if (slash !== '/') word = replaceCharsStr(word, SLASH_PRED, slash);
    if (i > 0 && word.length > 0 && sep.length > 0) out += sep;
    out += word;
  }
  return out;
}

function evalAcronym(scanner: Scanner, state: EvalState): string {
  const key = scanBracedKey(scanner);
  if (key === undefined) return '';
  const nc = scanner.scanUnsignedInteger();
  const smallWordLength = nc === undefined ? 3 : nc;
  // acronym is computed first, then strictly sanitized
  const raw = state.item.stringValueOfField(key);
  const ac = acronymValue(raw, smallWordLength);
  return strict(state, ac);
}

function evalBoolean(scanner: Scanner, state: EvalState): string {
  const key = scanBracedKey(scanner);
  if (key === undefined) return '';
  let yesValue = '';
  let noValue = '';
  let mixedValue = '';
  const a1 = scanOptArg(scanner);
  if (a1) {
    yesValue = a1.value;
    const a2 = scanOptArg(scanner);
    if (a2) {
      noValue = a2.value;
      const a3 = scanOptArg(scanner);
      if (a3) mixedValue = a3.value;
    }
  }
  const nc = scanner.scanUnsignedInteger();
  const numChars = nc === undefined ? 0 : nc;
  const intValue = integerValueOfField(state.item, key, state.tm);
  const value = intValue === 0 ? noValue : intValue === 1 ? yesValue : mixedValue;
  if (numChars > 0 && value.length > numChars) return value.slice(0, numChars);
  return value;
}

function evalDocumentInfo(scanner: Scanner, state: EvalState): string {
  const key = scanBracedKey(scanner);
  if (key === undefined) return '';
  const nc = scanner.scanUnsignedInteger();
  const numChars = nc === undefined ? 0 : nc;
  const value = state.opts.documentInfo?.(key) ?? '';
  if (value.trim().length === 0) return '';
  const clean = strict(state, value);
  if (numChars > 0 && clean.length > numChars) return clean.slice(0, numChars);
  return clean;
}

function evalRandom(
  scanner: Scanner,
  state: EvalState,
  base: string,
  range: number,
): string {
  const nc = scanner.scanUnsignedInteger();
  let n = nc === undefined ? 1 : nc;
  const baseCode = base.charCodeAt(0);
  let out = '';
  while (n-- > 0) {
    const r = Math.floor(state.random() * range) % range;
    out += String.fromCharCode(baseCode + r);
  }
  return out;
}

// --- uniquifier -------------------------------------------------------------

interface UniqueParams {
  uniqueSpecifier: number;
  uniqueNumber: number;
  uniquePrefix: string | null;
  uniqueSuffix: string | null;
  isUniversal: boolean;
  baseParsed: string;
  endParsed: string;
}

function applyUniquifier(state: EvalState, p: UniqueParams): string {
  // character range for the unique characters
  let rangeStart = 0;
  let rangeLen = 0;
  switch (p.uniqueSpecifier) {
    case 0x75: // 'u'
      rangeStart = 'a'.charCodeAt(0);
      rangeLen = 26;
      break;
    case 0x55: // 'U'
      rangeStart = 'A'.charCodeAt(0);
      rangeLen = 26;
      break;
    case 0x6e: // 'n'
      rangeStart = '0'.charCodeAt(0);
      rangeLen = 10;
      break;
  }

  const validator = makeValidator(state);

  // currentString short-circuit (preserve an already-valid existing value)
  const currentStr = state.isCiteKey
    ? validCiteKeyCandidate(state, state.opts.currentCiteKey ?? state.item.citeKey)
    : undefined;
  if (
    currentStr !== undefined &&
    currentStringMatches(currentStr, {
      base: p.baseParsed,
      end: p.endParsed,
      number: p.uniqueNumber,
      rangeStart,
      rangeLen,
      prefix: p.uniqueNumber > 0 ? null : p.uniquePrefix,
      suffix: p.uniqueNumber > 0 ? null : p.uniqueSuffix,
    })
  ) {
    return currentStr;
  }

  // resolve hash for deterministic suffix (n>0 with a field prefix/suffix)
  let hash = -1;
  let prefix = p.uniquePrefix;
  let suffix = p.uniqueSuffix;
  if (p.uniqueNumber > 0 && (prefix || suffix)) {
    hash = hashedField(state, prefix ?? suffix!, p.isUniversal);
    if (hash === -1 && prefix && suffix) {
      hash = hashedField(state, suffix, p.isUniversal);
    }
    prefix = null;
    suffix = null;
  }

  return uniqueString({
    base: p.baseParsed,
    end: p.endParsed,
    number: p.uniqueNumber,
    rangeStart,
    rangeLen,
    prefix,
    suffix,
    hash,
    validator,
  });
}

type Validator = (candidate: string) => string | undefined;

function makeValidator(state: EvalState): Validator {
  if (state.isCiteKey) {
    return (str) => validCiteKeyCandidate(state, str);
  }
  if (state.isLocalFile) {
    return (str) => {
      if (str.trim().length === 0) return undefined;
      if (state.opts.fileExists?.(str)) return undefined;
      return str;
    };
  }
  return (str) => (str.trim().length === 0 ? undefined : str);
}

/** Mirror of `validCiteKey()`: candidate is valid if no OTHER item owns it. */
function validCiteKeyCandidate(
  state: EvalState,
  key: string,
): string | undefined {
  if (key.trim().length === 0) return undefined;
  const available = state.opts.citeKeyAvailable;
  if (!available) return key;
  return available(key) ? key : undefined;
}

interface UniqueStringParams {
  base: string;
  end: string;
  number: number;
  rangeStart: number;
  rangeLen: number;
  prefix: string | null;
  suffix: string | null;
  hash: number;
  validator: Validator;
}

/** Port of `+uniqueString:endingWith:...`. Returns a *valid* (unique) string. */
function uniqueString(p: UniqueStringParams): string {
  let base = p.base;
  let end = p.end;
  const fullString = (chars: string) => base + chars + end;

  // fallback buffer of length `number`
  let fallback = '';

  if (p.number === 0) {
    const cand = p.validator(base + end);
    if (cand !== undefined) return cand;
    if (p.prefix) base = base + p.prefix;
    if (p.suffix) end = p.suffix + end;
  } else if (p.hash !== -1) {
    // deterministic suffix from the hash, base-`rangeLen`
    const chars: number[] = new Array(p.number).fill(0);
    let h = p.hash;
    for (let n = p.number; n > 0; n--, h = Math.floor(h / p.rangeLen)) {
      chars[n - 1] = p.rangeStart + (h % p.rangeLen);
    }
    fallback = String.fromCharCode(...chars);
    const cand = p.validator(fullString(fallback));
    if (cand !== undefined) return cand;
  } else {
    // fallback = last char of range, repeated `number` times
    fallback = String.fromCharCode(p.rangeStart + p.rangeLen - 1).repeat(
      p.number,
    );
  }

  // brute-force: enumerate strings of length n (growing when number==0)
  let n = Math.max(p.number, 1);
  for (;;) {
    const chars: number[] = new Array(n).fill(0);
    const enumerate = (i: number): string | undefined => {
      if (i < n) {
        for (let c = p.rangeStart; c < p.rangeStart + p.rangeLen; c++) {
          if (p.number === 0 && i === 0 && c === '0'.charCodeAt(0)) continue;
          chars[i] = c;
          const r = enumerate(i + 1);
          if (r !== undefined) return r;
        }
        return undefined;
      }
      return p.validator(fullString(String.fromCharCode(...chars)));
    };
    const found = enumerate(0);
    if (found !== undefined) return found;
    if (p.number !== 0) break; // fixed-length: only one pass
    n++;
  }

  return fullString(fallback);
}

/** Port of `+currentString:matchesString:...`. */
function currentStringMatches(
  current: string,
  p: {
    base: string;
    end: string;
    number: number;
    rangeStart: number;
    rangeLen: number;
    prefix: string | null;
    suffix: string | null;
  },
): boolean {
  const startLength = p.base.length;
  const endLength = p.end.length;
  let currentLength = current.length;
  if (currentLength === 0 || currentLength < startLength + endLength)
    return false;
  currentLength -= startLength + endLength;
  if (p.number > 0 && currentLength !== p.number) return false;
  if (startLength > 0 && !current.startsWith(p.base)) return false;
  if (endLength > 0 && !current.endsWith(p.end)) return false;
  if (p.number === 0 && currentLength === 0) return true;

  let currentUnique = current.slice(startLength, startLength + currentLength);
  const prefixLength = p.prefix?.length ?? 0;
  const suffixLength = p.suffix?.length ?? 0;
  if (prefixLength > 0) {
    if (!currentUnique.startsWith(p.prefix!)) return false;
    currentUnique = currentUnique.slice(prefixLength);
  }
  if (suffixLength > 0) {
    if (!currentUnique.endsWith(p.suffix!)) return false;
    currentUnique = currentUnique.slice(
      0,
      currentLength - prefixLength - suffixLength,
    );
  }
  for (let i = 0; i < currentUnique.length; i++) {
    const c = currentUnique.charCodeAt(i);
    if (!(c >= p.rangeStart && c < p.rangeStart + p.rangeLen)) return false;
  }
  return true;
}

/** Port of `hashedField()`. Returns -1 for NSNotFound. */
function hashedField(
  state: EvalState,
  field: string,
  isUniversal: boolean,
): number {
  let str: string;
  if (field.toLowerCase() === 'doi') {
    str = state.item.stringValueOfField('Doi');
    const isURL = str.includes('://');
    const i = str.indexOf('10.');
    if (i === -1) return -1;
    str = str.slice(i);
    if (isURL) {
      try {
        str = decodeURIComponent(str);
      } catch {
        // keep raw if malformed percent-encoding
      }
    }
  } else {
    str = state.item.stringValueOfField(field);
    if (str.trim().length === 0) return -1;
    // normalize: lowercase, replace composed chars, special chars -> space,
    // drop ignored chars (anything not [a-zA-Z0-9 ]), collapse whitespace.
    str = str.toLowerCase();
    str = replaceComposedCharacters(str);
    str = str.replace(/[_\-=/|.{}]/g, ' ');
    str = str.replace(/[^a-zA-Z0-9 ]/g, '');
    str = collapseWhitespace(str);
  }

  if (str.trim().length === 0) return -1;

  let hash = crc32(str);

  if (
    isUniversal &&
    (field.toLowerCase() === 'title' || field.toLowerCase() === 'doi')
  ) {
    const isDoiField = field.toLowerCase() === 'doi';
    hash =
      (hash % 26) +
      26 *
        (isDoiField
          ? 1 + (Math.floor(hash / 26) % 10)
          : 19 + (Math.floor(hash / 26) % 4));
  }
  return hash;
}

// --- value helpers ----------------------------------------------------------

function integerValueOfField(
  item: BibItem,
  field: string,
  tm: TypeManager,
): number {
  if (tm.isRatingField(field)) return item.ratingValueOfField(field);
  if (tm.isBooleanField(field)) return item.boolValueOfField(field) ? 1 : 0;
  if (tm.isTriStateField(field)) {
    // model returns -1 (off/no), 0 (mixed), 1 (on/yes); BibDesk %s compares:
    //   0 -> no, 1 -> yes, else -> mixed. Map off(-1)->0(no), mixed(0)->2(mixed),
    //   on(1)->1(yes) to match NSControlStateValue semantics.
    const t = item.triStateValueOfField(field);
    if (t === -1) return 0; // off -> "no"
    if (t === 1) return 1; // on -> "yes"
    return 2; // mixed
  }
  return item.stringValueOfField(field).trim().length === 0 ? 0 : 1;
}

function acronymValue(s: string, ignoreLength: number): string {
  let result = '';
  for (const raw of s.split(' ')) {
    let currentIgnore = ignoreLength;
    let component = raw.trim();
    if (component.length > 1 && component[component.length - 1] === '.') {
      currentIgnore = 0;
    }
    if (component.length > 0) {
      component = component.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    }
    if (component.length > currentIgnore) {
      result += component.charAt(0).toUpperCase();
    }
  }
  return result;
}

function scanBracedKey(scanner: Scanner): string | undefined {
  if (!scanner.scanString('{')) return undefined;
  const key = scanner.scanUpToString('}');
  if (!scanner.scanString('}')) return undefined;
  return key ?? '';
}

function splitWhitespace(s: string): string[] {
  return s
    .split(/[\s]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

function anyCharMatches(s: string, pred: (c: number) => boolean): boolean {
  for (let i = 0; i < s.length; i++) if (pred(s.charCodeAt(i))) return true;
  return false;
}

function splitOnPredicate(s: string, pred: (c: number) => boolean): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (pred(s.charCodeAt(i))) {
      if (cur.length > 0) out.push(cur);
      cur = '';
    } else {
      cur += s[i];
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function replaceCharsStr(
  s: string,
  pred: (c: number) => boolean,
  replacement: string,
): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    out += pred(s.charCodeAt(i)) ? replacement : s[i];
  }
  return out;
}

// --- date parsing (ports of NSDate yearFromString / monthFromString) --------

/** Port of `+[NSDate yearFromString:]`. */
export function yearFromString(yearString: string): number {
  if (yearString.trim().length === 0) return 0;
  const m = yearString.match(/-?\d+/);
  let year = m ? parseInt(m[0], 10) : 0;
  // two-digit normalization: if the leading numeric token is exactly 2 digits
  const digits = yearString.match(/\d+/);
  if (digits && digits[0].length === 2) {
    year += year < 50 ? 2000 : 1900;
  }
  return year;
}

const MONTH_NAMES: ReadonlyMap<string, number> = new Map([
  ['jan', 1],
  ['feb', 2],
  ['mar', 3],
  ['apr', 4],
  ['may', 5],
  ['jun', 6],
  ['jul', 7],
  ['aug', 8],
  ['sep', 9],
  ['oct', 10],
  ['nov', 11],
  ['dec', 12],
]);

/** Port of `+[NSDate monthFromString:]` for the common name/number forms. */
export function monthFromString(monthString: string): number {
  if (monthString.trim().length === 0) return 0;
  const letters = monthString.match(/[A-Za-z]+/);
  if (letters) {
    const key = letters[0].slice(0, 3).toLowerCase();
    return MONTH_NAMES.get(key) ?? 0;
  }
  const num = monthString.match(/\d+/);
  if (num) {
    const m = parseInt(num[0], 10);
    if (m >= 1 && m <= 12) return m;
  }
  return 0;
}

// --- tiny path helpers (no fs) ----------------------------------------------

function lastPathComponent(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

function pathExtension(p: string): string {
  const base = lastPathComponent(p);
  const idx = base.lastIndexOf('.');
  if (idx <= 0) return ''; // no extension or dotfile
  return base.slice(idx + 1);
}

function deletePathExtension(p: string): string {
  const idx = p.lastIndexOf('.');
  if (idx <= 0) return p;
  return p.slice(0, idx);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
