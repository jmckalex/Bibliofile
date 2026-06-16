/**
 * `serialize(lib): string` — the byte-faithful BibDesk writer.
 *
 * Reproduces `BibDocument.m bibTeXDataDroppingInternal:` (write order + exact
 * whitespace) and `BibItem.m bibTeXDataWithOptions:` (per-entry layout):
 *
 *   header (template + volatile lines)
 *   frontMatter (@preamble / free @comment)        — directly after header, + "\n\n"
 *   @bibdesk_info{document_info, …}                 — directly after that
 *   @string{name = value} macros                    — each "\n@string{…}\n"
 *   entries                                         — each "\n\n" + entry
 *   group @comment blocks (static, smart, url, script) — each "\n\n@comment{…}}"
 *   trailing "\n"  (only when the library had data)
 *
 * Empty library → "" (no header). Field NAMES lower-cased, fields sorted
 * case-insensitive-numeric, `bdsk-file-N`/`bdsk-url-N` (linked-file/URL fields)
 * forced LAST, values always `{…}`-wrapped, empty fields dropped, type/keyword
 * tokens lower-cased. Values TeXified only when `shouldTeXifyField` is true.
 * The 98-field guard throws (BibItem.m:1846) on entries with ≥ 98 fields.
 */

import {
  sharedTypeManager,
  isComplex,
  complexValueToBibTeX,
  type BibItem,
  type FieldValue,
  type MacroResolver,
} from '@bibdesk/model';
import { texify } from '@bibdesk/tex';

import type { BibLibrary, DocumentInfoEntry } from './library.js';
import { bdskFileKey } from './library.js';
import { GROUP_ORDER, serializeGroup, type GroupRecord } from './groups.js';
import { encodeBdskFile, type BdskFilePlist } from './bdsk-file.js';

const TEMPLATE =
  '%% This BibTeX bibliography file was created using BibDesk.\n' +
  '%% https://bibdesk.sourceforge.io/\n';

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

/**
 * Build the header (`templateFile`): the stable template, then the volatile
 * `%% Created for …` and `%% Saved with string encoding …` lines, re-emitted
 * verbatim from the captured metadata. BibDesk's format strings are
 *   `"\n%% Created for %@ at %@ \n\n"` and `"\n%% Saved with string encoding %@ \n\n"`
 * (BibDocument.m:1742,1744); each is only present if BibDesk wrote it (the
 * legacy `bd-test.bib` has no encoding line).
 */
