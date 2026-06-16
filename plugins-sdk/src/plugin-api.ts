/**
 * `PluginApi` — the in-memory library facade that every BibDesk plugin (and the
 * Claude scripting assistant) talks to.
 *
 * It wraps a parsed `@bibdesk/bibtex` {@link BibLibrary} and exposes a clean,
 * STABLE surface split into four groups:
 *   - **Query (read):** `entries`, `getById`, `getByCiteKey`, `find`, `search`,
 *     `count` — all returning {@link Entry} wrappers (display-aware, read-only).
 *   - **Mutate (write):** `setField`, `removeField`, `setCiteKey`, `setType`,
 *     `addEntry`, `duplicateEntry`, `deleteEntry`, `generateCiteKey`. Every write
 *     keeps cite keys unique within the library and fires a change event.
 *   - **Macros:** `macros`, `setMacro`, `removeMacro` — driven by the library's
 *     file-tier {@link MacroResolver} (where a file's `@string`s live).
 *   - **Library-level:** `toBibTeX` (whole library), `import` (parse + merge with
 *     key disambiguation), `duplicates` (groups of equivalent entries).
 *
 * Design notes (matching the app's `document-service`, the reference consumer):
 *   - The bibtex parser does NOT wire a crossref {@link PublicationStore}, so we
 *     install a live one here; otherwise inheritance reads are inert.
 *   - New cite keys are disambiguated `base` -> `base-1` -> `base-2`,
 *     case-insensitively, exactly like the app.
 *   - The "file tier" is `library.macroResolver.parent ?? library.macroResolver`.
 *
 * Pure: no Electron / DOM / Node APIs. The caller supplies the library (usually
 * via `parse(text)`); file I/O is never performed here.
 */

import {
  type BibItem,
  type FieldValue,
  type PublicationStore,
  type MacroResolver,
  createBibItem,
  sharedTypeManager,
  equivalenceKey,
  Emitter,
} from '@bibdesk/model';
import { parse, serialize, bdskFileKey, type BibLibrary } from '@bibdesk/bibtex';
import { generateCiteKey, DEFAULT_CITE_KEY_FORMAT } from '@bibdesk/formats';

import { Entry } from './entry.js';
import type {
  ChangeListener,
  LibraryChangeEvent,
  NewEntryData,
  PluginApiOptions,
  Unsubscribe,
} from './types.js';

/**
 * Live, case-insensitive cite-key lookup used to resolve crossref parents. It
 * reads against the *current* item array, so adds/deletes/renames stay
 * consistent without rebuilding. Returns the FIRST match on a collision (as
 * BibDesk's `itemForCiteKey:` does).
 */
class LibraryCrossrefStore implements PublicationStore {
  constructor(private readonly getItems: () => readonly BibItem[]) {}
  itemForCiteKey(citeKey: string): BibItem | undefined {
    const k = citeKey.toLowerCase();
    return this.getItems().find((i) => i.citeKey.toLowerCase() === k);
  }
}

export class PluginApi {
  private readonly library: BibLibrary;
  private readonly citeKeyFormat: string;
  private readonly store: LibraryCrossrefStore;
  /** id -> BibItem index, kept in sync with `library.items`. */
  private readonly byId = new Map<string, BibItem>();
  private readonly changes = new Emitter<LibraryChangeEvent>();

  constructor(library: BibLibrary, opts: PluginApiOptions = {}) {
    this.library = library;
    this.citeKeyFormat = opts.citeKeyFormat ?? DEFAULT_CITE_KEY_FORMAT;

    // Wire crossref resolution (the parser leaves it unset) and index by id.
    this.store = new LibraryCrossrefStore(() => this.library.items);
    for (const item of this.library.items) {
      item.setStore(this.store);
      this.byId.set(item.id, item);
    }
  }

  // === Query (read) ==========================================================

  /** Number of entries in the library. */
  count(): number {
    return this.library.items.length;
  }

  /** All entries, in file order, as {@link Entry} wrappers. */
  entries(): Entry[] {
    return this.library.items.map((i) => this.wrap(i));
  }

  /** The entry with this stable id, or `undefined`. */
  getById(id: string): Entry | undefined {
    const item = this.byId.get(id);
    return item ? this.wrap(item) : undefined;
  }

