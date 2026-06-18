/**
 * document-service — the **pure** document layer for the read-only viewer.
 *
 * ZERO Electron / DOM imports. Everything here is plain TypeScript over the
 * `@bibdesk/*` core libraries, so it is unit-testable headlessly (see
 * `document-service.test.ts`). The Electron shell (`index.ts`) is a thin wrapper
 * that owns a {@link DocumentStore}, registers `ipcMain.handle` per channel, and
 * forwards each request straight into the matching store method.
 *
 * Responsibilities:
 *   - parse `.bib` text into a {@link BibLibrary} (via `@bibdesk/bibtex`),
 *   - wire up crossref resolution (`BibItem.setStore`) so inheritance works,
 *   - hold open documents keyed by a generated `documentId`,
 *   - project `BibItem`s into the structured-clone-safe DTOs from
 *     `@bibdesk/shared` (`PublicationRow`, `GroupNode`, `ItemDetail`), doing all
 *     display formatting (author lists via `@bibdesk/names`, de-TeXified titles/
 *     fields via `@bibdesk/tex`) on this side of the IPC boundary.
 *
 * File I/O lives ONLY in {@link openLibraryFromFile}; the core
 * {@link openLibraryFromText} reads no files.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  parse,
  serialize,
  serializeEntry,
  bdskFileKey,
  encodeBdskFile,
  relativePathOf,
  plistInteger,
  type BibLibrary,
  type GroupRecord,
} from '@bibdesk/bibtex';
import {
  type BibItem,
  type PublicationStore,
  type FieldValue,
  FieldNames,
  createBibItem,
  sharedTypeManager,
  complexValueToBibTeX,
  isComplex,
  equivalenceKey,
  itemsEquivalent,
} from '@bibdesk/model';
import { generateCiteKey, DEFAULT_CITE_KEY_FORMAT, parseFormat, LOCAL_FILE_FIELD } from '@bibdesk/formats';
import { makeAuthor, splitNameList, OTHERS, type Author } from '@bibdesk/names';
import { detexify } from '@bibdesk/tex';
import { renderMarkdown, renderNotes } from './markdown.js';
import {
  readAnnotation,
  writeAnnotation,
  ANNOTATION_FIELD,
  COMPRESSED_FIELD,
  type AnnotationStorage,
} from './annotation.js';
import { renderDetailsPanel, renderBottomPanel } from './panel.js';
import { exportRis, exportCsv, exportHtml, renderTemplate } from './export.js';
import { parseRis, type RisRecord } from './ris-import.js';
import { parseEndnote } from './endnote.js';
import { parseAuxCiteKeys } from './aux.js';
import { readFolders, writeFolders, nextFolderId, isSelfOrDescendant, type FolderRecord } from './folders.js';
import { FtsIndex } from './fts.js';
import { extractPdfText } from './pdf-text.js';
import {
  Condition,
  Filter,
  Conjunction,
  StaticGroup,
  SmartGroup,
  type Group,
  type EvaluableItem,
} from '@bibdesk/groups';
import type {
  OpenedDocument,
  ClosedDocument,
  CloseDocumentRequest,
  ListPublicationsRequest,
  ListPublicationsResponse,
  SortSpec,
  ListGroupsRequest,
  ListGroupsResponse,
  GroupNode,
  GroupKind,
  GetItemDetailRequest,
  ItemDetail,
  ItemField,
  FieldKind,
  ItemFile,
  PublicationRow,
  ParseWarning,
  ApplyEditRequest,
  EditResult,
  ListMacrosRequest,
  ListMacrosResponse,
  MacroDef,
  BatchOp,
  BatchEditResult,
  ExportFormat,
  ImportResult,
  FindReplaceRequest,
  FindReplaceResult,
  FindReplaceMatch,
  FindDuplicatesResult,
  DuplicateGroup,
  GroupEditRequest,
  GroupEditResult,
  GroupConditionsRequest,
  GroupConditionsResponse,
  SmartCondition,
  BrokenLink,
  SaveDocumentRequest,
  SaveDocumentResult,
} from '@bibdesk/shared';

// ---------------------------------------------------------------------------
// Open result
// ---------------------------------------------------------------------------

/** Result of opening a library: the IPC-facing summary plus the retained library. */
export interface OpenDocumentResult {
  /** The structured-clone-safe summary sent to the renderer / event. */
  readonly opened: OpenedDocument;
  /** The retained parsed library (kept in the store; not sent over IPC). */
  readonly library: BibLibrary;
  /** Live crossref store (resolves parents against the current item list). */
  readonly crossrefStore: LibraryCrossrefStore;
}

// ---------------------------------------------------------------------------
// Pure crossref store over a parsed library
// ---------------------------------------------------------------------------

/**
 * Case-insensitive cite-key lookup used to resolve crossref parents. Resolves
 * LIVE against the current item list (a getter), so adding/deleting entries or
 * renaming cite keys during editing is reflected without rebuilding. BibDesk's
 * `itemForCiteKey:` returns the FIRST match on a collision, so we do too.
 */
class LibraryCrossrefStore implements PublicationStore {
  constructor(private readonly getItems: () => readonly BibItem[]) {}
  itemForCiteKey(citeKey: string): BibItem | undefined {
    const k = citeKey.toLowerCase();
    return this.getItems().find((i) => i.citeKey.toLowerCase() === k);
  }
}

let __docSeq = 0;

/** Generate a fresh, process-unique document id. */
function nextDocumentId(): string {
  __docSeq += 1;
  return `doc-${__docSeq}`;
}

// ---------------------------------------------------------------------------
// Pure open: text -> library + summary
// ---------------------------------------------------------------------------

/**
 * Parse `.bib` text into an in-memory document. Generates a `documentId`, wires
 * crossref resolution onto every item, and returns the {@link OpenedDocument}
 * summary plus the retained library. Reads NO files (the caller supplies text).
 *
 * @param text Raw `.bib` contents (already decoded to a JS string).
 * @param path Absolute path the text came from (for `displayName`/`path`).
 */
export function openLibraryFromText(
  text: string,
  path: string,
): OpenDocumentResult {
  const library = parse(text);

  // Wire crossref resolution: the bibtex parser does NOT bind a store, so
  // inheritance / isFieldInherited would be inert without this. The store is
  // live (closes over library.items) so later edits stay consistent.
  const store = new LibraryCrossrefStore(() => library.items);
  for (const item of library.items) item.setStore(store);

  const documentId = nextDocumentId();
  const warnings: ParseWarning[] = []; // parser surfaces none in this read-only path

  const opened: OpenedDocument = {
    documentId,
    path,
    displayName: basename(path),
    itemCount: library.items.length,
    warnings,
  };
  return { opened, library, crossrefStore: store };
}

/**
 * Thin file-reading wrapper around {@link openLibraryFromText}. This is the ONLY
 * place in the service that touches the filesystem (`node:fs`); the core stays
 * I/O-free. Reads UTF-8 (the BibDesk default; encoding heuristics are out of
 * scope for the read-only viewer).
 */
export function openLibraryFromFile(path: string): OpenDocumentResult {
  const abs = resolve(path);
  const text = readFileSync(abs, 'utf8');
  return openLibraryFromText(text, abs);
}

// ---------------------------------------------------------------------------
// Group construction (escaping seam — see notes below)
// ---------------------------------------------------------------------------

/**
 * Build typed {@link Group} objects from a parsed library's group records.
 *
 * ESCAPING SEAM: `@bibdesk/bibtex`'s parser ALREADY reverses BibDesk's group-
 * plist entity escaping (`%7B`→`{`, …) when it decodes each `@comment` block, so
 * `record.data` strings are already plain Unicode. `@bibdesk/groups`'s
 * `groupFromSerialized` / `filterFromSerialized` would unescape a SECOND time
 * (double-processing any literal `%`). To apply escaping EXACTLY ONCE we build
 * the typed groups directly from the decoded data here — reading
 * `record.data["group name"]` / condition fields verbatim and constructing
 * `StaticGroup` / `Condition`+`Filter`+`SmartGroup` ourselves (NOT via
 * `groupFromSerialized`). url/script groups are type-only (never match) in this
 * read-only session, so we skip them for membership.
 */
function groupsFromLibrary(library: BibLibrary): Group[] {
  const out: Group[] = [];
  for (const record of library.groups) {
    for (const dict of dictsOf(record.data)) {
      const built = buildGroupFromDict(record.kind, dict);
      if (built) out.push(built);
    }
  }
  return out;
}

/**
 * A BibDesk group `@comment` block decodes to an ARRAY of per-group dictionaries
 * (one block per kind can hold several groups). Return that array verbatim — its
 * indices are stable group ids (`g#record#dict`) and the array is mutated in place
 * by the group-editor CRUD, so this must NOT copy/filter. Tolerates a bare single
 * dict from odd inputs.
 */
function dictsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') return [data as Record<string, unknown>];
  return [];
}

/** The `group name` of a decoded group dict (already unescaped by the parser). */
function nameOfDict(dict: Record<string, unknown>): string {
  return typeof dict['group name'] === 'string' ? (dict['group name'] as string) : '';
}

/** Build one typed group from a single decoded group dict, or undefined to skip. */
function buildGroupFromDict(kind: GroupKind, dict: Record<string, unknown>): Group | undefined {
  const name = nameOfDict(dict);
  switch (kind) {
    case 'static': {
      const keysStr = typeof dict.keys === 'string' ? (dict.keys as string) : '';
      const keys = keysStr
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
      return new StaticGroup(name, keys);
    }
    case 'smart':
      return new SmartGroup(name, filterFromDecoded(dict));
    // url / script are persisted but type-only here (no live fetch/exec), so they
    // have no membership object — listGroups still shows them with count 0.
    case 'url':
    case 'script':
    default:
      return undefined;
  }
}

/**
 * Build a {@link Filter} from a decoded smart-group dictionary WITHOUT a second
 * unescape (the parser already decoded condition `value`s). Mirrors
 * `filterFromSerialized` minus the `unescapeGroupPlistEntities` call.
 */
function filterFromDecoded(data: Record<string, unknown>): Filter {
  const rawConditions = Array.isArray(data.conditions)
    ? (data.conditions as Array<Record<string, unknown>>)
    : [];
  const conditions: Condition[] = rawConditions.map(
    (c) =>
      new Condition({
        key: typeof c.key === 'string' ? c.key : '',
        comparison: toInt(c.comparison),
        value: typeof c.value === 'string' ? c.value : '', // already decoded
        version: toInt(c.version) || 1,
      }),
  );
  // BibDesk guarantees at least one condition (empty key matches everything).
  if (conditions.length === 0) {
    conditions.push(new Condition({ key: '', comparison: 2, value: '' }));
  }
  const conjunction = toInt(data.conjunction) === 1 ? Conjunction.Or : Conjunction.And;
  return new Filter(conditions, conjunction);
}

/**
 * Adapt a {@link BibItem} to the {@link EvaluableItem} the group evaluator reads.
 * `BibItem` structurally satisfies it (citeKey, stringValueOfField, fieldNames,
 * files, dateAdded/dateModified, typeManager, peopleForField), so this is a
 * zero-cost typed view rather than `as never`.
 */
function asEvaluable(item: BibItem): EvaluableItem {
  return item as unknown as EvaluableItem;
}

