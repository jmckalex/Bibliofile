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

import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import {
  parse,
  serialize,
  serializeEntry,
  bdskFileKey,
  encodeBdskFile,
  relativePathOf,
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
import { generateCiteKey, DEFAULT_CITE_KEY_FORMAT } from '@bibdesk/formats';
import type { Author } from '@bibdesk/names';
import { detexify } from '@bibdesk/tex';
import { renderMarkdown, renderNotes } from './markdown.js';
import { exportRis, exportCsv, exportHtml } from './export.js';
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
  ListGroupsRequest,
  ListGroupsResponse,
  GroupNode,
  GroupKind,
  GetItemDetailRequest,
  ItemDetail,
  ItemField,
  ItemFile,
  PublicationRow,
  ParseWarning,
  ApplyEditRequest,
  EditResult,
  ListMacrosRequest,
  ListMacrosResponse,
  MacroDef,
  ExportFormat,
  ImportResult,
  FindReplaceRequest,
  FindReplaceResult,
  FindReplaceMatch,
  FindDuplicatesResult,
  DuplicateGroup,
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
    const built = buildGroup(record);
    if (built) out.push(built);
  }
  return out;
}

/** Build one typed group from an already-decoded record, or undefined to skip. */
function buildGroup(record: GroupRecord): Group | undefined {
  const data = record.data as Record<string, unknown>;
  // Name is already unescaped by the parser — read it directly (no re-unescape).
  const name = typeof data['group name'] === 'string' ? (data['group name'] as string) : '';

  switch (record.kind) {
    case 'static': {
      const keysStr = typeof data.keys === 'string' ? (data.keys as string) : '';
      const keys =
        keysStr === ''
          ? []
          : keysStr
              .split(',')
              .map((k) => k.trim())
              .filter((k) => k.length > 0);
      return new StaticGroup(name, keys);
    }
    case 'smart': {
      const filter = filterFromDecoded(data);
      return new SmartGroup(name, filter);
    }
    // url / script are persisted but type-only (no live fetch/exec) here, so
    // they never have members — represented as nodes with count 0 by listGroups,
    // but we don't need a membership object for them.
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
export function toItemDetail(
  item: BibItem,
  files: ItemFile[],
  citeKeyExists: (key: string) => boolean,
): ItemDetail {
  const fields: ItemField[] = [];
  const emitted = new Set<string>();

  // Local fields, in stored order — hiding the managed Bdsk-File-N blobs (shown
  // as attachments) and Annote (shown + edited in the Notes section).
  for (const name of item.fieldNames()) {
    emitted.add(name.toLowerCase());
    if (BDSK_FILE_RE.test(name) || name.toLowerCase() === 'annote') continue;
    fields.push({
      name,
      value: fieldDisplayValue(name, item.stringValueOfField(name, false)),
      rawValue: rawFieldText(item, name),
      isInherited: false,
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
      });
    }
  }

  const notesRaw = item.stringValueOfField('Annote', false);
  return {
    id: item.id,
    citeKey: item.citeKey,
    type: item.type,
    fields,
    files,
    previewHtml: buildPreviewHtml(item, files.length),
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
      `<span class="bd-chip bd-chip--files">📎 ${fileCount} ${fileCount === 1 ? 'file' : 'files'}</span>`,
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
  private editConfig = { citeKeyFormat: DEFAULT_CITE_KEY_FORMAT, defaultEntryType: 'article' };

  /** Apply preference-driven editing defaults. */
  setEditConfig(c: { citeKeyFormat?: string; defaultEntryType?: string }): void {
    if (c.citeKeyFormat) this.editConfig.citeKeyFormat = c.citeKeyFormat;
    if (c.defaultEntryType) this.editConfig.defaultEntryType = c.defaultEntryType;
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
    };
  }

  /** Retain an open result in the store and return its summary. */
  private retain(result: OpenDocumentResult): OpenedDocument {
    const { opened, library, crossrefStore } = result;
    const itemsById = new Map<string, BibItem>();
    for (const item of library.items) itemsById.set(item.id, item);
    const fts = new FtsIndex();
    const pdfText = new Map<string, string>();
    fts.rebuild(library.items.map((i) => ({ id: i.id, text: itemSearchText(i, '') })));
    const doc: OpenDoc = {
      documentId: opened.documentId,
      path: opened.path,
      library,
      groups: groupsFromLibrary(library),
      itemsById,
      crossrefStore,
      fts,
      pdfText,
      attachmentsIndexed: false,
      dirty: false,
    };
    this.docs.set(opened.documentId, doc);
    return opened;
  }

  /** Re-index one item's full-text entry (field text + any cached PDF text). */
  private reindex(doc: OpenDoc, item: BibItem): void {
    doc.fts.upsert(item.id, itemSearchText(item, doc.pdfText.get(item.id) ?? ''));
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
      const group = doc.groups.find((g) => g.id === req.groupId);
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

    // 3) sort (default cite key asc)
    const sortKey = req.sort?.key ?? 'citeKey';
    const dir = req.sort?.direction ?? 'asc';
    const factor = dir === 'desc' ? -1 : 1;
    rows.sort((a, b) => factor * compareStrings(rowSortValue(a, sortKey), rowSortValue(b, sortKey)));

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

    // Parsed groups (counts via membership; url/script are type-only => 0).
    for (let i = 0; i < doc.library.groups.length; i++) {
      const record = doc.library.groups[i]!;
      const data = record.data as Record<string, unknown>;
      const name = typeof data['group name'] === 'string' ? (data['group name'] as string) : '';
      // find the matching built membership group (static/smart) if any
      const built = doc.groups.find(
        (g) => g.name === name && g.kind === record.kind,
      );
      let count = 0;
      if (built) {
        count = doc.library.items.filter((it) => built.containsItem(asEvaluable(it))).length;
      }
      groups.push({
        id: built?.id ?? `${record.kind}:${i}:${name}`,
        kind: groupKindOf(record),
        name,
        count,
      });
    }

    // Dynamic Author / Keyword category sections (recomputed for current state).
    groups.push(...this.categoriesOf(doc).nodes);

    return { groups };
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

  /** Remove one managed attachment (`Bdsk-File-N`) from an item. */
  removeAttachment(documentId: string, itemId: string, field: string): EditResult {
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
   * Import dropped files: a `.bib` is parsed and merged; any other file becomes a
   * new entry (titled by the file name) with the file attached. Per-file read
   * failures are collected as warnings rather than aborting the whole drop.
   */
  importFiles(documentId: string, paths: readonly string[]): ImportResult {
    const doc = this.requireDoc(documentId);
    const addedIds: string[] = [];
    const warnings: string[] = [];
    for (const p of paths) {
      try {
        if (/\.bib$/i.test(p)) {
          const res = this.importBibtexText(documentId, readFileSync(p, 'utf8'));
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

  /** Items in scope for an operation: a group's members, or the whole library. */
  private membersOf(doc: OpenDoc, groupId?: string): readonly BibItem[] {
    if (!groupId || groupId === this.libraryGroupId(doc)) return doc.library.items;
    const categoryMembers = this.categoriesOf(doc).members.get(groupId);
    if (categoryMembers) return doc.library.items.filter((it) => categoryMembers.has(it.id));
    const group = doc.groups.find((g) => g.id === groupId);
    if (group) return doc.library.items.filter((it) => group.containsItem(asEvaluable(it)));
    return [];
  }

  /** True if the document has unsaved edits. */
  isDirty(documentId: string): boolean {
    return this.requireDoc(documentId).dirty;
  }

  /**
   * Full-text search via SQLite FTS5; returns matching item ids best-match first.
   * `available` is false when the native index couldn't load (caller should fall
   * back to a client-side substring filter).
   */
  ftsSearch(documentId: string, query: string): { available: boolean; ids: string[] } {
    const doc = this.requireDoc(documentId);
    const ids = doc.fts.search(query).filter((id) => doc.itemsById.has(id));
    return { available: doc.fts.available, ids };
  }

  /**
   * Extract text from local PDF attachments and fold it into the full-text index
   * (best-effort, once per document). Intended to run in the background after a
   * document opens; the field-text index already works immediately.
   */
  async indexAttachments(documentId: string): Promise<void> {
    const doc = this.docs.get(documentId);
    if (!doc || doc.attachmentsIndexed || !doc.fts.available) return;
    doc.attachmentsIndexed = true;
    const stripScheme = (u: string): string => u.replace(/^file:\/\/(localhost)?/i, '');
    const baseDir = doc.path ? dirname(doc.path) : '';
    for (const item of doc.library.items) {
      let added = '';
      for (const f of itemFiles(item, doc.library, doc.path)) {
        if (f.kind !== 'file' || !/\.pdf$/i.test(f.url)) continue;
        const p = stripScheme(f.url);
        const abs = isAbsolute(p) ? p : baseDir ? resolve(baseDir, p) : p;
        if (!existsSync(abs)) continue;
        const text = await extractPdfText(abs);
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
    const doc = this.requireDoc(req.documentId);
    const cmd = req.command;
    switch (cmd.kind) {
      case 'setField': {
        const item = this.itemOf(doc, cmd.itemId);
        if (cmd.value === '') item.removeField(cmd.field);
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
        doc.fts.remove(item.id);
        doc.dirty = true;
        return { dirty: true };
      }
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
    return toItemDetail(item, itemFiles(item, doc.library, doc.path), (k) =>
      keys.has(k.toLowerCase()),
    );
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
