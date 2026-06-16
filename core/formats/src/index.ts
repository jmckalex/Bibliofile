/**
 * @bibdesk/formats
 *
 * Port of BibDesk's `BDSKFormatParser` — the `%`-specifier mini-language that
 * drives **cite-key generation** and **auto-file naming** — plus the supporting
 * string machinery: an inline zlib-compatible **CRC32**, the Unicode/TeX
 * **sanitizers** (`lossyASCII`, composed-character folding, de-TeXify), and the
 * per-field **invalid-character sets** ported verbatim from `BDSKTypeManager`.
 *
 * Platform-agnostic: no Electron / DOM / Node runtime APIs, no `fs`. File-system
 * and collection lookups (cite-key collision, local-file existence) are injected
 * as pure callbacks through {@link ParseOptions}.
 *
 * Primary entry points:
 *   - {@link parseFormat}       — evaluate a format string against a `BibItem`.
 *   - {@link generateCiteKey}   — generate a collision-free cite key.
 *   - {@link validateFormat}    — validate a format string (editor error display).
 *   - {@link crc32}             — CRC-32 (string/bytes).
 *   - {@link lossyASCII} and the cite-key/filename sanitizers + char-set predicates.
 */

// --- CRC32 ------------------------------------------------------------------
export { crc32, crc32Hex, utf8Bytes } from './crc32.js';

// --- char sets / predicates -------------------------------------------------
export {
  type FieldKind,
  type CharPredicate,
  isInvalidCiteKeyChar,
  isStrictInvalidCiteKeyChar,
  isFragileCiteKeyChar,
  isInvalidLocalUrlChar,
  isStrictInvalidLocalUrlChar,
  isVeryStrictInvalidLocalUrlChar,
  isInvalidRemoteUrlChar,
  isStrictInvalidRemoteUrlChar,
  isInvalidGeneralChar,
  invalidCharsForKind,
  strictInvalidCharsForKind,
  veryStrictInvalidCharsForKind,
  stripChars,
  replaceChars,
} from './charsets.js';

// --- transforms -------------------------------------------------------------
export {
  lossyASCII,
  replaceComposedCharacters,
  removeCurlyBraces,
  deTeXify,
  acronym,
  collapseWhitespace,
} from './transforms.js';

// --- sanitizers -------------------------------------------------------------
export {
  CITE_KEY_FIELD,
  LOCAL_FILE_FIELD,
  REMOTE_URL_FIELD,
  type CiteKeyCleanOption,
  type LocalFileCleanOption,
  type StrictSanitizeOptions,
  fieldKind,
  sanitize,
  strictlySanitize,
  cleanForCiteKey,
  cleanForFilename,
  isValidCiteKey,
  citeKeyHasFragileChars,
  filterCiteKeyInput,
  manualCleanCiteKey,
} from './sanitize.js';

// --- parser -----------------------------------------------------------------
export {
  parseFormat,
  yearFromString,
  monthFromString,
  type ParseOptions,
  type RandomFn,
} from './parser.js';

// --- cite-key generation ----------------------------------------------------
export {
  generateCiteKey,
  DEFAULT_CITE_KEY_FORMAT,
  type GenerateCiteKeyOptions,
} from './generate.js';

// --- validation -------------------------------------------------------------
export {
  validateFormat,
  requiredFieldsForFormat,
  type FormatValidationResult,
} from './validate.js';
