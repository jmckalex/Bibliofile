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
import { basename, resolve } from 'node:path';

import { parse, serialize, type BibLibrary, type GroupRecord } from '@bibdesk/bibtex';
import {
  type BibItem,
  type PublicationStore,
  type FieldValue,
  FieldNames,
  createBibItem,
  sharedTypeManager,
  complexValueToBibTeX,
  isComplex,
} from '@bibdesk/model';
import { generateCiteKey, DEFAULT_CITE_KEY_FORMAT } from '@bibdesk/formats';
import type { Author } from '@bibdesk/names';
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
  ApplyEditRequest,
  EditResult,
  ListMacrosRequest,
  ListMacrosResponse,
  MacroDef,
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

  return {
    id: item.id,
    citeKey: item.citeKey,
    type: item.type,
    fields,
    files: itemFiles(item),
    previewHtml: buildPreviewHtml(item),
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
export function buildPreviewHtml(item: BibItem): string | undefined {
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
  const abstract = toDisplay(item.stringValueOfField('Abstract', true));
  const keywords = splitKeywords(item.stringValueOfField('Keywords', true));
  const fileCount = itemFiles(item).length;

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

  if (abstract) p.push(`<p class="bd-card__abstract">${escapeHtml(abstract)}</p>`);
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
  /** Unsaved-changes flag, set by edits and cleared on save. */
  dirty: boolean;
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
    const { opened, library, crossrefStore } = result;
    const itemsById = new Map<string, BibItem>();
    for (const item of library.items) itemsById.set(item.id, item);
    this.docs.set(opened.documentId, {
      documentId: opened.documentId,
      path: opened.path,
      library,
      groups: groupsFromLibrary(library),
      itemsById,
      crossrefStore,
      dirty: false,
    });
    return opened;
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

    // Dynamic Author / Keyword category sections (recomputed for current state).
    groups.push(...this.categoriesOf(doc).nodes);

    return { groups };
  }

  /** Full detail for one item. Throws if the document or item id is unknown. */
  getItemDetail(req: GetItemDetailRequest): ItemDetail {
    const doc = this.requireDoc(req.documentId);
    const item = doc.itemsById.get(req.itemId);
    if (!item) throw new Error(`Unknown itemId: ${req.itemId}`);
    return toItemDetail(item);
  }

  /** True if the document has unsaved edits. */
  isDirty(documentId: string): boolean {
    return this.requireDoc(documentId).dirty;
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
    return toItemDetail(item);
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
        item.setCiteKey(generateCiteKey(DEFAULT_CITE_KEY_FORMAT, item, existing));
        return this.dirtyDetail(doc, item);
      }
      case 'addEntry': {
        const item = createBibItem({
          type: cmd.entryType || 'misc',
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

  /** Mark dirty and return the affected item's refreshed detail. */
  private dirtyDetail(doc: OpenDoc, item: BibItem): EditResult {
    doc.dirty = true;
    return { dirty: true, affectedItemId: item.id, detail: toItemDetail(item) };
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