/** Plist integers arrive as `{ __plistInteger: "n" }`; coerce any to a number. */
function toInt(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  if (v && typeof v === 'object' && '__plistInteger' in (v as object)) {
    const s = (v as { __plistInteger: string }).__plistInteger;
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/** Map a bibtex {@link GroupRecord} kind to a DTO {@link GroupKind}. */
function groupKindOf(record: GroupRecord): GroupKind {
  return record.kind; // 'static' | 'smart' | 'url' | 'script' — all valid GroupKind values
}

// ---------------------------------------------------------------------------
// BibItem -> DTO projection helpers
// ---------------------------------------------------------------------------

/**
 * Format an item's author/editor display string: join author display names with
 * ", " (final " and " like BibDesk's "and" join), appending " et al." when the
 * field ended with `and others`. Falls back to the Editor field when there are
 * no authors. Returns "" when neither is present.
 */
export function formatAuthorsDisplay(item: BibItem): string {
  const parsed = item.parsedAuthorField(FieldNames.Author, true);
  let people = parsed.authors;
  let others = parsed.hasOthers;
  if (people.length === 0) {
    const ed = item.parsedAuthorField(FieldNames.Editor, true);
    people = ed.authors;
    others = ed.hasOthers;
  }
  if (people.length === 0) return others ? 'et al.' : '';

  const names = people.map((a) => a.displayName);
  let joined: string;
  if (names.length === 1) {
    joined = names[0]!;
  } else {
    joined = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
  }
  return others ? `${joined} et al.` : joined;
}

/**
 * Count an item's local file attachments without needing the library: each
 * `Bdsk-File-N` field is one managed attachment, plus a `Local-Url` if present.
 * (Remote `Url`/`Doi` are not counted — the paperclip means "has a local file".)
 */
function attachmentCountOf(item: BibItem): number {
  let n = 0;
  for (const name of item.fieldNames()) if (BDSK_FILE_RE.test(name)) n++;
  if (item.stringValueOfField('Local-Url', false).trim()) n++;
  return n;
}

/** Project a {@link BibItem} into a thin {@link PublicationRow}. */
export function toPublicationRow(item: BibItem, extraFields?: readonly string[]): PublicationRow {
  // Rating fields hold a small integer (0–5); clamp defensively for display.
  const ratingRaw = parseInt(item.stringValueOfField('Rating', false).trim(), 10);
  const rating = Number.isFinite(ratingRaw) ? Math.max(0, Math.min(5, ratingRaw)) : 0;
  const row: PublicationRow = {
    id: item.id,
    citeKey: item.citeKey,
    type: item.type, // already lowercased by the model
    authorsDisplay: formatAuthorsDisplay(item),
    title: toDisplay(item.stringValueOfField(FieldNames.Title, true)),
    year: item.stringValueOfField(FieldNames.Year, true),
    hasKeywords: item.stringValueOfField('Keywords', false).trim().length > 0,
    attachmentCount: attachmentCountOf(item),
    read: item.triStateValueOfField('Read'),
    rating,
  };
  if (extraFields && extraFields.length > 0) {
    const extra: Record<string, string> = {};
    for (const name of extraFields) extra[name] = toDisplay(item.stringValueOfField(name, true));
    return { ...row, extra };
  }
  return row;
}

/** Comparator factory: case-insensitive numeric-aware string comparison. */
function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Default sort applied to a listing when none is requested: cite key ascending. */
const DEFAULT_SORT_SPECS: readonly SortSpec[] = [{ key: 'citeKey', direction: 'asc' }];

/** Make a folder/group name safe to use as a single filesystem path segment. */
function sanitizeSegment(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'untitled';
}

/** One undo/redo step: a serialized snapshot + a short label for the action it precedes. */
interface UndoStep {
  snap: string;
  label: string;
}

/** Human labels for the Edit-menu "Undo <label>" / "Redo <label>", by EditCommand kind. */
const EDIT_LABELS: Record<string, string> = {
  setField: 'Set Field',
  removeField: 'Remove Field',
  setCiteKey: 'Set Cite Key',
  setType: 'Set Type',
  generateCiteKey: 'Generate Cite Key',
  addEntry: 'Add Entry',
  duplicateEntry: 'Duplicate Entry',
  deleteEntry: 'Delete Entry',
  mergeEntries: 'Merge Entries',
  setMacro: 'Set Macro',
  removeMacro: 'Remove Macro',
};
function labelForEdit(command: { kind: string }): string {
  return EDIT_LABELS[command.kind] ?? 'Edit';
}

/**
 * Sort key extractor for a {@link PublicationRow} by sort key name. Recognises
 * the row columns; unknown keys fall back to cite key.
 */
function rowSortValue(row: PublicationRow, key: string): string {
  switch (key.toLowerCase()) {
    case 'citekey':
    case 'cite key':
      return row.citeKey;
    case 'type':
    case 'bibtex type':
      return row.type;
    case 'author':
    case 'authors':
    case 'authorsdisplay':
      return row.authorsDisplay;
    case 'title':
      return row.title;
    case 'year':
      return row.year;
    // Icon columns: project the numeric/boolean flag to a numeric string so the
    // numeric-aware comparator orders them (rows without the flag sort together).
    case 'keywords':
      return row.hasKeywords ? '1' : '0';
    case 'attachments':
    case 'files':
      return String(row.attachmentCount).padStart(4, '0');
    case 'read':
      return String(row.read + 1); // -1,0,1 -> 0,1,2
    case 'rating':
      return String(row.rating);
    default:
      // An extra-field column sorts by its display value; else fall back to key.
      return row.extra?.[key] ?? row.citeKey;
  }
}

// ---------------------------------------------------------------------------
// ItemDetail projection
// ---------------------------------------------------------------------------

/** Fields that are linked-file / URL fields BibDesk treats as attachments. */
const URL_FIELDS_LOCAL = new Set(['local-url', 'local-file', 'file']);
const URL_FIELDS_REMOTE = new Set(['url', 'doi']);

/** Minimal HTML escape for safe interpolation into the preview card. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Remove BibTeX case-protection / grouping braces for DISPLAY, preserving an
 * escaped literal brace (`\{`/`\}`). BibDesk strips these when showing values in
 * the table/preview (e.g. `{C}alabi-{Y}au` → `Calabi-Yau`, `{{Higgs…}}` → `Higgs…`).
 *
 * Math-aware: braces INSIDE a `$…$` or `$$…$$` span are left untouched, so TeX
 * math (`$\frac{a}{b}$`) survives intact for the preview pane's MathJax pass.
 */
function stripDisplayBraces(s: string): string {
  let out = '';
  let inMath = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '$') {
      if (s[i + 1] === '$') {
        inMath = !inMath;
        out += '$$';
        i++;
        continue;
      }
      inMath = !inMath;
      out += '$';
      continue;
    }
    if (inMath) {
      out += c;
      continue;
    }
    if (c === '\\' && (s[i + 1] === '{' || s[i + 1] === '}')) {
      out += s[i + 1];
      i++;
      continue;
    }
    if (c === '{' || c === '}') continue;
    out += c;
  }
  return out;
}

/** De-TeXify + strip protective braces — the standard read-only display transform. */
export function toDisplay(value: string): string {
  return stripDisplayBraces(detexify(value));
}

/** Raw BibTeX text of a field on an item (for editing): complex → `a # b`, else literal. */
function rawFieldText(item: BibItem, name: string): string {
  const v = item.rawValueOfField(name);
  if (v === undefined) return '';
  return isComplex(v) ? complexValueToBibTeX(v) : v;
}

/**
 * Display value for one field. URL/file/citation/note fields are NOT TeXified on
 * disk, so we show them raw (de-TeXifying a URL could mangle it); everything else
 * goes through {@link toDisplay}.
 */
function fieldDisplayValue(name: string, raw: string): string {
  const lower = name.toLowerCase();
  if (URL_FIELDS_LOCAL.has(lower) || URL_FIELDS_REMOTE.has(lower)) return raw;
  return toDisplay(raw);
}

/** Matches a managed `Bdsk-File-N` attachment field. */
const BDSK_FILE_RE = /^bdsk-file-\d+$/i;

/** Next free `Bdsk-File-N` index for an item (1-based, after the current max). */
function nextBdskFileIndex(item: BibItem): number {
  let max = 0;
  for (const name of item.fieldNames()) {
    const m = /^bdsk-file-(\d+)$/i.exec(name);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return max + 1;
}

/**
 * Derive the attachment list for an item: managed `Bdsk-File-N` blobs (resolved
 * to absolute paths relative to the document, removable), plus attachments
 * synthesised from `Local-Url`/`Url`/`Doi` fields and any model-level linked
 * files. Each maps to `{ kind, displayName, url, field? }`.
 */
export function itemFiles(item: BibItem, lib: BibLibrary, docPath: string): ItemFile[] {
  const out: ItemFile[] = [];
  const seen = new Set<string>();
  const baseDir = docPath ? dirname(docPath) : '';

  const push = (kind: 'file' | 'url', url: string, field?: string): void => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(field !== undefined
      ? { kind, displayName: displayNameForUrl(kind, url), url, field }
      : { kind, displayName: displayNameForUrl(kind, url), url });
  };

  // 1) managed Bdsk-File-N attachments (relative path resolved against the doc)
  for (const name of item.fieldNames()) {
    if (!BDSK_FILE_RE.test(name)) continue;
    const plist = lib.bdskFiles.get(bdskFileKey(item.id, name));
    const rel = plist ? relativePathOf(plist) : undefined;
    if (!rel) continue;
    const abs = baseDir && !isAbsolute(rel) ? resolve(baseDir, rel) : rel;
    push('file', abs, name);
  }

  // 2) model-level linked files
  for (const f of item.files) push(f.kind, f.url);

  // 3) synthesise from URL/file fields
  for (const name of item.fieldNames()) {
    const lower = name.toLowerCase();
    const value = item.stringValueOfField(name, false).trim();
    if (!value) continue;
    if (URL_FIELDS_LOCAL.has(lower)) push('file', value);
    else if (URL_FIELDS_REMOTE.has(lower)) push('url', value);
  }
  return out;
}

/** Return `path`, or `path` with a `-1`, `-2`… suffix until it doesn't exist. */
function uniquePath(path: string): string {
  if (!existsSync(path)) return path;
  const dir = dirname(path);
  const ext = extname(path);
  const stem = basename(path, ext);
  let n = 1;
  let candidate = join(dir, `${stem}-${n}${ext}`);
  while (existsSync(candidate)) candidate = join(dir, `${stem}-${++n}${ext}`);
  return candidate;
}

/** Display name for an attachment: basename for files, host/last-segment for URLs. */
function displayNameForUrl(kind: 'file' | 'url', url: string): string {
  // strip a leading file:// scheme for basename extraction
  let path = url;
  const fileScheme = /^file:\/\/(localhost)?/i;
  if (kind === 'file' && fileScheme.test(path)) {
    path = path.replace(fileScheme, '');
  }
  // take the last path segment
  const cleaned = path.replace(/[/\\]+$/, '');
  const seg = cleaned.split(/[/\\]/).pop() ?? cleaned;
  return seg || url;
}

/**
 * Project a {@link BibItem} into a full {@link ItemDetail}. Includes every set
 * field plus any crossref-inherited fields (flagged `isInherited`), with
 * de-TeXified display values; the attachment list; and a small, safe
 * typographic `previewHtml` card.
 */
/** Classify a field for the renderer's editor widget (TypeManager-driven). */
function fieldKindOf(name: string): FieldKind {
  const tm = sharedTypeManager;
  if (tm.isRatingField(name)) return 'rating';
  if (tm.isBooleanField(name)) return 'boolean';
  if (tm.isTriStateField(name)) return 'triState';
  if (tm.isCitationField(name)) return 'citation';
  if (tm.isPersonField(name)) return 'person';
  if (tm.isURLField(name)) return 'url';
  return 'plain';
}

export function toItemDetail(
  item: BibItem,
  files: ItemFile[],
  citeKeyExists: (key: string) => boolean,
): ItemDetail {
  const fields: ItemField[] = [];
  const emitted = new Set<string>();
  // Fields required for this entry's type must not be deletable in the editor.
  const required = new Set(sharedTypeManager.requiredFieldsForType(item.type).map((f) => f.toLowerCase()));

  // Local fields, in stored order — hiding the managed Bdsk-File-N blobs (shown
  // as attachments), the Annote / Bdsk-Annotation pair (shown + edited in the
  // Annotation section), so neither the prose nor the compressed blob shows as a
  // raw field row.
  const annotationFields = new Set([ANNOTATION_FIELD.toLowerCase(), COMPRESSED_FIELD.toLowerCase()]);
  for (const name of item.fieldNames()) {
    emitted.add(name.toLowerCase());
    if (BDSK_FILE_RE.test(name) || annotationFields.has(name.toLowerCase())) continue;
    fields.push({
      name,
      value: fieldDisplayValue(name, item.stringValueOfField(name, false)),
      rawValue: rawFieldText(item, name),
      isInherited: false,
      kind: fieldKindOf(name),
      required: required.has(name.toLowerCase()),
    });
  }

  // Crossref-inherited fields: walk the parent's fields and include any the
  // child inherits but does not set locally.
  const parent = item.crossrefParent();
  if (parent) {
    for (const name of parent.fieldNames()) {
      const lower = name.toLowerCase();
      if (emitted.has(lower)) continue;
      if (!item.isFieldInherited(name)) continue;
      emitted.add(lower);
      fields.push({
        name,
        value: fieldDisplayValue(name, item.stringValueOfField(name, true)),
        rawValue: rawFieldText(parent, name),
        isInherited: true,
        kind: fieldKindOf(name),
        required: required.has(lower),
      });
    }
  }

  const notesRaw = readAnnotation(item);
  return {
    id: item.id,
    citeKey: item.citeKey,
    type: item.type,
    fields,
    files,
    // Only real file attachments count toward the "📎 N files" chip — remote
    // Url/Doi links have their own chips and must not be counted as files.
    previewHtml: buildPreviewHtml(item, files.filter((f) => f.kind === 'file').length),
    notesRaw,
    notesHtml: renderNotes(notesRaw, citeKeyExists),
  };
}

/** Split a Keywords/Annote-style field into individual tags (`,`/`;`-separated). */
function splitKeywords(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((k) => toDisplay(k).trim())
    .filter((k) => k.length > 0);
}

/**
 * Semantic, themeable HTML card for the preview pane (the "beautiful views"
 * goal). Emits CLASS-based markup (styled by the renderer's CSS, so it themes +
 * supports dark mode) rather than inline styles. Title/abstract keep any `$…$`
 * math spans intact for the renderer's MathJax pass. All interpolated text is
 * de-TeXified (math-aware) and HTML-escaped. Returns undefined when empty.
 */
