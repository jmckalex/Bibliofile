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

import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { parse, type BibLibrary, type GroupRecord } from '@bibdesk/bibtex';
import {
  type BibItem,
  type PublicationStore,
  FieldNames,
} from '@bibdesk/model';
import { detexify } from '@bibdesk/tex';
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
}

// ---------------------------------------------------------------------------
// Pure crossref store over a parsed library
// ---------------------------------------------------------------------------

/**
 * Case-insensitive cite-key lookup over a library's items, used to resolve
 * crossref parents. BibDesk's `itemForCiteKey:` returns the FIRST item when keys
 * collide, so we build the map in file order and keep the first occurrence.
 */
class LibraryCrossrefStore implements PublicationStore {
  private readonly byLowerKey = new Map<string, BibItem>();
  constructor(items: readonly BibItem[]) {
    for (const item of items) {
      const k = item.citeKey.toLowerCase();
      if (!this.byLowerKey.has(k)) this.byLowerKey.set(k, item);
    }
  }
  itemForCiteKey(citeKey: string): BibItem | undefined {
    return this.byLowerKey.get(citeKey.toLowerCase());
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
  // inheritance / isFieldInherited would be inert without this.
  const store = new LibraryCrossrefStore(library.items);
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
  return { opened, library };
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

/** Project a {@link BibItem} into a thin {@link PublicationRow}. */
export function toPublicationRow(item: BibItem): PublicationRow {
  return {
    id: item.id,
    citeKey: item.citeKey,
    type: item.type, // already lowercased by the model
    authorsDisplay: formatAuthorsDisplay(item),
    title: toDisplay(item.stringValueOfField(FieldNames.Title, true)),
    year: item.stringValueOfField(FieldNames.Year, true),
  };
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
    default:
      return row.citeKey;
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
 */
function stripDisplayBraces(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
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

/**
 * Derive the attachment list for an item. Prefers the model's `files` array;
 * since the bibtex parser does not populate it in this read-only path, we also
 * synthesize attachments from the well-known URL/file fields so the detail view
 * is useful. Each maps to `{ kind, displayName (basename), url }`.
 */
export function itemFiles(item: BibItem): ItemFile[] {
  const out: ItemFile[] = [];
  const seen = new Set<string>();

  const push = (kind: 'file' | 'url', url: string): void => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ kind, displayName: displayNameForUrl(kind, url), url });
  };

  // 1) model-level linked files (kind already known)
  for (const f of item.files) push(f.kind, f.url);

  // 2) synthesize from URL/file fields (the common case for parsed .bib files)
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
export function toItemDetail(item: BibItem): ItemDetail {
  const fields: ItemField[] = [];
  const emitted = new Set<string>();

  // Local fields, in stored order.
  for (const name of item.fieldNames()) {
    emitted.add(name.toLowerCase());
    fields.push({
      name,
      value: fieldDisplayValue(name, item.stringValueOfField(name, false)),
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
        isInherited: true,
      });
    }
  }

  return {
    id: item.id,
    citeKey: item.citeKey,
    type: item.type,
    fields,
    files: itemFiles(item),
    previewHtml: buildPreviewHtml(item),
  };
}

/**
 * A small, self-contained, safe typographic HTML card for the preview pane —
 * an early taste of the "beautiful views" goal. All interpolated values are
 * de-TeXified and HTML-escaped; styling is inline so the renderer needs no
 * stylesheet to show it. Returns undefined when the item has no displayable
 * content at all.
 */
export function buildPreviewHtml(item: BibItem): string | undefined {
  const title = toDisplay(item.stringValueOfField(FieldNames.Title, true));
  const authors = formatAuthorsDisplay(item);
  const journal = toDisplay(
    item.stringValueOfField('Journal', true) ||
      item.stringValueOfField('Booktitle', true),
  );
  const year = item.stringValueOfField(FieldNames.Year, true);

  if (!title && !authors && !journal && !year) return undefined;

  const parts: string[] = [];
  parts.push('<article class="bibdesk-preview" style="font-family:Georgia,\'Times New Roman\',serif;line-height:1.45;color:#1a1a1a;max-width:46rem">');
  if (title) {
    parts.push(
      `<h1 style="font-size:1.35rem;font-weight:600;margin:0 0 .35rem">${escapeHtml(title)}</h1>`,
    );
  }
  if (authors) {
    parts.push(
      `<p class="authors" style="font-style:italic;color:#444;margin:0 0 .5rem">${escapeHtml(authors)}</p>`,
    );
  }
  const meta: string[] = [];
  if (journal) meta.push(`<span class="journal">${escapeHtml(journal)}</span>`);
  if (year) meta.push(`<span class="year">${escapeHtml(year)}</span>`);
  if (meta.length) {
    parts.push(
      `<p class="meta" style="color:#666;margin:0;font-size:.95rem">${meta.join(' &middot; ')}</p>`,
    );
  }
  parts.push(
    `<p class="citekey" style="color:#999;margin:.6rem 0 0;font-family:ui-monospace,Menlo,monospace;font-size:.8rem">${escapeHtml(item.citeKey)} &middot; ${escapeHtml(item.type)}</p>`,
  );
  parts.push('</article>');
  return parts.join('');
}

// ---------------------------------------------------------------------------
// DocumentStore — open documents keyed by documentId
// ---------------------------------------------------------------------------

/** A single open document held by the {@link DocumentStore}. */
interface OpenDoc {
  readonly documentId: string;
  readonly path: string;
  readonly library: BibLibrary;
  /** Typed membership groups (library + parsed static/smart). */
  readonly groups: Group[];
  /** id -> BibItem index for O(1) detail lookups. */
  readonly itemsById: Map<string, BibItem>;
}

/**
 * Holds open documents keyed by `documentId` and implements every read the IPC
 * contract exposes. Pure (no Electron): the shell instantiates one of these and
 * forwards `ipcMain.handle` calls into it.
 */
export class DocumentStore {
  private readonly docs = new Map<string, OpenDoc>();

