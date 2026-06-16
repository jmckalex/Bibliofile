/**
 * @bibdesk/bibtex — custom byte-faithful BibTeX round-trip parser + serializer
 * including BibDesk `@comment`/`bdsk-*` extensions.
 *
 * PUBLIC CONTRACT (stable; T1's golden round-trip harness depends on these):
 *   parse(text)      -> BibLibrary
 *   serialize(lib)   -> string
 *
 * Round-trip property: `serialize(parse(text)) === text` for BibDesk-canonical
 * input (modulo the documented normalizations in subsystem-12 §2 for
 * non-canonical input — field-name lower-casing/sorting, value `{…}`-wrapping,
 * dropped lexical comments, relocated frontMatter, etc.).
 *
 * The implementation is split across:
 *   - `parser.ts`        — `parse`
 *   - `serializer.ts`    — `serialize`
 *   - `library.ts`       — `BibLibrary` container + types
 *   - `value-parser.ts`  — RHS value → `FieldValue`
 *   - `field-names.ts`   — canonical field-name casing
 *   - `groups.ts`        — BibDesk group `@comment` records + codec
 *   - `plist.ts`         — Apple XML-plist codec (byte-faithful)
 *   - `bdsk-file.ts`     — `bdsk-file-N` binary-plist (base64) codec
 */

export { parse } from './parser.js';
export { serialize } from './serializer.js';

export {
  type BibLibrary,
  type HeaderInfo,
  type DocumentInfoEntry,
  bdskFileKey,
} from './library.js';

export {
  type GroupRecord,
  type GroupKind,
  GROUP_ORDER,
} from './groups.js';

export {
  type PlistValue,
  type PlistInteger,
  parsePlist,
  serializePlist,
  plistInteger,
  isPlistInteger,
} from './plist.js';

export {
  type BdskFilePlist,
  BDSK_FILE_PREFIX,
  isBdskFileBlob,
  decodeBdskFile,
  encodeBdskFile,
  relativePathOf,
} from './bdsk-file.js';

export { canonicalFieldName } from './field-names.js';

/** Options accepted by {@link parse}. */
export interface ParseOptions {
  /** Source encoding hint; defaults to utf-8. (Decoding is the app's job.) */
  encoding?: string;
}

/** Options accepted by {@link serialize}. */
export interface SerializeOptions {
  /** Override the line ending; defaults to the document's `\n`. */
  newline?: string;
}