  /**
   * The first entry whose cite key matches (case-insensitive), or `undefined`.
   * Matches the crossref store's collision behavior.
   */
  getByCiteKey(citeKey: string): Entry | undefined {
    const item = this.store.itemForCiteKey(citeKey);
    return item ? this.wrap(item) : undefined;
  }

  /** The first entry satisfying `predicate`, or `undefined`. */
  find(predicate: (entry: Entry) => boolean): Entry | undefined {
    for (const item of this.library.items) {
      const entry = this.wrap(item);
      if (predicate(entry)) return entry;
    }
    return undefined;
  }

  /** Every entry satisfying `predicate`, in file order. */
  filter(predicate: (entry: Entry) => boolean): Entry[] {
    return this.entries().filter(predicate);
  }

  /**
   * Case-insensitive substring search across cite key, type, and the common
   * display fields (Title, Author, Editor, Journal, Booktitle, Year, Keywords,
   * Abstract, Note). Field text is de-TeXified before matching so a search for
   * "Godel" finds `G{\"o}del`. Empty/whitespace query returns all entries.
   */
  search(text: string): Entry[] {
    const needle = text.trim().toLowerCase();
    if (needle === '') return this.entries();
    const fields = SEARCH_FIELDS;
    const out: Entry[] = [];
    for (const item of this.library.items) {
      const entry = this.wrap(item);
      let hit =
        entry.citeKey.toLowerCase().includes(needle) ||
        entry.type.toLowerCase().includes(needle);
      if (!hit) {
        for (const f of fields) {
          if (entry.displayField(f).toLowerCase().includes(needle)) {
            hit = true;
            break;
          }
        }
      }
      if (hit) out.push(entry);
    }
    return out;
  }

  // === Mutate (write) ========================================================

  /**
   * Set a field's value on an entry (case-insensitive name). Pass a plain string
   * or a complex/macro {@link FieldValue}. Fires a `field` change.
   */
  setField(id: string, name: string, value: FieldValue): Entry {
    const item = this.requireItem(id);
    item.setField(name, value);
    return this.emitAndWrap(item, { kind: 'field', entryId: id, field: name });
  }

  /** Remove a field from an entry. Fires a `field` change. */
  removeField(id: string, name: string): Entry {
    const item = this.requireItem(id);
    item.removeField(name);
    return this.emitAndWrap(item, { kind: 'field', entryId: id, field: name });
  }

  /**
   * Set an entry's cite key. The requested key is disambiguated against the rest
   * of the library so it stays unique (e.g. a collision becomes `key-1`). Fires
   * a `citeKey` change. Returns the entry (read its `citeKey` for the final key).
   */
  setCiteKey(id: string, citeKey: string): Entry {
    const item = this.requireItem(id);
    const unique = this.uniqueCiteKey(citeKey, item);
    item.setCiteKey(unique);
    return this.emitAndWrap(item, { kind: 'citeKey', entryId: id });
  }

  /** Set an entry's type (lowercased). Fires a `type` change. */
  setType(id: string, type: string): Entry {
    const item = this.requireItem(id);
    item.setType(type);
    return this.emitAndWrap(item, { kind: 'type', entryId: id });
  }

  /**
   * Add a new entry. A `citeKey` is generated (and made unique) when omitted; a
   * supplied one is disambiguated if it collides. The entry is appended to the
   * library and indexed. Fires an `addEntry` change. Returns the new entry.
   */
  addEntry(data: NewEntryData): Entry {
    const fields: Record<string, FieldValue> = { ...(data.fields ?? {}) };
    const item = createBibItem({
      type: data.type || 'misc',
      // start with the requested key (made unique) or empty (filled below)
      citeKey: data.citeKey ? this.uniqueCiteKey(data.citeKey) : '',
      fields,
      macroResolver: this.library.macroResolver,
      typeManager: sharedTypeManager,
      store: this.store,
    });
    if (!data.citeKey) {
      const generated =
        generateCiteKey(this.citeKeyFormat, item, this.existingKeys()) || 'entry';
      item.setCiteKey(this.uniqueCiteKey(generated, item));
    }
    this.insert(item);
    return this.emitAndWrap(item, {
      kind: 'addEntry',
      entryId: item.id,
      addedIds: [item.id],
    });
  }