export function buildPreviewHtml(item: BibItem, fileCount: number): string | undefined {
  const title = toDisplay(item.stringValueOfField(FieldNames.Title, true));
  const authors = formatAuthorsDisplay(item);
  const journal = toDisplay(
    item.stringValueOfField('Journal', true) || item.stringValueOfField('Booktitle', true),
  );
  const year = item.stringValueOfField(FieldNames.Year, true);
  const volume = item.stringValueOfField('Volume', true);
  const pages = toDisplay(item.stringValueOfField('Pages', true));
  const doi = item.stringValueOfField('Doi', true).trim();
  const url = item.stringValueOfField('Url', true).trim();
  const abstractMd = item.stringValueOfField('Abstract', true); // markdown source
  const keywords = splitKeywords(item.stringValueOfField('Keywords', true));

  if (!title && !authors && !journal && !year) return undefined;

  const p: string[] = [];
  p.push(`<article class="bd-card" data-type="${escapeHtml(item.type)}">`);
  p.push(`<div class="bd-card__type">${escapeHtml(item.type)}</div>`);
  if (title) p.push(`<h1 class="bd-card__title">${escapeHtml(title)}</h1>`);
  if (authors) p.push(`<p class="bd-card__authors">${escapeHtml(authors)}</p>`);

  const meta: string[] = [];
  if (journal) meta.push(`<span class="bd-card__journal">${escapeHtml(journal)}</span>`);
  if (volume) meta.push(`<span>vol.&nbsp;${escapeHtml(volume)}</span>`);
  if (pages) meta.push(`<span>pp.&nbsp;${escapeHtml(pages)}</span>`);
  if (year) meta.push(`<span class="bd-card__year">${escapeHtml(year)}</span>`);
  if (meta.length) p.push(`<p class="bd-card__venue">${meta.join('<span class="bd-card__sep">·</span>')}</p>`);

  const chips: string[] = [];
  if (doi)
    chips.push(
      `<button type="button" class="bd-chip bd-chip--doi" data-open-url="${escapeHtml(doi)}">DOI ${escapeHtml(doi)}</button>`,
    );
  if (url)
    chips.push(
      `<button type="button" class="bd-chip bd-chip--url" data-open-url="${escapeHtml(url)}">URL</button>`,
    );
  if (fileCount > 0)
    chips.push(
      `<button type="button" class="bd-chip bd-chip--files" data-open-files="1">📎 ${fileCount} ${fileCount === 1 ? 'file' : 'files'}</button>`,
    );
  if (chips.length) p.push(`<div class="bd-card__chips">${chips.join('')}</div>`);

  if (keywords.length) {
    p.push(
      `<div class="bd-card__tags">${keywords
        .map((k) => `<span class="bd-tag">${escapeHtml(k)}</span>`)
        .join('')}</div>`,
    );
  }

  const abstractHtml = renderMarkdown(abstractMd);
  if (abstractHtml) p.push(`<div class="bd-card__abstract">${abstractHtml}</div>`);
  p.push(`<p class="bd-card__citekey">${escapeHtml(item.citeKey)}</p>`);
  p.push('</article>');
  return p.join('');
}

// ---------------------------------------------------------------------------
// Category groups (author / keyword) — computed from the library
// ---------------------------------------------------------------------------

/** Built category groups: sidebar nodes + a groupId → member item-id set map. */
interface CategoryBuild {
  nodes: GroupNode[];
  members: Map<string, Set<string>>;
}

/**
 * Build the dynamic **Authors** and **Keywords** category sections (BibDesk's
 * "category groups"). Each section is a parent {@link GroupNode} with one child
 * per distinct value; membership is precomputed into `members` (groupId → item
 * ids) so {@link DocumentStore.listPublications} filters by O(1) set lookup. Ids
 * are opaque (`<doc>:cat:authors:<n>`), so author/keyword text never has to be
 * round-tripped through an id.
 */
function buildCategoryGroups(library: BibLibrary, documentId: string): CategoryBuild {
  const nodes: GroupNode[] = [];
  const members = new Map<string, Set<string>>();

  const addSection = (
    sectionId: string,
    sectionName: string,
    childKind: GroupKind,
    valueMap: Map<string, { display: string; ids: Set<string> }>,
  ): void => {
    if (valueMap.size === 0) return;
    const allIds = new Set<string>();
    const children: GroupNode[] = [];
    let idx = 0;
    const sorted = [...valueMap.values()].sort((a, b) => a.display.localeCompare(b.display));
    for (const entry of sorted) {
      const id = `${sectionId}:${idx++}`;
      members.set(id, entry.ids);
      for (const i of entry.ids) allIds.add(i);
      children.push({ id, kind: childKind, name: entry.display, count: entry.ids.size, parentId: sectionId });
    }
    members.set(sectionId, allIds);
    nodes.push({ id: sectionId, kind: 'category', name: sectionName, count: allIds.size });
    nodes.push(...children);
  };

  // Authors (keyed by normalized name; labelled with the display name)
  const authorMap = new Map<string, { display: string; ids: Set<string> }>();
  for (const item of library.items) {
    for (const a of item.authors()) {
      const key = (a.normalizedName || a.displayName || '').trim();
      if (!key) continue;
      let e = authorMap.get(key);
      if (!e) {
        e = { display: a.displayName || a.normalizedName || key, ids: new Set() };
        authorMap.set(key, e);
      }
      e.ids.add(item.id);
    }
  }
  addSection(`${documentId}:cat:authors`, 'Authors', 'author', authorMap);

  // Keywords (case-insensitive key; first-seen casing as the label)
  const kwMap = new Map<string, { display: string; ids: Set<string> }>();
  for (const item of library.items) {
    for (const kw of splitKeywords(item.stringValueOfField('Keywords', true))) {
      const key = kw.toLowerCase();
      let e = kwMap.get(key);
      if (!e) {
        e = { display: kw, ids: new Set() };
        kwMap.set(key, e);
      }
      e.ids.add(item.id);
    }
  }
  addSection(`${documentId}:cat:keywords`, 'Keywords', 'category', kwMap);

  return { nodes, members };
}

// ---------------------------------------------------------------------------
// CSL-JSON mapping (for formatted citations)
// ---------------------------------------------------------------------------

/** BibTeX entry type → CSL-JSON type. */
const CSL_TYPE: Record<string, string> = {
  article: 'article-journal',
  book: 'book',
  inbook: 'chapter',
  incollection: 'chapter',
  inproceedings: 'paper-conference',
  conference: 'paper-conference',
  proceedings: 'book',
  phdthesis: 'thesis',
  mastersthesis: 'thesis',
  techreport: 'report',
  manual: 'book',
  misc: 'document',
  unpublished: 'manuscript',
  booklet: 'pamphlet',
};

/** Parsed author → CSL-JSON name object (family/given/particle/suffix, or literal). */
function toCslName(a: Author): Record<string, string> {
  const out: Record<string, string> = {};
  if (a.last) out.family = a.last;
  if (a.first) out.given = a.first;
  if (a.von) out['non-dropping-particle'] = a.von;
  if (a.jr) out.suffix = a.jr;
  if (!out.family && a.name) out.literal = a.name; // corporate / mononym
  return out;
}

// ---------------------------------------------------------------------------
// DocumentStore — open documents keyed by documentId
// ---------------------------------------------------------------------------

/** A single open document held by the {@link DocumentStore}. */
interface OpenDoc {
  readonly documentId: string;
  path: string;
  readonly library: BibLibrary;
  /** Typed membership groups (library + parsed static/smart). */
  readonly groups: Group[];
  /** id -> BibItem index for O(1) detail lookups. */
  readonly itemsById: Map<string, BibItem>;
  /** Live crossref store; new items are bound to it. */
  readonly crossrefStore: LibraryCrossrefStore;
  /** SQLite FTS5 full-text index (field text + extracted PDF text). */
  readonly fts: FtsIndex;
  /** Field-only FTS5 index (no PDF text) — used when full-text search is toggled off. */
  readonly ftsFields: FtsIndex;
  /** itemId → extracted PDF text from its attachments (filled lazily). */
  readonly pdfText: Map<string, string>;
  /** True once attachment PDF text has been indexed for this document. */
  attachmentsIndexed: boolean;
  /** Unsaved-changes flag, set by edits and cleared on save. */
  dirty: boolean;
}

/** Concatenated searchable text for an item (field text + any indexed PDF text). */
function itemSearchText(item: BibItem, pdfText: string): string {
  const parts: string[] = [item.citeKey, item.type];
  for (const name of item.fieldNames()) {
    if (BDSK_FILE_RE.test(name)) continue; // skip base64 attachment blobs
    parts.push(detexify(item.stringValueOfField(name, false)));
  }
  if (pdfText) parts.push(pdfText);
  return parts.join(' \n ');
}

/** Process-unique temp-file suffix counter (avoids Date.now/random). */
let __tmpSeq = 0;

/**
 * Holds open documents keyed by `documentId` and implements every read the IPC
 * contract exposes. Pure (no Electron): the shell instantiates one of these and
 * forwards `ipcMain.handle` calls into it.
 */
export class DocumentStore {
  private readonly docs = new Map<string, OpenDoc>();

  /** Editing defaults driven by preferences (cite-key format, new-entry type). */
  private editConfig = {
    citeKeyFormat: DEFAULT_CITE_KEY_FORMAT,
    defaultEntryType: 'article',
    papersFolder: '',
    autoFileFormat: '%a1/%Y%u0',
    annotationStorage: 'compressed' as AnnotationStorage,
    defaultCiteStyle: 'apa',
  };

  /** Apply preference-driven editing defaults. */
  setEditConfig(c: {
    citeKeyFormat?: string;
    defaultEntryType?: string;
    papersFolder?: string;
    autoFileFormat?: string;
    annotationStorage?: AnnotationStorage;
    defaultCiteStyle?: string;
  }): void {
    if (c.citeKeyFormat) this.editConfig.citeKeyFormat = c.citeKeyFormat;
    if (c.defaultEntryType) this.editConfig.defaultEntryType = c.defaultEntryType;
    if (c.papersFolder !== undefined) this.editConfig.papersFolder = c.papersFolder;
    if (c.autoFileFormat) this.editConfig.autoFileFormat = c.autoFileFormat;
    if (c.annotationStorage) this.editConfig.annotationStorage = c.annotationStorage;
    if (c.defaultCiteStyle) this.editConfig.defaultCiteStyle = c.defaultCiteStyle;
  }

  // --- Undo / redo (snapshot-based) ------------------------------------------

  /** Per-document undo/redo stacks of labeled serialized-library snapshots. */
  private history = new Map<string, { undo: UndoStep[]; redo: UndoStep[] }>();
  private static readonly UNDO_LIMIT = 100;

  private historyFor(documentId: string): { undo: UndoStep[]; redo: UndoStep[] } {
    let h = this.history.get(documentId);
    if (!h) {
      h = { undo: [], redo: [] };
      this.history.set(documentId, h);
    }
    return h;
  }

  /**
   * Record the current state as an undo point, BEFORE applying a mutation; `label`
   * names the action (shown as "Undo <label>"). Deduplicates against the top of the
   * stack so a nested/composite operation (e.g. a multi-file drop where the outer
   * method and the per-file helpers each snapshot) only contributes one undo step
   * per real change (the first/outer label wins). Clears the redo stack.
   */
  private snapshot(documentId: string, label = 'Edit'): void {
    const doc = this.docs.get(documentId);
    if (!doc) return;
    const h = this.historyFor(documentId);
    const snap = this.serializeDocument(documentId);
    if (h.undo[h.undo.length - 1]?.snap === snap) return; // no change since last snapshot
    h.undo.push({ snap, label });
    if (h.undo.length > DocumentStore.UNDO_LIMIT) h.undo.shift();
    h.redo.length = 0;
  }

  /** Whether undo/redo are available + the next action labels (for the Edit menu). */
  undoState(documentId: string): { canUndo: boolean; canRedo: boolean; undoLabel?: string; redoLabel?: string } {
    const h = this.history.get(documentId);
    const u = h?.undo[h.undo.length - 1];
    const r = h?.redo[h.redo.length - 1];
    return {
      canUndo: u !== undefined,
      canRedo: r !== undefined,
      ...(u ? { undoLabel: u.label } : {}),
      ...(r ? { redoLabel: r.label } : {}),
    };
  }

  /** Undo the last mutation; returns true if a state was restored. */
  undo(documentId: string): boolean {
    const h = this.historyFor(documentId);
    const step = h.undo.pop();
    if (step === undefined) return false;
    h.redo.push({ snap: this.serializeDocument(documentId), label: step.label });
    this.restoreSnapshot(documentId, step.snap);
    return true;
  }

  /** Redo the last undone mutation; returns true if a state was restored. */
  redo(documentId: string): boolean {
    const h = this.historyFor(documentId);
    const step = h.redo.pop();
    if (step === undefined) return false;
    h.undo.push({ snap: this.serializeDocument(documentId), label: step.label });
    this.restoreSnapshot(documentId, step.snap);
    return true;
  }