function buildHeader(lib: BibLibrary): string {
  let out = TEMPLATE;
  if (lib.header.createdFor !== undefined) {
    out += `\n%% Created for ${lib.header.createdFor}\n\n`;
  }
  if (lib.header.savedEncoding !== undefined) {
    out += `\n%% Saved with string encoding ${lib.header.savedEncoding}\n\n`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Macros
// ---------------------------------------------------------------------------

/**
 * The macro string: `\n@string{<name> = <value>}\n` per file-tier macro, in
 * dependency/alphabetical order (BDSKMacroResolver.bibTeXString). Macro values
 * are wrapped/joined via `complexValueToBibTeX`; macro NAMES and tokens are not
 * TeXified. Returns "" when there are no file macros.
 */
function buildMacroString(resolver: MacroResolver): string {
  const fileTier = resolver.parent;
  if (!fileTier) return '';
  const defs = fileTier.orderedLocalDefinitions();
  let out = '';
  for (const { name, value } of defs) {
    out += `\n@string{${name} = ${renderMacroValue(value)}}\n`;
  }
  return out;
}

/** Render a macro definition value (no TeXify; `{…}`/bare/`#`-joined). */
function renderMacroValue(value: FieldValue): string {
  return complexValueToBibTeX(value);
}

// ---------------------------------------------------------------------------
// Document info
// ---------------------------------------------------------------------------

/** `@bibdesk_info{document_info,\n\t<key> = <value>\n}\n` (documentInfoString). */
function buildDocumentInfo(entries: DocumentInfoEntry[]): string {
  let out = '@bibdesk_info{document_info';
  for (const { key, value } of entries) {
    out += `,\n\t${key} = ${renderRawValue(value)}`;
  }
  out += '\n}\n';
  return out;
}

/** Render a value as `{…}`-wrapped (or bare/joined for complex), no TeXify. */
function renderRawValue(value: FieldValue): string {
  return complexValueToBibTeX(value);
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/** Case-insensitive, numeric-aware comparison (BibDesk caseInsensitiveNumericCompare). */
function caseInsensitiveNumericCompare(a: string, b: string): number {
  return a.toLowerCase().localeCompare(b.toLowerCase(), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/** Is a field a linked-file/URL field that must be written LAST? */
function isLinkedFileOrURLField(name: string): boolean {
  return /^bdsk-file-\d+$/i.test(name) || /^bdsk-url-\d+$/i.test(name);
}

/** Is a {@link FieldValue} empty (dropped on write)? */
function isEmpty(value: FieldValue | undefined): boolean {
  if (value === undefined) return true;
  if (isComplex(value)) return value.nodes.length === 0;
  return value.length === 0;
}

/**
 * Serialize one entry. `@<type>{<citekey>` then each non-empty field as
 * `,\n\t<lowercased name> = <value>`, then `}`. Ordinary fields are sorted
 * case-insensitive-numeric; linked-file/URL fields are appended last (in their
 * own sorted order). Enforces the 98-field guard.
 */
export function serializeEntry(
  item: BibItem,
  bdskFiles: Map<string, BdskFilePlist>,
): string {
  const tm = sharedTypeManager;
  const allNames = item.fieldNames();
  const ordinary: string[] = [];
  const linked: string[] = [];
  for (const name of allNames) {
    if (isLinkedFileOrURLField(name)) linked.push(name);
    else ordinary.push(name);
  }
  ordinary.sort(caseInsensitiveNumericCompare);
  linked.sort(caseInsensitiveNumericCompare);

  let out = `@${item.type}{${item.citeKey}`;
  let numFields = 0;

  const emitField = (name: string): void => {
    const value = item.rawValueOfField(name);
    if (isEmpty(value)) return;
    numFields++;
    out += `,\n\t${name.toLowerCase()} = ${renderFieldValue(name, value!, item, bdskFiles, tm)}`;
  };

  for (const name of ordinary) emitField(name);
  for (const name of linked) emitField(name);

  out += '}';

  if (numFields >= 98) {
    throw new Error(
      `Too many fields for item with cite key "${item.citeKey}" (BibTeX 98-field limit)`,
    );
  }
  return out;
}

/**
 * Render a field value for an entry. URL/citation/note fields are NOT TeXified
 * (TypeManager.shouldTeXifyField); everything else is. `bdsk-file-N` values are
 * re-encoded byte-faithfully from the retained decoded plist. The result is the
 * BibTeX text (always `{…}`-wrapped for simple values; macros/numbers bare).
 */
function renderFieldValue(
  name: string,
  value: FieldValue,
  item: BibItem,
  bdskFiles: Map<string, BdskFilePlist>,
  tm: typeof sharedTypeManager,
): string {
  // bdsk-file-N: re-encode the retained binary plist to base64.
  if (/^bdsk-file-\d+$/i.test(name)) {
    const plist = bdskFiles.get(bdskFileKey(item.id, name));
    if (plist !== undefined) {
      return `{${encodeBdskFile(plist)}}`;
    }
    // fallback: emit the raw stored value
    return complexValueToBibTeX(value);
  }

  if (isComplex(value)) {
    // complex values: macro tokens / numbers stay bare; string nodes wrapped.
    // TeXify only applies to literal string nodes of TeXifiable fields.
    if (!tm.shouldTeXifyField(name)) return complexValueToBibTeX(value);
    const texified = {
      nodes: value.nodes.map((node) =>
        node.type === 'string' ? { type: 'string' as const, value: texify(node.value) } : node,
      ),
    };
    return complexValueToBibTeX(texified);
  }

  const text = tm.shouldTeXifyField(name) ? texify(value) : value;
  return `{${text}}`;
}

// ---------------------------------------------------------------------------
// serialize()
// ---------------------------------------------------------------------------

/** Serialize a {@link BibLibrary} to canonical BibDesk `.bib` text. */
export function serialize(lib: BibLibrary): string {
  const frontMatter = lib.preambles.join('\n');
  const hasFrontMatter = frontMatter.trim().length > 0;
  const hasDocInfo = !!lib.documentInfo && lib.documentInfo.length > 0;
  const macroString = buildMacroString(lib.macroResolver);
  const hasMacros = macroString.length > 0;
  const hasItems = lib.items.length > 0;
  const presentGroups: GroupRecord[] = [];
  for (const kind of GROUP_ORDER) {
    for (const g of lib.groups) {
      if (g.kind === kind && groupHasData(g)) presentGroups.push(g);
    }
  }
  const hasGroups = presentGroups.length > 0;

  const hasData = hasFrontMatter || hasDocInfo || hasMacros || hasItems || hasGroups;
  if (!hasData) return '';

  let out = buildHeader(lib);

  if (hasFrontMatter) {
    // frontMatter is followed by a single blank-line separator; when entries
    // follow directly (no doc-info/macros between), that separator doubles as
    // the first entry's leading "\n\n" rather than adding a second one.
    out += frontMatter + '\n\n';
  }
  if (hasDocInfo) {
    out += buildDocumentInfo(lib.documentInfo!);
  }
  if (hasMacros) {
    out += macroString;
  }
  const suppressFirstEntrySeparator = hasFrontMatter && !hasDocInfo && !hasMacros;
  for (let idx = 0; idx < lib.items.length; idx++) {
    const sep = idx === 0 && suppressFirstEntrySeparator ? '' : '\n\n';
    out += sep + serializeEntry(lib.items[idx]!, lib.bdskFiles);
  }
  for (const g of presentGroups) {
    out += serializeGroup(g);
  }
  out += '\n';
  return out;
}

/** A group block is written only when its decoded array is non-empty. */
function groupHasData(g: GroupRecord): boolean {
  return Array.isArray(g.data) ? g.data.length > 0 : g.data != null;
}