  /**
   * Duplicate an entry: copy its raw field values into a new entry of the same
   * type, with a fresh id and a unique `<citeKey>-copy` key. Fires an `addEntry`
   * change. Returns the new entry.
   */
  duplicateEntry(id: string): Entry {
    const src = this.requireItem(id);
    const fields: Record<string, FieldValue> = {};
    for (const name of src.fieldNames()) {
      const v = src.rawValueOfField(name);
      if (v !== undefined) fields[name] = v;
    }
    const item = createBibItem({
      type: src.type,
      citeKey: this.uniqueCiteKey(`${src.citeKey}-copy`),
      fields,
      macroResolver: this.library.macroResolver,
      typeManager: sharedTypeManager,
      store: this.store,
    });
    this.insert(item);
    return this.emitAndWrap(item, {
      kind: 'addEntry',
      entryId: item.id,
      addedIds: [item.id],
    });
  }

  /** Delete an entry by id. Fires a `deleteEntry` change. Returns `true` if removed. */
  deleteEntry(id: string): boolean {
    const item = this.byId.get(id);
    if (!item) return false;
    const idx = this.library.items.indexOf(item);
    if (idx >= 0) this.library.items.splice(idx, 1);
    this.byId.delete(id);
    this.changes.emit({ kind: 'deleteEntry', entryId: id });
    return true;
  }

  /**
   * Generate and assign a fresh cite key for an entry from the configured
   * cite-key format (and make it unique). Fires a `citeKey` change. Returns the
   * new key.
   */
  generateCiteKey(id: string): string {
    const item = this.requireItem(id);
    const generated =
      generateCiteKey(this.citeKeyFormat, item, this.existingKeys(item)) || 'entry';
    const unique = this.uniqueCiteKey(generated, item);
    item.setCiteKey(unique);
    this.changes.emit({ kind: 'citeKey', entryId: id });
    return unique;
  }

  // === Macros ================================================================

  /**
   * The file-tier macros (`@string` definitions), name -> raw {@link FieldValue}.
   * Built-in month macros (which live in the lower global tier) are not included.
   */
  macros(): Record<string, FieldValue> {
    const tier = this.fileTier();
    const out: Record<string, FieldValue> = {};
    for (const name of tier.localMacroNames()) {
      const def = tier.definitionOf(name);
      if (def !== undefined) out[name] = def;
    }
    return out;
  }

  /** Define or replace a file-tier macro. Fires a `macro` change. */
  setMacro(name: string, value: FieldValue): void {
    this.fileTier().define(name, value);
    this.changes.emit({ kind: 'macro', macro: name });
  }

  /** Remove a file-tier macro (no-op if undefined). Fires a `macro` change. */
  removeMacro(name: string): void {
    this.fileTier().undefine(name);
    this.changes.emit({ kind: 'macro', macro: name });
  }

  // === Library-level =========================================================

  /** Serialize the whole library to canonical BibDesk BibTeX. */
  toBibTeX(): string {
    return serialize(this.library);
  }

  /**
   * Parse `text` and merge its entries into this library as new items. Cite keys
   * are kept when free, generated when blank, and disambiguated when they collide
   * (`a` -> `a-1`); each new entry gets a fresh id and is wired for crossref. Any
   * `bdsk-file-N` managed-attachment plists are carried over. Fires one `import`
   * change. Returns the new entries.
   */
  import(text: string): Entry[] {
    const incoming = parse(text);
    const added: BibItem[] = [];
    for (const item of incoming.items) {
      item.setStore(this.store);
      item.setMacroResolver(this.library.macroResolver);
      const key = item.citeKey.trim();
      if (!key) {
        const base =
          generateCiteKey(this.citeKeyFormat, item, this.existingKeys()) || 'imported';
        item.setCiteKey(this.uniqueCiteKey(base));
      } else if (this.hasCiteKey(key)) {
        item.setCiteKey(this.uniqueCiteKey(key));
      }
      // Carry over managed-attachment plists (keyed by the fresh item id).
      for (const name of item.fieldNames()) {
        if (!BDSK_FILE_RE.test(name)) continue;
        const k = bdskFileKey(item.id, name);
        const plist = incoming.bdskFiles.get(k);
        if (plist) this.library.bdskFiles.set(k, plist);
      }
      this.insert(item);
      added.push(item);
    }
    if (added.length > 0) {
      this.changes.emit({
        kind: 'import',
        addedIds: added.map((i) => i.id),
      });
    }
    return added.map((i) => this.wrap(i));
  }