  /** Rebuild a document's in-memory state from a serialized snapshot (keeps id+path). */
  private restoreSnapshot(documentId: string, text: string): void {
    const prev = this.requireDoc(documentId);
    const { library, crossrefStore } = openLibraryFromText(text, prev.path);
    const itemsById = new Map<string, BibItem>();
    for (const item of library.items) itemsById.set(item.id, item);
    const records = library.items.map((i) => ({ id: i.id, text: itemSearchText(i, '') }));
    const fts = new FtsIndex();
    fts.rebuild(records);
    const ftsFields = new FtsIndex();
    ftsFields.rebuild(records);
    prev.fts.close();
    prev.ftsFields.close();
    const next: OpenDoc = {
      documentId,
      path: prev.path,
      library,
      groups: groupsFromLibrary(library),
      itemsById,
      crossrefStore,
      fts,
      ftsFields,
      pdfText: new Map(),
      attachmentsIndexed: false,
      dirty: true,
    };
    this.docs.set(documentId, next);
  }

  /** Open from already-loaded text. Retains the library and returns the summary. */
  openText(text: string, path: string): OpenedDocument {
    return this.retain(openLibraryFromText(text, path));
  }

  /** Open by reading a `.bib` file from disk (the only I/O entry point). */
  openFile(path: string): OpenedDocument {
    return this.retain(openLibraryFromFile(path));
  }

  /**
   * A fresh {@link OpenedDocument} summary for an already-open document — used to
   * re-notify the renderer after main mutates the doc out-of-band (e.g. Save As
   * changes the path/display name) so the UI re-syncs name + dirty state.
   */
  summarize(documentId: string): OpenedDocument {
    const doc = this.requireDoc(documentId);
    return {
      documentId,
      path: doc.path,
      displayName: basename(doc.path),
      itemCount: doc.library.items.length,
      warnings: [],
      dirty: doc.dirty,
    };
  }

  /** Retain an open result in the store and return its summary. */
  private retain(result: OpenDocumentResult): OpenedDocument {
    const { opened, library, crossrefStore } = result;
    const itemsById = new Map<string, BibItem>();
    for (const item of library.items) itemsById.set(item.id, item);
    const pdfText = new Map<string, string>();
    const records = library.items.map((i) => ({ id: i.id, text: itemSearchText(i, '') }));
    const fts = new FtsIndex();
    fts.rebuild(records);
    const ftsFields = new FtsIndex();
    ftsFields.rebuild(records);
    const doc: OpenDoc = {
      documentId: opened.documentId,
      path: opened.path,
      library,
      groups: groupsFromLibrary(library),
      itemsById,
      crossrefStore,
      fts,
      ftsFields,
      pdfText,
      attachmentsIndexed: false,
      dirty: false,
    };
    this.docs.set(opened.documentId, doc);
    return opened;
  }

  /**
   * Re-index one item in both FTS indexes: the field-only index (`ftsFields`) and
   * the full index (`fts`, field text + any cached PDF text). Keeping them in lock
   * step lets the renderer toggle PDF/full-text search on and off per query.
   */
  private reindex(doc: OpenDoc, item: BibItem): void {
    const fieldText = itemSearchText(item, '');
    doc.ftsFields.upsert(item.id, fieldText);
    doc.fts.upsert(item.id, itemSearchText(item, doc.pdfText.get(item.id) ?? ''));
  }

  /** Drop one item from both FTS indexes (merge/delete). */
  private dropFromIndex(doc: OpenDoc, id: string): void {
    doc.fts.remove(id);
    doc.ftsFields.remove(id);
  }

  /** Recompute the dynamic Author/Keyword category groups for the current state. */
  private categoriesOf(doc: OpenDoc): CategoryBuild {
    return buildCategoryGroups(doc.library, doc.documentId);
  }

  /** True if a document id is currently open. */
  has(documentId: string): boolean {
    return this.docs.has(documentId);
  }

  /** Close a document and release it. Throws if the id is unknown. */
  closeDocument(request: CloseDocumentRequest): ClosedDocument {
    if (!this.docs.delete(request.documentId)) {
      throw new Error(`Unknown documentId: ${request.documentId}`);
    }
    return { documentId: request.documentId };
  }

  /**
   * List a page/range of publications: apply the optional `groupId` membership
   * filter, then sort (default cite-key ascending), then window by offset/limit.
   */
  listPublications(req: ListPublicationsRequest): ListPublicationsResponse {
    const doc = this.requireDoc(req.documentId);

    // 1) membership filter
    let items: readonly BibItem[] = doc.library.items;
    if (req.groupId && req.groupId !== this.libraryGroupId(doc)) {
      const categoryMembers = this.categoriesOf(doc).members.get(req.groupId);
      const group = this.resolveParsedGroup(doc, req.groupId);
      if (categoryMembers) {
        // author/keyword category group: precomputed member set
        items = items.filter((it) => categoryMembers.has(it.id));
      } else if (group) {
        items = items.filter((it) => group.containsItem(asEvaluable(it)));
      } else {
        items = []; // unknown/url/script group => no members in this session
      }
    }

    // 2) project to rows (including any configured extra-field columns)
    const rows = items.map((it) => toPublicationRow(it, req.extraFields));

    // 3) sort by the requested keys in priority order (default: cite key asc).
    //    Stable sort preserves library order for rows equal on every key.
    const specs = req.sort && req.sort.length > 0 ? req.sort : DEFAULT_SORT_SPECS;
    rows.sort((a, b) => {
      for (const spec of specs) {
        const cmp = compareStrings(rowSortValue(a, spec.key), rowSortValue(b, spec.key));
        if (cmp !== 0) return spec.direction === 'desc' ? -cmp : cmp;
      }
      return 0;
    });

    const total = rows.length;

    // 4) window
    const start = Math.max(0, req.offset);
    const end = req.limit < 0 ? rows.length : start + req.limit;
    return { rows: rows.slice(start, end), total };
  }

  /**
   * List the groups sidebar: always a `library` node counting all items, plus
   * one node per parsed group with its member count.
   */
  listGroups(req: ListGroupsRequest): ListGroupsResponse {
    const doc = this.requireDoc(req.documentId);
    const groups: GroupNode[] = [];

    // Always-present Library group.
    groups.push({
      id: this.libraryGroupId(doc),
      kind: 'library',
      name: 'Library',
      count: doc.library.items.length,
    });

    // User folders (containers for groups / sub-folders). Build a group-name →
    // folder-id map so each group node nests under its folder.
    const folders = readFolders(doc.library);
    const groupFolder = new Map<string, string>();
    for (const f of folders) for (const g of f.groups) groupFolder.set(g.toLowerCase(), f.id);
    for (const f of folders) {
      groups.push({
        id: f.id,
        kind: 'folder',
        name: f.name,
        count: f.groups.length,
        ...(f.parentId ? { parentId: f.parentId } : {}),
      });
    }

    // Parsed groups: one node per group DICT (a block can hold several), each
    // with a stable `g#record#dict` id. Counts via live membership; url/script
    // are type-only => 0. parentId nests the group under its folder (if any).
    for (const node of this.parsedGroupNodes(doc)) {
      const parentId = groupFolder.get(node.name.toLowerCase());
      groups.push({
        id: node.id,
        kind: node.kind,
        name: node.name,
        count: node.group
          ? doc.library.items.filter((it) => node.group!.containsItem(asEvaluable(it))).length
          : 0,
        ...(parentId ? { parentId } : {}),
      });
    }

    // Dynamic Author / Keyword category sections (recomputed for current state).
    groups.push(...this.categoriesOf(doc).nodes);

    return { groups };
  }

  /** Enumerate parsed groups with stable `g#record#dict` ids + built membership. */
  private parsedGroupNodes(
    doc: OpenDoc,
  ): { id: string; kind: GroupKind; name: string; group?: Group }[] {
    const out: { id: string; kind: GroupKind; name: string; group?: Group }[] = [];
    for (let ri = 0; ri < doc.library.groups.length; ri++) {
      const record = doc.library.groups[ri]!;
      const dicts = dictsOf(record.data);
      for (let di = 0; di < dicts.length; di++) {
        const dict = dicts[di]!;
        out.push({
          id: `g#${ri}#${di}`,
          kind: record.kind,
          name: nameOfDict(dict),
          group: buildGroupFromDict(record.kind, dict),
        });
      }
    }
    return out;
  }

  /** Resolve a `g#record#dict` group id to its built membership group. */
  private resolveParsedGroup(doc: OpenDoc, groupId: string): Group | undefined {
    const m = /^g#(\d+)#(\d+)$/.exec(groupId);
    if (!m) return undefined;
    const record = doc.library.groups[Number(m[1])];
    if (!record) return undefined;
    const dict = dictsOf(record.data)[Number(m[2])];
    return dict ? buildGroupFromDict(record.kind, dict) : undefined;
  }

  /** Resolve a `g#record#dict` group id to `{record, dict}` for editing, or undefined. */
  private resolveGroupDict(
    doc: OpenDoc,
    groupId: string,
  ): { record: GroupRecord; recordIndex: number; dictIndex: number; dict: Record<string, unknown> } | undefined {
    const m = /^g#(\d+)#(\d+)$/.exec(groupId);
    if (!m) return undefined;
    const recordIndex = Number(m[1]);
    const dictIndex = Number(m[2]);
    const record = doc.library.groups[recordIndex];
    if (!record) return undefined;
    const dict = dictsOf(record.data)[dictIndex];
    return dict ? { record, recordIndex, dictIndex, dict } : undefined;
  }

  /** Find (or create an empty) group record of the given editable kind. */
  private ensureGroupRecord(doc: OpenDoc, kind: 'static' | 'smart'): { index: number; arr: Record<string, unknown>[] } {
    let index = doc.library.groups.findIndex((g) => g.kind === kind);
    if (index === -1) {
      doc.library.groups.push({ kind, data: [] });
      index = doc.library.groups.length - 1;
    }
    return { index, arr: dictsOf(doc.library.groups[index]!.data) };
  }

  /**
   * Apply one {@link GroupCommand}: create/rename/delete a group or change a
   * static group's membership. Groups are stored as `@comment{BibDesk … Groups}`
   * dict-arrays; the serializer writes them back. Marks the document dirty.
   */
  groupEdit(req: GroupEditRequest): GroupEditResult {
    this.snapshot(req.documentId);
    const doc = this.requireDoc(req.documentId);
    const cmd = req.command;
    const dedupe = (keys: readonly string[]): string[] => [...new Set(keys.map((k) => k.trim()).filter(Boolean))];

    switch (cmd.kind) {
      case 'createStatic': {
        const { index, arr } = this.ensureGroupRecord(doc, 'static');
        arr.push({ 'group name': cmd.name, keys: dedupe(cmd.citeKeys ?? []).join(',') });
        doc.dirty = true;
        return { dirty: true, groupId: `g#${index}#${arr.length - 1}` };
      }
      case 'createSmart': {
        const { index, arr } = this.ensureGroupRecord(doc, 'smart');
        arr.push({
          'group name': cmd.name,
          conjunction: plistInteger(String(cmd.conjunction)),
          conditions: cmd.conditions.map((c) => ({
            key: c.key,
            value: c.value,
            comparison: plistInteger(String(c.comparison)),
            version: plistInteger('1'),
          })),
        });
        doc.dirty = true;
        return { dirty: true, groupId: `g#${index}#${arr.length - 1}` };
      }
      case 'editSmart': {
        const r = this.resolveGroupDict(doc, cmd.groupId);
        if (!r || r.record.kind !== 'smart') throw new Error('Not a smart group');
        r.dict['group name'] = cmd.name;
        r.dict.conjunction = plistInteger(String(cmd.conjunction));
        r.dict.conditions = cmd.conditions.map((c) => ({
          key: c.key,
          value: c.value,
          comparison: plistInteger(String(c.comparison)),
          version: plistInteger('1'),
        }));
        doc.dirty = true;
        return { dirty: true, groupId: cmd.groupId };
      }
      case 'rename': {
        const r = this.resolveGroupDict(doc, cmd.groupId);
        if (!r) throw new Error(`Unknown group: ${cmd.groupId}`);
        r.dict['group name'] = cmd.name;
        doc.dirty = true;
        return { dirty: true, groupId: cmd.groupId };
      }
      case 'delete': {
        const r = this.resolveGroupDict(doc, cmd.groupId);
        if (!r) return { dirty: doc.dirty };
        const arr = dictsOf(r.record.data);
        arr.splice(r.dictIndex, 1);
        if (arr.length === 0) doc.library.groups.splice(r.recordIndex, 1);
        doc.dirty = true;
        return { dirty: true };
      }
      case 'setMembers': {
        const r = this.resolveGroupDict(doc, cmd.groupId);
        if (!r || r.record.kind !== 'static') throw new Error('Not a static group');
        const cur = typeof r.dict.keys === 'string' ? (r.dict.keys as string).split(',') : [];
        const set = new Set(cur.map((k) => k.trim()).filter(Boolean));
        for (const k of cmd.citeKeys) (cmd.add ? set.add(k) : set.delete(k));
        r.dict.keys = [...set].join(',');
        doc.dirty = true;
        return { dirty: true, groupId: cmd.groupId };
      }
      case 'createFolder': {
        const folders = readFolders(doc.library);
        const id = nextFolderId(folders);
        folders.push({ id, name: cmd.name, parentId: cmd.parentId ?? null, groups: [] });
        writeFolders(doc.library, folders);
        doc.dirty = true;
        return { dirty: true, groupId: id };
      }
      case 'renameFolder': {
        const folders = readFolders(doc.library);
        if (!folders.some((f) => f.id === cmd.folderId)) return { dirty: doc.dirty };
        writeFolders(
          doc.library,
          folders.map((f) => (f.id === cmd.folderId ? { ...f, name: cmd.name } : f)),
        );
        doc.dirty = true;
        return { dirty: true, groupId: cmd.folderId };
      }
      case 'moveFolder': {
        const folders = readFolders(doc.library);
        if (!folders.some((f) => f.id === cmd.folderId)) return { dirty: doc.dirty };
        const parentId = cmd.parentId ?? null;
        // Refuse to move a folder under itself or a descendant (would orphan a cycle).
        if (parentId && isSelfOrDescendant(folders, cmd.folderId, parentId)) return { dirty: doc.dirty };
        writeFolders(
          doc.library,
          folders.map((f) => (f.id === cmd.folderId ? { ...f, parentId } : f)),
        );
        doc.dirty = true;
        return { dirty: true, groupId: cmd.folderId };
      }
      case 'deleteFolder': {
        const folders = readFolders(doc.library);
        const target = folders.find((f) => f.id === cmd.folderId);
        if (!target) return { dirty: doc.dirty };
        // Child folders move up to the deleted folder's parent; its groups become unfiled.
        const next = folders
          .filter((f) => f.id !== cmd.folderId)
          .map((f) => (f.parentId === cmd.folderId ? { ...f, parentId: target.parentId } : f));
        writeFolders(doc.library, next);
        doc.dirty = true;
        return { dirty: true };
      }
      case 'setGroupFolder': {
        const r = this.resolveGroupDict(doc, cmd.groupId);
        if (!r) return { dirty: doc.dirty };
        const name = nameOfDict(r.dict);
        const lower = name.toLowerCase();
        // Remove the group from every folder, then add it to the target folder (if any).
        const next = readFolders(doc.library).map((f) => ({
          ...f,
          groups: f.groups.filter((g) => g.toLowerCase() !== lower),
        }));
        if (cmd.folderId) next.find((f) => f.id === cmd.folderId)?.groups.push(name);
        writeFolders(doc.library, next);
        doc.dirty = true;
        return { dirty: true, groupId: cmd.groupId };
      }
      default:
        return { dirty: doc.dirty };
    }
  }