  /** Open from already-loaded text. Retains the library and returns the summary. */
  openText(text: string, path: string): OpenedDocument {
    return this.retain(openLibraryFromText(text, path));
  }

  /** Open by reading a `.bib` file from disk (the only I/O entry point). */
  openFile(path: string): OpenedDocument {
    return this.retain(openLibraryFromFile(path));
  }

  /** Retain an open result in the store and return its summary. */
  private retain(result: OpenDocumentResult): OpenedDocument {
    const { opened, library } = result;
    const itemsById = new Map<string, BibItem>();
    for (const item of library.items) itemsById.set(item.id, item);
    this.docs.set(opened.documentId, {
      documentId: opened.documentId,
      path: opened.path,
      library,
      groups: groupsFromLibrary(library),
      itemsById,
    });
    return opened;
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
      const group = doc.groups.find((g) => g.id === req.groupId);
      if (group) {
        items = items.filter((it) => group.containsItem(asEvaluable(it)));
      } else {
        items = []; // unknown/url/script group => no members in this session
      }
    }

    // 2) project to rows
    const rows = items.map(toPublicationRow);

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
    return { groups };
  }

  /** Full detail for one item. Throws if the document or item id is unknown. */
  getItemDetail(req: GetItemDetailRequest): ItemDetail {
    const doc = this.requireDoc(req.documentId);
    const item = doc.itemsById.get(req.itemId);
    if (!item) throw new Error(`Unknown itemId: ${req.itemId}`);
    return toItemDetail(item);
  }

  // --- internals -----------------------------------------------------------

  private requireDoc(documentId: string): OpenDoc {
    const doc = this.docs.get(documentId);
    if (!doc) throw new Error(`Unknown documentId: ${documentId}`);
    return doc;
  }

  /** Stable, per-document id for the synthetic Library group. */
  private libraryGroupId(doc: OpenDoc): string {
    return `${doc.documentId}:library`;
  }
}