  /**
   * Groups of mutually-equivalent entries (likely duplicates), keyed by the
   * model's {@link equivalenceKey}. Only groups with 2+ members are returned; a
   * library with no duplicates returns `[]`. Within a group, entries are returned
   * in file order.
   */
  duplicates(): Entry[][] {
    const groups = new Map<string, BibItem[]>();
    for (const item of this.library.items) {
      const key = equivalenceKey(item, sharedTypeManager);
      const arr = groups.get(key);
      if (arr) arr.push(item);
      else groups.set(key, [item]);
    }
    const out: Entry[][] = [];
    for (const arr of groups.values()) {
      if (arr.length >= 2) out.push(arr.map((i) => this.wrap(i)));
    }
    return out;
  }

  // === Events ================================================================

  /**
   * Subscribe to library changes. The listener fires after every mutation
   * completes. Returns an {@link Unsubscribe} that removes it.
   */
  onChange(listener: ChangeListener): Unsubscribe {
    return this.changes.subscribe(listener);
  }

  // === internals =============================================================

  /** The bibtex library this API wraps, for advanced consumers. */
  get bibLibrary(): BibLibrary {
    return this.library;
  }

  private wrap(item: BibItem): Entry {
    return new Entry(item, this.library);
  }

  private emitAndWrap(item: BibItem, event: LibraryChangeEvent): Entry {
    this.changes.emit(event);
    return this.wrap(item);
  }

  private requireItem(id: string): BibItem {
    const item = this.byId.get(id);
    if (!item) throw new Error(`No entry with id "${id}"`);
    return item;
  }

  private insert(item: BibItem): void {
    this.library.items.push(item);
    this.byId.set(item.id, item);
  }

  /** The file tier where a document's `@string` macros live. */
  private fileTier(): MacroResolver {
    return this.library.macroResolver.parent ?? this.library.macroResolver;
  }

  /** Lowercased cite keys currently in the library, optionally excluding one item. */
  private existingKeys(exclude?: BibItem): string[] {
    const out: string[] = [];
    for (const i of this.library.items) {
      if (i === exclude) continue;
      out.push(i.citeKey);
    }
    return out;
  }

  /** Is `citeKey` already present (case-insensitive), ignoring `exclude`? */
  private hasCiteKey(citeKey: string, exclude?: BibItem): boolean {
    const k = citeKey.toLowerCase();
    for (const i of this.library.items) {
      if (i === exclude) continue;
      if (i.citeKey.toLowerCase() === k) return true;
    }
    return false;
  }

  /**
   * Return `base` if free, otherwise the first free `base-1`, `base-2`, …
   * (case-insensitive). `exclude` lets an item keep its own key as a candidate
   * (so re-setting an entry's key to itself is a no-op rather than `key-1`).
   */
  private uniqueCiteKey(base: string, exclude?: BibItem): string {
    const have = new Set<string>();
    for (const i of this.library.items) {
      if (i === exclude) continue;
      have.add(i.citeKey.toLowerCase());
    }
    if (!have.has(base.toLowerCase())) return base;
    let n = 1;
    while (have.has(`${base}-${n}`.toLowerCase())) n++;
    return `${base}-${n}`;
  }
}

/**
 * Factory for {@link PluginApi}. Prefer this over `new PluginApi(...)` so the
 * construction site reads as part of the SDK's public surface.
 */
export function createPluginApi(
  library: BibLibrary,
  opts?: PluginApiOptions,
): PluginApi {
  return new PluginApi(library, opts);
}

// --- module-local helpers ----------------------------------------------------

/** Field names searched by {@link PluginApi.search} (de-TeXified before match). */
const SEARCH_FIELDS = [
  'Title',
  'Author',
  'Editor',
  'Journal',
  'Booktitle',
  'Year',
  'Keywords',
  'Abstract',
  'Note',
] as const;

/** Matches the `Bdsk-File-N` managed-attachment field names. */
const BDSK_FILE_RE = /^bdsk-file-\d+$/i;