  /** Map each parsed group (by lowercased name) to its members' existing file-attachment paths. */
  private groupFilePaths(doc: OpenDoc): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const node of this.parsedGroupNodes(doc)) {
      const files: string[] = [];
      if (node.group) {
        for (const it of doc.library.items) {
          if (!node.group.containsItem(asEvaluable(it))) continue;
          for (const f of itemFiles(it, doc.library, doc.path)) {
            if (f.kind !== 'file') continue;
            const p = f.url.replace(/^file:\/\/(localhost)?/i, '');
            if (existsSync(p)) files.push(p);
          }
        }
      }
      map.set(node.name.toLowerCase(), files);
    }
    return map;
  }

  /**
   * Plan an "Export Folder to PDF Tree": for `rootFolderId` and its descendant
   * folders, one entry per contained group — the relative directory (folder names
   * → directories, then the group name) and the absolute paths of that group's
   * members' file attachments. The caller does the mkdir/copy. Read-only.
   */
  folderExportPlan(documentId: string, rootFolderId: string): { dir: string; files: string[] }[] {
    const doc = this.requireDoc(documentId);
    const folders = readFolders(doc.library);
    const byParent = new Map<string, FolderRecord[]>();
    for (const f of folders) {
      if (!f.parentId) continue;
      const list = byParent.get(f.parentId);
      if (list) list.push(f);
      else byParent.set(f.parentId, [f]);
    }
    const groupFiles = this.groupFilePaths(doc);
    const plan: { dir: string; files: string[] }[] = [];
    const walk = (folder: FolderRecord, prefix: string): void => {
      const dir = prefix + sanitizeSegment(folder.name);
      for (const gname of folder.groups) {
        plan.push({ dir: `${dir}/${sanitizeSegment(gname)}`, files: groupFiles.get(gname.toLowerCase()) ?? [] });
      }
      for (const child of byParent.get(folder.id) ?? []) walk(child, `${dir}/`);
    };
    const root = folders.find((f) => f.id === rootFolderId);
    if (root) walk(root, '');
    return plan;
  }

  /**
   * Read back a smart group's editable definition (name, conjunction, and
   * conditions) so the renderer can pre-populate the smart-group editor.
   * Throws if the group id isn't a smart group.
   */
  groupConditions(req: GroupConditionsRequest): GroupConditionsResponse {
    const doc = this.requireDoc(req.documentId);
    const r = this.resolveGroupDict(doc, req.groupId);
    if (!r || r.record.kind !== 'smart') throw new Error('Not a smart group');
    const raw = Array.isArray(r.dict.conditions)
      ? (r.dict.conditions as Array<Record<string, unknown>>)
      : [];
    const conditions: SmartCondition[] = raw.map((c) => ({
      key: typeof c.key === 'string' ? c.key : '',
      comparison: toInt(c.comparison) || 2,
      value: typeof c.value === 'string' ? c.value : '',
    }));
    return {
      name: nameOfDict(r.dict),
      conjunction: toInt(r.dict.conjunction) === 1 ? 1 : 0,
      conditions,
    };
  }

  /**
   * Rename an author/editor everywhere it appears, across all entries — also the
   * way to **merge** two name forms (rename "J. Smith" to "John Smith" and the two
   * authors collapse into one). Matching is by canonical normalized name, so
   * `oldName` need only be one spelling of the person; only the matched token in
   * each `Author`/`Editor` list is replaced (the others are preserved verbatim).
   * Returns how many entries changed. One undo step.
   */
  renameAuthor(documentId: string, oldName: string, newName: string): { changed: number; dirty: boolean } {
    this.snapshot(documentId);
    const doc = this.requireDoc(documentId);
    const target = makeAuthor(oldName).normalizedName;
    const replacement = newName.trim();
    if (!target || !replacement) return { changed: 0, dirty: doc.dirty };
    let changed = 0;
    for (const item of doc.library.items) {
      let itemTouched = false;
      for (const field of [FieldNames.Author, FieldNames.Editor]) {
        const raw = item.stringValueOfField(field, false);
        if (!raw) continue;
        let touched = false;
        const out = splitNameList(raw).map((n) => {
          if (n === OTHERS) return 'others';
          if (makeAuthor(n).normalizedName === target) {
            touched = true;
            return replacement;
          }
          return n;
        });
        if (touched) {
          item.setField(field, out.join(' and '));
          itemTouched = true;
        }
      }
      if (itemTouched) {
        this.reindex(doc, item);
        changed++;
      }
    }
    if (changed) doc.dirty = true;
    return { changed, dirty: doc.dirty };
  }

  /** Full detail for one item. Throws if the document or item id is unknown. */
  getItemDetail(req: GetItemDetailRequest): ItemDetail {
    const doc = this.requireDoc(req.documentId);
    const item = doc.itemsById.get(req.itemId);
    if (!item) throw new Error(`Unknown itemId: ${req.itemId}`);
    return this.detailFor(doc, item);
  }

  /**
   * Attach one or more local files to an item as managed `Bdsk-File-N` blobs
   * (BibDesk-compatible; stored as a `{ relativePath }` binary-plist relative to
   * the document). Marks the document dirty. Returns the refreshed detail.
   */
  addAttachments(documentId: string, itemId: string, absPaths: readonly string[]): EditResult {
    this.snapshot(documentId);
    const doc = this.requireDoc(documentId);
    const item = this.itemOf(doc, itemId);
    const baseDir = doc.path ? dirname(doc.path) : '';
    let n = nextBdskFileIndex(item);
    for (const abs of absPaths) {
      const rel = baseDir ? relative(baseDir, abs) : abs;
      const field = `Bdsk-File-${n++}`;
      const plist = { relativePath: rel };
      item.setField(field, encodeBdskFile(plist));
      doc.library.bdskFiles.set(bdskFileKey(item.id, field), plist);
    }
    return this.dirtyDetail(doc, item);
  }

  /**
   * AutoFile an item's managed attachments: move each `Bdsk-File-N` file into the
   * configured Papers folder, named by the AutoFile format (BDSKFormatParser,
   * local-file rules), and rewrite the stored relative path. Cross-volume moves
   * fall back to copy. Returns how many files moved + per-file errors. Mirrors
   * BibDesk's "AutoFile Linked File".
   */
  autoFile(documentId: string, itemId: string): { moved: number; errors: string[]; detail: ItemDetail } {
    this.snapshot(documentId);
    const doc = this.requireDoc(documentId);
    const item = this.itemOf(doc, itemId);
    const papers = this.editConfig.papersFolder;
    if (!papers) throw new Error('No Papers folder is configured (set one in Preferences).');
    const baseDir = doc.path ? dirname(doc.path) : '';
    const { moved, errors } = this.autoFileItemFiles(doc, item, papers, baseDir);
    if (moved) {
      doc.dirty = true;
      this.reindex(doc, item);
    }
    return { moved, errors, detail: this.detailFor(doc, item) };
  }

  /**
   * Move one item's managed `Bdsk-File-N` attachments into the Papers folder,
   * named by the AutoFile format, rewriting each stored relative path. Cross-volume
   * moves fall back to copy + delete. Mutates the item + library and returns the
   * file count moved plus any per-file failures (relative to that item). The
   * caller owns the snapshot / `dirty` / reindex so this can back both single-item
   * AutoFile and bulk Consolidate.
   */
  private autoFileItemFiles(
    doc: OpenDoc,
    item: BibItem,
    papers: string,
    baseDir: string,
  ): { moved: number; errors: string[] } {
    const errors: string[] = [];
    let moved = 0;
    for (const name of item.fieldNames()) {
      if (!BDSK_FILE_RE.test(name)) continue;
      const plist = doc.library.bdskFiles.get(bdskFileKey(item.id, name));
      const rel = plist ? relativePathOf(plist) : undefined;
      if (!rel) continue;
      const src = baseDir && !isAbsolute(rel) ? resolve(baseDir, rel) : rel;
      if (!existsSync(src)) {
        errors.push(`${basename(src)}: file not found`);
        continue;
      }
      const ext = extname(src);
      const stem = parseFormat(this.editConfig.autoFileFormat, item, LOCAL_FILE_FIELD, {
        typeManager: sharedTypeManager,
      });
      // Compare against the *intended* name before uniquifying, so a file already
      // at its target is left alone (otherwise uniquePath would keep coining
      // `name-1`, `name-2`, … each run — not idempotent).
      const intended = join(papers, (stem || item.citeKey || 'paper') + ext);
      try {
        if (resolve(src) === resolve(intended)) continue; // already filed
        mkdirSync(dirname(intended), { recursive: true });
        const dest = uniquePath(intended);
        try {
          renameSync(src, dest);
        } catch {
          copyFileSync(src, dest); // cross-volume: copy, then drop the original
          try {
            unlinkSync(src);
          } catch {
            /* leave the original if it can't be removed */
          }
        }
        const newRel = baseDir ? relative(baseDir, dest) : dest;
        const newPlist = { relativePath: newRel };
        item.setField(name, encodeBdskFile(newPlist));
        doc.library.bdskFiles.set(bdskFileKey(item.id, name), newPlist);
        moved++;
      } catch (e) {
        errors.push(`${basename(src)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { moved, errors };
  }

  /**
   * Bulk AutoFile ("Consolidate Linked Files"): run {@link autoFile}'s move logic
   * across every item (or the given `itemIds` subset), moving each managed
   * attachment into the Papers folder. One snapshot backs the whole batch; only
   * items that actually moved a file are reindexed. Returns counts plus per-item
   * errors (each prefixed with the owning entry's cite key). Mirrors BibDesk's
   * "Consolidate Linked Files".
   */
  consolidateLinkedFiles(
    documentId: string,
    itemIds?: readonly string[],
  ): { scanned: number; itemsAffected: number; moved: number; dirty: boolean; errors: string[] } {
    this.snapshot(documentId);
    const doc = this.requireDoc(documentId);
    const papers = this.editConfig.papersFolder;
    if (!papers) throw new Error('No Papers folder is configured (set one in Preferences).');
    const baseDir = doc.path ? dirname(doc.path) : '';

    const targets: readonly BibItem[] =
      itemIds && itemIds.length > 0
        ? itemIds.map((id) => doc.itemsById.get(id)).filter((it): it is BibItem => it !== undefined)
        : doc.library.items;

    const errors: string[] = [];
    let moved = 0;
    let itemsAffected = 0;
    for (const item of targets) {
      const res = this.autoFileItemFiles(doc, item, papers, baseDir);
      if (res.moved > 0) {
        moved += res.moved;
        itemsAffected++;
        this.reindex(doc, item);
      }
      for (const e of res.errors) errors.push(`${item.citeKey}: ${e}`);
    }
    if (moved) doc.dirty = true;
    return { scanned: targets.length, itemsAffected, moved, dirty: doc.dirty, errors };
  }

  /**
   * Resolve the cite keys referenced by a LaTeX `.aux` file to library items
   * ("Select Publications from .aux File"). Returns the matched item ids +
   * matched keys (in `.aux` order) and any cited keys absent from this library.
   * Read-only (no snapshot).
   */
  selectFromAux(
    documentId: string,
    auxText: string,
  ): { matchedIds: string[]; matchedKeys: string[]; missingKeys: string[] } {
    const doc = this.requireDoc(documentId);
    const byKey = new Map<string, string>();
    for (const it of doc.library.items) byKey.set(it.citeKey, it.id);
    const matchedIds: string[] = [];
    const matchedKeys: string[] = [];
    const missingKeys: string[] = [];
    for (const key of parseAuxCiteKeys(auxText)) {
      const id = byKey.get(key);
      if (id !== undefined) {
        matchedIds.push(id);
        matchedKeys.push(key);
      } else {
        missingKeys.push(key);
      }
    }
    return { matchedIds, matchedKeys, missingKeys };
  }

  /**
   * Item ids of publications missing at least one required field for their entry
   * type (a field counts as present if set locally or inherited via crossref).
   * Read-only.
   */
  incompleteItemIds(documentId: string): string[] {
    const doc = this.requireDoc(documentId);
    const out: string[] = [];
    for (const it of doc.library.items) {
      const required = sharedTypeManager.requiredFieldsForType(it.type);
      if (required.some((f) => it.stringValueOfField(f, true).trim() === '')) out.push(it.id);
    }
    return out;
  }

  /**
   * Resolve an attachment URL to a readable local path — but only if it is
   * genuinely one of the item's file attachments (so the renderer can't read
   * arbitrary files). Returns undefined otherwise.
   */
  attachmentPath(documentId: string, itemId: string, url: string): string | undefined {
    const doc = this.docs.get(documentId);
    const item = doc?.itemsById.get(itemId);
    if (!doc || !item) return undefined;
    const f = itemFiles(item, doc.library, doc.path).find((x) => x.url === url && x.kind === 'file');
    if (!f) return undefined;
    const p = f.url.replace(/^file:\/\/(localhost)?/i, '');
    return existsSync(p) ? p : undefined;
  }

  /**
   * Scan the whole document for file attachments whose target is missing on disk
   * (managed `Bdsk-File-N` blobs and synthesised `Local-Url`/file-field links).
   * Returns one {@link BrokenLink} per missing file; managed ones carry their
   * `field` so the caller can relocate or remove them. Read-only (no snapshot).
   */
  findBrokenLinks(documentId: string): BrokenLink[] {
    const doc = this.requireDoc(documentId);
    const out: BrokenLink[] = [];
    for (const item of doc.library.items) {
      for (const f of itemFiles(item, doc.library, doc.path)) {
        if (f.kind !== 'file') continue;
        const path = f.url.replace(/^file:\/\/(localhost)?/i, '');
        if (existsSync(path)) continue;
        out.push({
          itemId: item.id,
          citeKey: item.citeKey,
          displayName: f.displayName,
          path,
          ...(f.field !== undefined ? { field: f.field } : {}),
        });
      }
    }
    return out;
  }

  /**
   * Point a managed attachment (`Bdsk-File-N`) at a new file, rewriting its
   * stored relative path (relative to the document) — used to repair a broken
   * link without moving the file. Marks the document dirty; returns fresh detail.
   */
  relocateAttachment(documentId: string, itemId: string, field: string, newAbsPath: string): EditResult {
    this.snapshot(documentId);
    const doc = this.requireDoc(documentId);
    const item = this.itemOf(doc, itemId);
    if (!BDSK_FILE_RE.test(field)) throw new Error(`Not a managed attachment: ${field}`);
    const baseDir = doc.path ? dirname(doc.path) : '';
    const rel = baseDir ? relative(baseDir, newAbsPath) : newAbsPath;
    const plist = { relativePath: rel };
    item.setField(field, encodeBdskFile(plist));
    doc.library.bdskFiles.set(bdskFileKey(item.id, field), plist);
    return this.dirtyDetail(doc, item);
  }

  /** Remove one managed attachment (`Bdsk-File-N`) from an item. */
  removeAttachment(documentId: string, itemId: string, field: string): EditResult {
    this.snapshot(documentId);
    const doc = this.requireDoc(documentId);
    const item = this.itemOf(doc, itemId);
    item.removeField(field);
    doc.library.bdskFiles.delete(bdskFileKey(item.id, field));
    return this.dirtyDetail(doc, item);
  }

  /**
   * Import a set of BibTeX fields as a new entry (e.g. from an online search),
   * auto-generating a cite key from the imported author/year. Selects it.
   */
  importEntry(documentId: string, entryType: string, fields: Record<string, string>): EditResult {
    this.snapshot(documentId);
    const doc = this.requireDoc(documentId);
    const fv: Record<string, FieldValue> = {};
    for (const [k, v] of Object.entries(fields)) if (v) fv[k] = v;
    const item = createBibItem({
      type: entryType || 'misc',
      citeKey: this.uniqueCiteKey(doc, 'imported'),
      fields: fv,
      macroResolver: doc.library.macroResolver,
      typeManager: sharedTypeManager,
      store: doc.crossrefStore,
    });
    const existing = doc.library.items.map((i) => i.citeKey);
    const generated = generateCiteKey(this.editConfig.citeKeyFormat, item, existing);
    if (generated) item.setCiteKey(this.uniqueCiteKey(doc, generated));
    doc.library.items.push(item);
    doc.itemsById.set(item.id, item);
    return this.dirtyDetail(doc, item);
  }

  /**
   * Parse BibTeX `text` and merge its entries into the document as new items
   * (e.g. a pasted Google Scholar entry, or a dropped `.bib`). Cite keys are kept
   * when free and disambiguated when they collide; managed `Bdsk-File-N` plists
   * are carried over. Returns the new item ids and any non-fatal warnings.
   */
  importBibtexText(documentId: string, text: string): ImportResult {
    this.snapshot(documentId);
    const doc = this.requireDoc(documentId);
    const warnings: string[] = [];
    let incoming: BibLibrary;
    try {
      incoming = parse(text);
    } catch (e) {
      return { dirty: doc.dirty, addedIds: [], warnings: [e instanceof Error ? e.message : String(e)] };
    }
    const addedIds: string[] = [];
    for (const item of incoming.items) {
      item.setStore(doc.crossrefStore);
      const key = item.citeKey.trim();
      const have = new Set(doc.library.items.map((i) => i.citeKey.toLowerCase()));
      if (!key) {
        // No key on the pasted entry: generate one from the cite-key format.
        const base = generateCiteKey(this.editConfig.citeKeyFormat, item, [...have]) || 'imported';
        item.setCiteKey(this.uniqueCiteKey(doc, base));
      } else if (have.has(key.toLowerCase())) {
        // Keep the pasted key but disambiguate against the collision (a -> a-1).
        item.setCiteKey(this.uniqueCiteKey(doc, key));
      }
      // Carry over this item's managed-attachment plists (keyed by the item id,
      // which is a fresh UUID — no collision with the target library).
      for (const name of item.fieldNames()) {
        if (!BDSK_FILE_RE.test(name)) continue;
        const k = bdskFileKey(item.id, name);
        const plist = incoming.bdskFiles.get(k);
        if (plist) doc.library.bdskFiles.set(k, plist);
      }
      doc.library.items.push(item);
      doc.itemsById.set(item.id, item);
      this.reindex(doc, item);
      addedIds.push(item.id);
    }
    if (addedIds.length === 0) warnings.push('No BibTeX entries found in the pasted text.');
    else doc.dirty = true;
    return { dirty: doc.dirty, addedIds, warnings };
  }

  /**
   * Parse RIS `text` (EndNote/Zotero export) and merge its records as new entries.
   * Cite keys are auto-generated from the cite-key format. Returns the new ids.
   */
  importRisText(documentId: string, text: string): ImportResult {
    this.snapshot(documentId);
    const doc = this.requireDoc(documentId);
    return this.addParsedRecords(doc, parseRis(text), 'No RIS records found in the text.');
  }

  /**
   * Parse EndNote `text` — either the Refer/tagged `.enw` format (Google Scholar's
   * "EndNote" export) or EndNote XML — and merge its records as new entries.
   */
  importEndnoteText(documentId: string, text: string): ImportResult {
    this.snapshot(documentId);
    const doc = this.requireDoc(documentId);
    return this.addParsedRecords(doc, parseEndnote(text), 'No EndNote records found in the text.');
  }

  /**
   * Add BibTeX-shaped `{ entryType, fields }` records (from RIS/EndNote) to the
   * document as new entries with freshly generated cite keys. Shared by the RIS
   * and EndNote import paths; assumes the caller already took an undo snapshot.
   */
  private addParsedRecords(doc: OpenDoc, records: RisRecord[], noneFoundMsg: string): ImportResult {
    const addedIds: string[] = [];
    for (const rec of records) {
      const fv: Record<string, FieldValue> = {};
      for (const [k, v] of Object.entries(rec.fields)) if (v) fv[k] = v;
      const item = createBibItem({
        type: rec.entryType || 'misc',
        citeKey: this.uniqueCiteKey(doc, 'imported'),
        fields: fv,
        macroResolver: doc.library.macroResolver,
        typeManager: sharedTypeManager,
        store: doc.crossrefStore,
      });
      const have = doc.library.items.map((i) => i.citeKey);
      const generated = generateCiteKey(this.editConfig.citeKeyFormat, item, have);
      if (generated) item.setCiteKey(this.uniqueCiteKey(doc, generated));
      doc.library.items.push(item);
      doc.itemsById.set(item.id, item);
      this.reindex(doc, item);
      addedIds.push(item.id);
    }
    const warnings = addedIds.length ? [] : [noneFoundMsg];
    if (addedIds.length) doc.dirty = true;
    return { dirty: doc.dirty, addedIds, warnings };
  }

  /**
   * Import dropped files: a `.bib` is parsed and merged, a `.ris` is RIS-imported;
   * any other file becomes a new entry (titled by the file name) with the file
   * attached. Per-file read failures become warnings rather than aborting.
   */
  importFiles(documentId: string, paths: readonly string[]): ImportResult {
    this.snapshot(documentId);
    const doc = this.requireDoc(documentId);
    const addedIds: string[] = [];
    const warnings: string[] = [];
    for (const p of paths) {
      try {
        if (/\.bib$/i.test(p)) {
          const res = this.importBibtexText(documentId, readFileSync(p, 'utf8'));
          addedIds.push(...res.addedIds);
          warnings.push(...res.warnings.map((w) => `${basename(p)}: ${w}`));
        } else if (/\.ris$/i.test(p)) {
          const res = this.importRisText(documentId, readFileSync(p, 'utf8'));
          addedIds.push(...res.addedIds);
          warnings.push(...res.warnings.map((w) => `${basename(p)}: ${w}`));
        } else if (/\.(enw|enl|xml)$/i.test(p)) {
          const res = this.importEndnoteText(documentId, readFileSync(p, 'utf8'));
          addedIds.push(...res.addedIds);
          warnings.push(...res.warnings.map((w) => `${basename(p)}: ${w}`));
        } else {
          const title = basename(p).replace(/\.[^.]+$/, '');
          const item = createBibItem({
            type: this.editConfig.defaultEntryType || 'misc',
            citeKey: this.uniqueCiteKey(doc, title || 'imported'),
            fields: title ? { Title: title } : {},
            macroResolver: doc.library.macroResolver,
            typeManager: sharedTypeManager,
            store: doc.crossrefStore,
          });
          const have = doc.library.items.map((i) => i.citeKey);
          const generated = generateCiteKey(this.editConfig.citeKeyFormat, item, have);
          if (generated) item.setCiteKey(this.uniqueCiteKey(doc, generated));
          doc.library.items.push(item);
          doc.itemsById.set(item.id, item);
          this.addAttachments(documentId, item.id, [p]); // sets dirty, reindexes
          addedIds.push(item.id);
        }
      } catch (e) {
        warnings.push(`${basename(p)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (addedIds.length) doc.dirty = true;
    return { dirty: doc.dirty, addedIds, warnings };
  }

  /**
   * Find (and optionally replace) text across field values. With `apply: false`
   * it only reports matches (a preview); with `apply: true` it performs the
   * replacement, marks the document dirty, and reindexes affected items. Managed
   * `Bdsk-File-N` blob fields are never searched.
   */
  findReplace(req: FindReplaceRequest): FindReplaceResult {
    const doc = this.requireDoc(req.documentId);
    if (!req.find) return { matches: [], total: 0, applied: false, dirty: doc.dirty };
    if (req.apply) this.snapshot(req.documentId); // preview makes no undo point

    let re: RegExp;
    try {
      const pattern = req.regex ? req.find : req.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(pattern, req.caseSensitive ? 'g' : 'gi');
    } catch (e) {
      return {
        matches: [],
        total: 0,
        applied: false,
        dirty: doc.dirty,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    const items = this.membersOf(doc, req.groupId);
    const matches: FindReplaceMatch[] = [];
    let total = 0;
    let mutated = false;

    for (const item of items) {
      const names = req.field ? [req.field] : item.fieldNames();
      for (const name of names) {
        if (BDSK_FILE_RE.test(name)) continue;
        const before = item.stringValueOfField(name, false);
        if (!before) continue;
        const occurrences = before.match(re);
        if (!occurrences || occurrences.length === 0) continue;
        const after = before.replace(re, req.replace);
        total += occurrences.length;
        matches.push({ itemId: item.id, citeKey: item.citeKey, field: name, before, after, count: occurrences.length });
        if (req.apply && after !== before) {
          item.setField(name, after);
          this.reindex(doc, item);
          mutated = true;
        }
      }
    }

    if (mutated) doc.dirty = true;
    return { matches, total, applied: req.apply, dirty: doc.dirty };
  }

  /**
   * Scan for duplicate entries: (1) entries sharing a cite key (case-insensitive)
   * and (2) entries with **equivalent content** — bucketed by the model's
   * `equivalenceKey` (type + required/optional field hash) then confirmed pairwise
   * with `itemsEquivalent` so hash collisions don't produce false groups.
   */
  findDuplicates(documentId: string): FindDuplicatesResult {
    const doc = this.requireDoc(documentId);
    const groups: DuplicateGroup[] = [];
    const involved = new Set<string>();

    const entryOf = (item: BibItem): { id: string; citeKey: string; title: string } => ({
      id: item.id,
      citeKey: item.citeKey,
      title: toDisplay(item.stringValueOfField(FieldNames.Title, true)),
    });

    // (1) identical cite keys
    const byKey = new Map<string, BibItem[]>();
    for (const it of doc.library.items) {
      const k = it.citeKey.trim().toLowerCase();
      if (!k) continue;
      const arr = byKey.get(k);
      if (arr) arr.push(it);
      else byKey.set(k, [it]);
    }
    for (const arr of byKey.values()) {
      if (arr.length < 2) continue;
      groups.push({ kind: 'citeKey', entries: arr.map(entryOf) });
      for (const it of arr) involved.add(it.id);
    }

    // (2) equivalent content — bucket by hash, then split into mutually-equivalent
    // sub-groups (a bucket can hold accidental hash collisions).
    const byEq = new Map<string, BibItem[]>();
    for (const it of doc.library.items) {
      const k = equivalenceKey(it, sharedTypeManager);
      const arr = byEq.get(k);
      if (arr) arr.push(it);
      else byEq.set(k, [it]);
    }
    for (const bucket of byEq.values()) {
      if (bucket.length < 2) continue;
      const subgroups: BibItem[][] = [];
      for (const it of bucket) {
        const g = subgroups.find((sg) => itemsEquivalent(sg[0]!, it, sharedTypeManager));
        if (g) g.push(it);
        else subgroups.push([it]);
      }
      for (const sg of subgroups) {
        if (sg.length < 2) continue;
        // Skip if this exact set is already reported as a cite-key duplicate.
        if (sg.every((it) => involved.has(it.id)) && sg.length === byKey.get(sg[0]!.citeKey.trim().toLowerCase())?.length)
          continue;
        groups.push({ kind: 'content', entries: sg.map(entryOf) });
        for (const it of sg) involved.add(it.id);
      }
    }

    return { groups, total: involved.size };
  }

  /**
   * Merge `otherIds` into `primaryId`: the primary keeps its own field values and
   * gains any it lacks from the others; `Keywords` are unioned and all managed
   * attachments are carried over; then the other entries are deleted. The caller
   * (applyEdit) handles the undo snapshot. Returns the primary's refreshed detail.
   */
  private doMerge(doc: OpenDoc, primaryId: string, otherIds: readonly string[]): EditResult {
    const primary = this.itemOf(doc, primaryId);
    const splitKw = (s: string): string[] => s.split(/[,;]/).map((k) => k.trim()).filter(Boolean);

    for (const otherId of otherIds) {
      const other = doc.itemsById.get(otherId);
      if (!other || other === primary) continue;

      // 1) fill missing scalar fields; union Keywords.
      for (const name of other.fieldNames()) {
        if (BDSK_FILE_RE.test(name)) continue;
        const val = other.stringValueOfField(name, false).trim();
        if (!val) continue;
        if (name.toLowerCase() === 'keywords') {
          const merged = [...new Set([...splitKw(primary.stringValueOfField('Keywords', false)), ...splitKw(val)])];
          primary.setField('Keywords', merged.join(', '));
        } else if (!primary.stringValueOfField(name, false).trim()) {
          primary.setField(name, val);
        }
      }

      // 2) carry over managed (`Bdsk-File-N`) attachments under fresh indices.
      let n = nextBdskFileIndex(primary);
      for (const name of other.fieldNames()) {
        if (!BDSK_FILE_RE.test(name)) continue;
        const plist = doc.library.bdskFiles.get(bdskFileKey(other.id, name));
        if (!plist) continue;
        const field = `Bdsk-File-${n++}`;
        primary.setField(field, encodeBdskFile(plist));
        doc.library.bdskFiles.set(bdskFileKey(primary.id, field), plist);
      }

      // 3) delete the merged-away entry.
      const idx = doc.library.items.indexOf(other);
      if (idx >= 0) doc.library.items.splice(idx, 1);
      doc.itemsById.delete(other.id);
      this.dropFromIndex(doc, other.id);
    }

    this.reindex(doc, primary);
    return this.dirtyDetail(doc, primary);
  }

  /** Items in scope for an operation: a group's members, or the whole library. */
  private membersOf(doc: OpenDoc, groupId?: string): readonly BibItem[] {
    if (!groupId || groupId === this.libraryGroupId(doc)) return doc.library.items;
    const categoryMembers = this.categoriesOf(doc).members.get(groupId);
    if (categoryMembers) return doc.library.items.filter((it) => categoryMembers.has(it.id));
    const group = this.resolveParsedGroup(doc, groupId);
    if (group) return doc.library.items.filter((it) => group.containsItem(asEvaluable(it)));
    return [];
  }

  /**
   * Distinct existing values for a field across the library, for editor
   * autocomplete. Keyword-like fields (`Keywords`) and citation fields are split
   * into their individual comma/semicolon-separated tokens. Values are deduped
   * case-insensitively, sorted, and capped.
   */
  fieldSuggestions(documentId: string, field: string): { values: string[] } {
    const doc = this.requireDoc(documentId);
    const lower = field.toLowerCase();
    const tokenized = lower === 'keywords' || sharedTypeManager.isCitationField(field);
    const seen = new Map<string, string>(); // lowercased -> first-seen original
    for (const item of doc.library.items) {
      const raw = item.stringValueOfField(field, false).trim();
      if (!raw) continue;
      const parts = tokenized ? raw.split(/[,;]/).map((p) => p.trim()) : [raw];
      for (const p of parts) {
        if (!p) continue;
        const k = p.toLowerCase();
        if (!seen.has(k)) seen.set(k, p);
        if (seen.size >= 500) break;
      }
      if (seen.size >= 500) break;
    }
    return { values: [...seen.values()].sort((a, b) => a.localeCompare(b)) };
  }

  /**
   * Apply a {@link BatchOp} to many items as ONE undo step: set/clear a field,
   * add/remove a keyword (deduped, case-insensitive), or delete. Returns how many
   * items actually changed.
   */
  batchEdit(documentId: string, itemIds: readonly string[], op: BatchOp): BatchEditResult {
    this.snapshot(documentId);
    const doc = this.requireDoc(documentId);
    const splitKw = (s: string): string[] => s.split(/[,;]/).map((k) => k.trim()).filter(Boolean);
    let count = 0;

    for (const id of itemIds) {
      const item = doc.itemsById.get(id);
      if (!item) continue;
      switch (op.kind) {
        case 'setField': {
          if (op.value === '') item.removeField(op.field);
          else item.setField(op.field, op.value);
          this.reindex(doc, item);
          count++;
          break;
        }
        case 'addKeyword': {
          const kws = splitKw(item.stringValueOfField('Keywords', false));
          if (!kws.some((k) => k.toLowerCase() === op.keyword.toLowerCase())) {
            kws.push(op.keyword);
            item.setField('Keywords', kws.join(', '));
            this.reindex(doc, item);
            count++;
          }
          break;
        }
        case 'removeKeyword': {
          const kws = splitKw(item.stringValueOfField('Keywords', false));
          const next = kws.filter((k) => k.toLowerCase() !== op.keyword.toLowerCase());
          if (next.length !== kws.length) {
            if (next.length) item.setField('Keywords', next.join(', '));
            else item.removeField('Keywords');
            this.reindex(doc, item);
            count++;
          }
          break;
        }
        case 'delete': {
          const idx = doc.library.items.indexOf(item);
          if (idx >= 0) doc.library.items.splice(idx, 1);
          doc.itemsById.delete(item.id);
          this.dropFromIndex(doc, item.id);
          count++;
          break;
        }
      }
    }

    if (count) doc.dirty = true;
    return { dirty: doc.dirty, count };
  }

  /** True if the document has unsaved edits. */
  isDirty(documentId: string): boolean {
    return this.requireDoc(documentId).dirty;
  }

  /** One field's value (crossref-inherited), case-insensitive name; '' if absent/unknown. */
  fieldValue(documentId: string, itemId: string, field: string): string {
    const item = this.docs.get(documentId)?.itemsById.get(itemId);
    return item ? item.stringValueOfField(field, true) : '';
  }

  /** Resolve a cite key (case-insensitive) to an item id, or undefined. */
  itemIdForCiteKey(documentId: string, citeKey: string): string | undefined {
    const doc = this.requireDoc(documentId);
    const lower = citeKey.trim().toLowerCase();
    return doc.library.items.find((i) => i.citeKey.toLowerCase() === lower)?.id;
  }

  /**
   * Full-text search via SQLite FTS5; returns matching item ids best-match first.
   * `available` is false when the native index couldn't load (caller should fall
   * back to a client-side substring filter). With `includePdf` it searches the
   * full index (field text + extracted PDF body text); otherwise the field-only
   * index, so attachment contents don't flood results.
   */
  ftsSearch(
    documentId: string,
    query: string,
    includePdf = false,
  ): { available: boolean; ids: string[] } {
    const doc = this.requireDoc(documentId);
    const index = includePdf ? doc.fts : doc.ftsFields;
    const ids = index.search(query).filter((id) => doc.itemsById.has(id));
    return { available: index.available, ids };
  }

  /**
   * Extract text from local PDF attachments and fold it into the full-text index
   * (best-effort, once per document). Intended to run in the background after a
   * document opens; the field-text index already works immediately.
   *
   * `extract` is injected so the main process can run pdfjs in a worker-thread
   * pool (off the main loop) and consult a persistent text cache; the default is
   * the inline single-PDF extractor (used by tests and any non-Electron caller).
   */
  async indexAttachments(
    documentId: string,
    extract: (absPath: string) => Promise<string> = extractPdfText,
  ): Promise<void> {
    const doc = this.docs.get(documentId);
    if (!doc || doc.attachmentsIndexed || !doc.fts.available) return;
    doc.attachmentsIndexed = true;
    const stripScheme = (u: string): string => u.replace(/^file:\/\/(localhost)?/i, '');
    const baseDir = doc.path ? dirname(doc.path) : '';
    // Yield to the event loop between items so a long all-cache-hit reopen (no
    // worker round-trip to interleave) still services IPC/UI rather than bursting.
    const yieldToLoop = (): Promise<void> => new Promise((r) => setImmediate(r));
    for (const item of doc.library.items) {
      // The document may be closed (or re-opened) while indexing is in flight.
      if (this.docs.get(documentId) !== doc) return;
      let added = '';
      for (const f of itemFiles(item, doc.library, doc.path)) {
        if (f.kind !== 'file' || !/\.pdf$/i.test(f.url)) continue;
        const p = stripScheme(f.url);
        const abs = isAbsolute(p) ? p : baseDir ? resolve(baseDir, p) : p;
        if (!existsSync(abs)) continue;
        await yieldToLoop();
        const text = await extract(abs);
        if (text) added += ` \n ${text}`;
      }
      if (added) {
        doc.pdfText.set(item.id, (doc.pdfText.get(item.id) ?? '') + added);
        this.reindex(doc, item);
      }
    }
  }

  /**
   * Set (or, when `rawValue` is empty, remove) a field on an item, mark the
   * document dirty, and return the item's refreshed detail. `rawValue` is the
   * raw BibTeX field text (not the de-TeXified display form); it is stored as a
   * literal string value (macro/complex editing comes later).
   */
  updateField(
    documentId: string,
    itemId: string,
    fieldName: string,
    rawValue: string,
  ): ItemDetail {
    const doc = this.requireDoc(documentId);
    const item = doc.itemsById.get(itemId);
    if (!item) throw new Error(`Unknown itemId: ${itemId}`);
    if (rawValue === '') item.removeField(fieldName);
    else item.setField(fieldName, rawValue);
    doc.dirty = true;
    this.reindex(doc, item);
    return this.detailFor(doc, item);
  }

  /**
   * Apply one {@link EditCommand}: mutate the in-memory model, mark the document
   * dirty, and return the outcome (the affected item's refreshed detail when one
   * applies). Structural commands (add/duplicate/delete) and macro commands carry
   * no `detail`/affected item beyond what is created.
   */
  applyEdit(req: ApplyEditRequest): EditResult {
    this.snapshot(req.documentId, labelForEdit(req.command));
    const doc = this.requireDoc(req.documentId);
    const cmd = req.command;
    switch (cmd.kind) {
      case 'setField': {
        const item = this.itemOf(doc, cmd.itemId);
        // The annotation field is markdown: store it safely (compressed blob, or
        // an escaped readable form) rather than wrapping raw braces into the .bib.
        if (cmd.field.toLowerCase() === ANNOTATION_FIELD.toLowerCase()) {
          writeAnnotation(item, cmd.value, this.editConfig.annotationStorage);
        } else if (cmd.value === '') item.removeField(cmd.field);
        else item.setField(cmd.field, cmd.value);
        return this.dirtyDetail(doc, item);
      }
      case 'removeField': {
        const item = this.itemOf(doc, cmd.itemId);
        item.removeField(cmd.field);
        return this.dirtyDetail(doc, item);
      }
      case 'setCiteKey': {
        const item = this.itemOf(doc, cmd.itemId);
        item.setCiteKey(cmd.citeKey);
        return this.dirtyDetail(doc, item);
      }
      case 'setType': {
        const item = this.itemOf(doc, cmd.itemId);
        item.setType(cmd.entryType);
        return this.dirtyDetail(doc, item);
      }
      case 'generateCiteKey': {
        const item = this.itemOf(doc, cmd.itemId);
        const existing = doc.library.items.filter((i) => i !== item).map((i) => i.citeKey);
        item.setCiteKey(generateCiteKey(this.editConfig.citeKeyFormat, item, existing));
        return this.dirtyDetail(doc, item);
      }
      case 'addEntry': {
        const item = createBibItem({
          type: cmd.entryType || this.editConfig.defaultEntryType,
          citeKey: this.uniqueCiteKey(doc, 'untitled'),
          macroResolver: doc.library.macroResolver,
          typeManager: sharedTypeManager,
          store: doc.crossrefStore,
        });
        if (cmd.crossref) item.setField('Crossref', cmd.crossref);
        doc.library.items.push(item);
        doc.itemsById.set(item.id, item);
        return this.dirtyDetail(doc, item);
      }
      case 'duplicateEntry': {
        const src = this.itemOf(doc, cmd.itemId);
        const fields: Record<string, FieldValue> = {};
        for (const name of src.fieldNames()) {
          const v = src.rawValueOfField(name);
          if (v !== undefined) fields[name] = v;
        }
        const item = createBibItem({
          type: src.type,
          citeKey: this.uniqueCiteKey(doc, `${src.citeKey}-copy`),
          fields,
          macroResolver: doc.library.macroResolver,
          typeManager: sharedTypeManager,
          store: doc.crossrefStore,
        });
        doc.library.items.push(item);
        doc.itemsById.set(item.id, item);
        return this.dirtyDetail(doc, item);
      }
      case 'deleteEntry': {
        const item = this.itemOf(doc, cmd.itemId);
        const idx = doc.library.items.indexOf(item);
        if (idx >= 0) doc.library.items.splice(idx, 1);
        doc.itemsById.delete(item.id);
        this.dropFromIndex(doc, item.id);
        doc.dirty = true;
        return { dirty: true };
      }
      case 'mergeEntries':
        return this.doMerge(doc, cmd.primaryId, cmd.otherIds);
      case 'setMacro': {
        this.fileTier(doc).define(cmd.name, cmd.value);
        doc.dirty = true;
        return { dirty: true };
      }
      case 'removeMacro': {
        this.fileTier(doc).undefine(cmd.name);
        doc.dirty = true;
        return { dirty: true };
      }
    }
  }

  /**
   * Map one item to a CSL-JSON object (for citation-js / formatted citations).
   * Reuses the parsed author/editor names and de-TeXified field text. Returns a
   * plain object (no citeproc dependency here — formatting lives in `csl.ts`).
   */
  cslItemFor(documentId: string, itemId: string): Record<string, unknown> {
    const doc = this.requireDoc(documentId);
    const item = this.itemOf(doc, itemId);
    const disp = (f: string): string => toDisplay(item.stringValueOfField(f, true));
    const raw = (f: string): string => item.stringValueOfField(f, true).trim();

    const csl: Record<string, unknown> = {
      id: item.citeKey || item.id,
      type: CSL_TYPE[item.type] ?? 'document',
    };
    const set = (key: string, value: string): void => {
      if (value) csl[key] = value;
    };
    set('title', disp(FieldNames.Title));
    set('container-title', disp('Journal') || disp('Booktitle'));
    set('volume', raw('Volume'));
    set('issue', raw('Number'));
    set('page', disp('Pages').replace(/--/g, '–'));
    set('publisher', disp('Publisher'));
    set('publisher-place', disp('Address'));
    set('DOI', raw('Doi'));
    set('URL', raw('Url'));
    set('abstract', disp('Abstract'));

    const authors = item.authors().map(toCslName);
    if (authors.length) csl.author = authors;
    const editors = item.editors().map(toCslName);
    if (editors.length) csl.editor = editors;

    const year = parseInt(raw(FieldNames.Year), 10);
    if (!Number.isNaN(year)) csl.issued = { 'date-parts': [[year]] };
    return csl;
  }

  /** List the document's file-level `@string` macros, in dependency order. */
  listMacros(req: ListMacrosRequest): ListMacrosResponse {
    const doc = this.requireDoc(req.documentId);
    const macros: MacroDef[] = this.fileTier(doc)
      .orderedLocalDefinitions()
      .map((d) => ({
        name: d.name,
        value: isComplex(d.value) ? complexValueToBibTeX(d.value) : String(d.value),
      }));
    return { macros };
  }

  /** Re-serialize the (possibly edited) in-memory library back to BibTeX text. */
  serializeDocument(documentId: string): string {
    return serialize(this.requireDoc(documentId).library);
  }

  /**
   * Serialize a document, or a chosen subset of its items, to text in the given
   * format. `bibtex` is implemented (whole-library via the round-trip serializer;
   * a subset as standalone entry blocks). Other formats throw until the export
   * feature lands, so callers can surface a clear "not yet supported" message.
   */
  exportText(documentId: string, format: ExportFormat, itemIds?: readonly string[]): string {
    const doc = this.requireDoc(documentId);
    const items: BibItem[] = itemIds
      ? itemIds.map((id) => doc.itemsById.get(id)).filter((it): it is BibItem => it !== undefined)
      : [...doc.library.items];

    switch (format) {
      case 'bibtex':
        if (!itemIds) return serialize(doc.library);
        // Subset: emit each selected entry as a standalone block (no header/macros).
        return items.map((it) => serializeEntry(it, doc.library.bdskFiles)).join('\n\n') + (items.length ? '\n' : '');
      case 'bibtex-minimal': {
        // Minimal BibTeX: drop BibDesk admin fields (file blobs, dates, rating/read,
        // local-url), keeping the bibliographic content. Serialize clean clones (no
        // crossref store, so the duplicate cite key never clobbers the original).
        const admin = new Set(['date-added', 'date-modified', 'rating', 'read', 'local-url']);
        const blocks = items.map((it) => {
          const fields: Record<string, FieldValue> = {};
          for (const name of it.fieldNames()) {
            if (admin.has(name.toLowerCase()) || BDSK_FILE_RE.test(name)) continue;
            const v = it.rawValueOfField(name);
            if (v !== undefined) fields[name] = v;
          }
          const clone = createBibItem({
            type: it.type,
            citeKey: it.citeKey,
            fields,
            macroResolver: doc.library.macroResolver,
            typeManager: sharedTypeManager,
          });
          return serializeEntry(clone, new Map());
        });
        return blocks.join('\n\n') + (items.length ? '\n' : '');
      }
      case 'ris':
        return exportRis(items);
      case 'csv':
        return exportCsv(items);
      case 'html':
        return exportHtml(items, basename(doc.path).replace(/\.bib$/i, '') || 'Bibliography');
      default:
        throw new Error(`Export format "${format}" is not supported yet.`);
    }
  }

  /**
   * Render the library (or a subset, or a small preview slice) through a user
   * Handlebars export template. `opts.limit` caps the entry count (used by the
   * live preview); the doc's display name (sans `.bib`) is the template `title`.
   * Throws `Template error: …` on a bad template.
   */
  renderExportTemplate(
    documentId: string,
    body: string,
    opts: { itemIds?: readonly string[]; limit?: number } = {},
  ): string {
    const doc = this.requireDoc(documentId);
    let items: readonly BibItem[] =
      opts.itemIds && opts.itemIds.length
        ? opts.itemIds.map((id) => doc.itemsById.get(id)).filter((it): it is BibItem => it !== undefined)
        : doc.library.items;
    if (opts.limit !== undefined) items = items.slice(0, opts.limit);
    const title = (doc.path ? basename(doc.path).replace(/\.bib$/i, '') : '') || 'Bibliography';
    return renderTemplate(body, items, { title });
  }

  /**
   * Save the document to disk: explicit-save semantics with a backup. Serializes
   * the in-memory library, copies any existing file to `<path>.bak`, then writes
   * atomically (temp file in the same dir, then rename over the target). Clears
   * the dirty flag. `targetPath` overrides the document's own path (Save As).
   */
  saveDocument(documentId: string, targetPath?: string): { documentId: string; path: string } {
    const doc = this.requireDoc(documentId);
    const path = resolve(targetPath ?? doc.path);
    const text = serialize(doc.library);

    if (existsSync(path)) copyFileSync(path, `${path}.bak`);

    const tmp = `${path}.tmp.${process.pid}.${__tmpSeq++}`;
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, path); // atomic on the same filesystem

    doc.path = path;
    doc.dirty = false;
    return { documentId, path };
  }

  // --- internals -----------------------------------------------------------

  private requireDoc(documentId: string): OpenDoc {
    const doc = this.docs.get(documentId);
    if (!doc) throw new Error(`Unknown documentId: ${documentId}`);
    return doc;
  }

  private itemOf(doc: OpenDoc, itemId: string): BibItem {
    const item = doc.itemsById.get(itemId);
    if (!item) throw new Error(`Unknown itemId: ${itemId}`);
    return item;
  }

  /** Document-aware item detail (resolves managed attachments + notes cross-refs). */
  private detailFor(doc: OpenDoc, item: BibItem): ItemDetail {
    const keys = new Set(doc.library.items.map((i) => i.citeKey.toLowerCase()));
    const detail = toItemDetail(item, itemFiles(item, doc.library, doc.path), (k) =>
      keys.has(k.toLowerCase()),
    );
    // Render the configurable detail + bottom panels (default templates reproduce
    // ViewPane / the annotation reader); the renderer hydrates them, falling back
    // to its React pane if detailsPanelHtml is absent.
    const citeStyle = this.editConfig.defaultCiteStyle;
    return {
      ...detail,
      detailsPanelHtml: renderDetailsPanel(detail, doc.documentId, citeStyle),
      bottomPanelHtml: renderBottomPanel(detail, doc.documentId, citeStyle),
    };
  }

  /** Mark dirty, re-index for search, and return the affected item's detail. */
  private dirtyDetail(doc: OpenDoc, item: BibItem): EditResult {
    doc.dirty = true;
    this.reindex(doc, item);
    return { dirty: true, affectedItemId: item.id, detail: this.detailFor(doc, item) };
  }

  /** The file-level (`@string`) macro tier (parent of the document tier). */
  private fileTier(doc: OpenDoc) {
    return doc.library.macroResolver.parent ?? doc.library.macroResolver;
  }

  /** A cite key based on `base`, suffixed `-1`, `-2`… until unique in the doc. */
  private uniqueCiteKey(doc: OpenDoc, base: string): string {
    const have = new Set(doc.library.items.map((i) => i.citeKey.toLowerCase()));
    if (!have.has(base.toLowerCase())) return base;
    let n = 1;
    while (have.has(`${base}-${n}`.toLowerCase())) n++;
    return `${base}-${n}`;
  }

  /** Stable, per-document id for the synthetic Library group. */
  private libraryGroupId(doc: OpenDoc): string {
    return `${doc.documentId}:library`;
  }
}
