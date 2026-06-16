/**
 * `BibItem` — the central domain object, one per BibTeX entry. Port of
 * BibDesk's `BibItem`.
 *
 * Identity-bearing state (matches the recommended TS model in subsystem-01 §6):
 *   - `id`        : stable UUID (replaces `identifierURL`), independent of citeKey
 *   - `citeKey`   : the BibTeX key
 *   - `type`      : entry type, always lowercase (`article`, `book`, ...)
 *   - `fields`    : `Record<CanonicalFieldName, FieldValue>` — THE source of
 *                   truth. Field names are stored in canonical Capitalized form;
 *                   access is case-insensitive.
 *   - `files`     : linked files/URLs
 *   - `dateAdded` / `dateModified` : ISO-8601 strings, also mirrored into the
 *                   `Date-Added` / `Date-Modified` fields.
 *
 * Design: a **class with controlled mutation + change-event emission** (matches
 * BibDesk, where every setter funnels through `setField:toValue:` and posts a
 * notification). All mutators bump `dateModified` and emit on the item's
 * {@link BibItem.changes} emitter.
 */

import { Emitter, type Listener, type Unsubscribe } from './events.js';
import {
  type FieldValue,
  expandComplexValue,
  isComplex,
  normalizeValue,
  valuesEqual,
} from './complex-value.js';
import type { MacroResolver } from './macro-resolver.js';
import type { TypeManager } from './type-manager.js';
import type { LinkedFile } from './linked-file.js';
import { parseAuthorField, type Author, type ParsedAuthorField } from '@bibdesk/names';

/** Canonical field-name constants used internally. */
export const FieldNames = {
  Author: 'Author',
  Editor: 'Editor',
  Title: 'Title',
  Booktitle: 'Booktitle',
  Crossref: 'Crossref',
  Year: 'Year',
  Month: 'Month',
  DateAdded: 'Date-Added',
  DateModified: 'Date-Modified',
} as const;

/**
 * Read-only view of a publications collection, used to resolve `Crossref`
 * parents. The app/document provides the concrete store; the model only needs
 * case-insensitive cite-key lookup (BibDesk's `itemForCiteKey:`, which returns
 * the first item when keys collide).
 */
export interface PublicationStore {
  /** First item whose cite key equals `citeKey` (case-insensitive), or undefined. */
  itemForCiteKey(citeKey: string): BibItem | undefined;
}

/** Detail of which kind of change occurred on a {@link BibItem}. */
export type ItemChangeType = 'field' | 'citeKey' | 'type' | 'files';

/**
 * Change event emitted on item mutation. Replaces Cocoa KVO +
 * `BDSKBibItemChangedNotification` and carries enough for UI + undo
 * (item id, field/key, old/new values).
 */
export interface ItemChangeEvent {
  readonly type: ItemChangeType;
  /** The item that changed. */
  readonly item: BibItem;
  /** Stable id of the item (convenience; equals `item.id`). */
  readonly itemId: string;
  /** For `field` changes: the canonical field name. */
  readonly field?: string;
  /** Previous value (FieldValue for `field`, string for citeKey/type). */
  readonly oldValue?: FieldValue;
  /** New value. */
  readonly newValue?: FieldValue;
}

/** Options for {@link createBibItem}. */
export interface BibItemInit {
  /** Provide a stable id; otherwise one is generated (see {@link generateId}). */
  id?: string;
  citeKey?: string;
  /** Entry type; lowercased on store. Defaults to `misc`. */
  type?: string;
  /** Initial fields (canonical or any casing — normalized to canonical). */
  fields?: Record<string, FieldValue>;
  files?: LinkedFile[];
  dateAdded?: string;
  dateModified?: string;
  /** Macro resolver for expanding complex values (optional). */
  macroResolver?: MacroResolver;
  /** Type manager for field classification (defaults to the shared one). */
  typeManager?: TypeManager;
  /** Publication store for crossref resolution (set later via setOwner). */
  store?: PublicationStore;
  /** Injectable id generator (for deterministic tests). */
  idGenerator?: () => string;
}

/**
 * Generate a stable unique id. Uses the cross-platform `crypto.randomUUID()`
 * global (present in modern Node and browsers). If unavailable, falls back to a
 * timestamp+random id. Callers may inject their own generator via
 * {@link BibItemInit.idGenerator}.
 */
export function generateId(): string {
  const c: { randomUUID?: () => string } | undefined =
    typeof globalThis !== 'undefined'
      ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
      : undefined;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  // Fallback (not RFC4122, but unique enough for an id of last resort).
  return `bib-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class BibItem {
  /** Stable unique id (replaces `identifierURL`). */
  readonly id: string;
  private _citeKey: string;
  private _type: string;
  /** Canonical-cased field name -> value. Source of truth. */
  private readonly _fields = new Map<string, FieldValue>();
  /** Lowercased field name -> canonical-cased field name. */
  private readonly _canonicalByLower = new Map<string, string>();
  private _files: LinkedFile[];
  private _dateAdded: string | undefined;
  private _dateModified: string | undefined;

  private _macroResolver: MacroResolver | undefined;
  private _typeManager: TypeManager;
  private _store: PublicationStore | undefined;

  /** Lazily-built cache of parsed person fields (lowercased field -> result). */
  private _peopleCache = new Map<string, ParsedAuthorField>();

  /** Change-event channel for this item. */
  readonly changes = new Emitter<ItemChangeEvent>();

  constructor(init: BibItemInit, typeManager: TypeManager) {
    const idGen = init.idGenerator ?? generateId;
    this.id = init.id ?? idGen();
    this._citeKey = init.citeKey ?? '';
    this._type = (init.type ?? 'misc').toLowerCase();
    this._files = init.files ? [...init.files] : [];
    this._dateAdded = init.dateAdded;
    this._dateModified = init.dateModified;
    this._macroResolver = init.macroResolver;
    this._typeManager = typeManager;
    this._store = init.store;

    if (init.fields) {
      for (const [name, value] of Object.entries(init.fields)) {
        this.setFieldInternal(name, value, false);
      }
    }
    // mirror dates into fields if provided
    if (this._dateAdded !== undefined) {
      this.setFieldInternal(FieldNames.DateAdded, this._dateAdded, false);
    }
    if (this._dateModified !== undefined) {
      this.setFieldInternal(FieldNames.DateModified, this._dateModified, false);
    }
    // Apply the booktitle workaround for initial fields too (BibDesk runs it on
    // any Title set / metadata update, including load), without emitting.
    this.maybeDuplicateTitleToBooktitle(false);
  }

  // --- basic accessors -------------------------------------------------------

  get citeKey(): string {
    return this._citeKey;
  }

  get type(): string {
    return this._type;
  }

  get files(): readonly LinkedFile[] {
    return this._files;
  }

  get dateAdded(): string | undefined {
    return this._dateAdded;
  }

  get dateModified(): string | undefined {
    return this._dateModified;
  }

  get macroResolver(): MacroResolver | undefined {
    return this._macroResolver;
  }

  get typeManager(): TypeManager {
    return this._typeManager;
  }

  /** Canonical-cased field names currently set on this item. */
  fieldNames(): string[] {
    return [...this._fields.keys()];
  }

  /** Subscribe to this item's change events. */
  subscribe(listener: Listener<ItemChangeEvent>): Unsubscribe {
    return this.changes.subscribe(listener);
  }

  // --- wiring (owner/resolver) -----------------------------------------------

  /** Bind the publication store used to resolve crossref parents. */
  setStore(store: PublicationStore | undefined): void {
    this._store = store;
  }

  /** Bind/replace the macro resolver used to expand complex values. */
  setMacroResolver(resolver: MacroResolver | undefined): void {
    this._macroResolver = resolver;
  }

  // --- type / citeKey mutation -----------------------------------------------

  /** Set the entry type (lowercased). Emits a `type` change. */
  setType(type: string): void {
    const next = type.toLowerCase();
    if (next === this._type) return;
    const old = this._type;
    this._type = next;
    this.touchModified();
    this.changes.emit({
      type: 'type',
      item: this,
      itemId: this.id,
      oldValue: old,
      newValue: next,
    });
  }

  /** Set the cite key. Emits a `citeKey` change. */
  setCiteKey(citeKey: string): void {
    if (citeKey === this._citeKey) return;
    const old = this._citeKey;
    this._citeKey = citeKey;
    this.touchModified();
    this.changes.emit({
      type: 'citeKey',
      item: this,
      itemId: this.id,
      oldValue: old,
      newValue: citeKey,
    });
  }

  // --- field access (case-insensitive, canonical storage) --------------------

  /**
   * Look up the canonical-cased name actually stored for `field` (case-
   * insensitively), or undefined if not set.
   */
  canonicalFieldName(field: string): string | undefined {
    return this._canonicalByLower.get(field.toLowerCase());
  }

  /**
   * Raw value of a field (no crossref inheritance), case-insensitive lookup, or
   * `undefined` if unset. The returned value may be simple or complex.
   */
  rawValueOfField(field: string): FieldValue | undefined {
    const canon = this._canonicalByLower.get(field.toLowerCase());
    return canon !== undefined ? this._fields.get(canon) : undefined;
  }

  /**
   * Value of a field as a {@link FieldValue}, optionally inheriting from the
   * crossref parent when empty. Mirrors `valueOfField:inherit:`.
   *
   * Inheritance fires only when: `inherit` is true AND the local value is empty
   * AND the field is not a citation field. (BibDesk also excludes
   * `fieldsToWriteIfEmpty`; there is no such configured set in the model layer
   * yet — the app can pass those fields' own non-empty values, so they won't
   * inherit anyway. A hook is left via {@link fieldsNeverInherited}.)
   */
  valueOfField(field: string, inherit = false): FieldValue | undefined {
    const local = this.rawValueOfField(field);
    const empty = isEmptyValue(local);
    if (
      inherit &&
      empty &&
      !this._typeManager.isCitationField(field) &&
      !fieldsNeverInherited.has(field.toLowerCase())
    ) {
      const parent = this.crossrefParent();
      if (parent) {
        const parentValue = parent.valueOfField(field, false);
        if (!isEmptyValue(parentValue)) return parentValue;
      }
    }
    return local;
  }

  /**
   * String value of a field. With `inherit`, falls back to the crossref parent.
   * Complex values are expanded via the macro resolver; if no resolver is bound
   * and the value is complex, the macro tokens are left as their names.
   * Mirrors `stringValueOfField:`.
   */
  stringValueOfField(field: string, inherit = false): string {
    const value = this.valueOfField(field, inherit);
    if (value === undefined) return '';
    if (!isComplex(value)) return value;
    if (this._macroResolver) return this._macroResolver.expand(value);
    return expandComplexValue(value, { definitionOf: () => undefined });
  }

  /** True if a field is currently inherited from the crossref parent (not set locally). */
  isFieldInherited(field: string): boolean {
    if (!isEmptyValue(this.rawValueOfField(field))) return false;
    if (this._typeManager.isCitationField(field)) return false;
    if (fieldsNeverInherited.has(field.toLowerCase())) return false;
    const parent = this.crossrefParent();
    if (!parent) return false;
    return !isEmptyValue(parent.valueOfField(field, false));
  }

  /**
   * Set a field's value (case-insensitive name; stored under canonical casing).
   * Setting `undefined` or empty string removes the field? — No: BibDesk keeps
   * empty strings. To remove a field use {@link removeField}. Emits a `field`
   * change with old/new values, and applies the booktitle workaround when
   * setting `Title`.
   */
  setField(field: string, value: FieldValue): void {
    this.setFieldInternal(field, value, true);
  }

  /** Remove a field entirely. Emits a `field` change with `newValue` undefined. */
  removeField(field: string): void {
    const lower = field.toLowerCase();
    const canon = this._canonicalByLower.get(lower);
    if (canon === undefined) return;
    const old = this._fields.get(canon);
    this._fields.delete(canon);
    this._canonicalByLower.delete(lower);
    this.invalidatePeople(lower);
    this.touchModified();
    this.changes.emit({
      type: 'field',
      item: this,
      itemId: this.id,
      field: canon,
      oldValue: old,
      newValue: undefined,
    });
  }

  private setFieldInternal(
    field: string,
    rawValue: FieldValue,
    emit: boolean,
  ): void {
    const value = normalizeValue(rawValue);
    const lower = field.toLowerCase();
    // Canonical casing: keep first-seen casing; default to the provided casing.
    const canon = this._canonicalByLower.get(lower) ?? canonicalCasing(field);
    const old = this._fields.get(canon);
    if (old !== undefined && valuesEqual(old, value)) return; // no-op
    this._fields.set(canon, value);
    this._canonicalByLower.set(lower, canon);
    this.invalidatePeople(lower);

    // mirror Date-Added / Date-Modified field <-> property
    if (lower === FieldNames.DateAdded.toLowerCase() && !isComplex(value)) {
      this._dateAdded = value;
    } else if (
      lower === FieldNames.DateModified.toLowerCase() &&
      !isComplex(value)
    ) {
      this._dateModified = value;
    }

    if (emit) {
      this.touchModified();
      this.changes.emit({
        type: 'field',
        item: this,
        itemId: this.id,
        field: canon,
        oldValue: old,
        newValue: value,
      });
      // BibTeX booktitle workaround on Title change (see duplicateTitleToBooktitle).
      if (lower === FieldNames.Title.toLowerCase()) {
        this.maybeDuplicateTitleToBooktitle();
      }
    }
  }

  // --- typed accessors -------------------------------------------------------

  /**
   * Parsed authors for a person field (default `Author`), case-insensitive,
   * cached. Returns `[]` for a non-person/empty field. Honors crossref
   * inheritance when `inherit` is true. Uses `@bibdesk/names`.
   */
  peopleForField(field: string = FieldNames.Author, inherit = false): readonly Author[] {
    return this.parsedAuthorField(field, inherit).authors;
  }

  /** Like {@link peopleForField} but also returns the `and others` flag. */
  parsedAuthorField(
    field: string = FieldNames.Author,
    inherit = false,
  ): ParsedAuthorField {
    // Cache only the non-inherited local parse (the common case); inherited
    // reads re-resolve against the (possibly changing) parent.
    if (!inherit) {
      const lower = field.toLowerCase();
      const cached = this._peopleCache.get(lower);
      if (cached) return cached;
      const str = this.stringValueOfField(field, false);
      const parsed = str ? parseAuthorField(str) : { authors: [], hasOthers: false };
      this._peopleCache.set(lower, parsed);
      return parsed;
    }
    const str = this.stringValueOfField(field, true);
    return str ? parseAuthorField(str) : { authors: [], hasOthers: false };
  }

  /** Convenience: parsed `Author` field. */
  authors(inherit = false): readonly Author[] {
    return this.peopleForField(FieldNames.Author, inherit);
  }

  /** Convenience: parsed `Editor` field. */
  editors(inherit = false): readonly Author[] {
    return this.peopleForField(FieldNames.Editor, inherit);
  }

  /**
   * Rating value of a field (0..5), clamped. Non-rating/empty -> 0. Mirrors
   * `ratingValueOfField:`.
   */
  ratingValueOfField(field: string): number {
    const s = this.stringValueOfField(field, false);
    const n = parseInt(s, 10);
    if (Number.isNaN(n) || n < 0) return 0;
    return n > 5 ? 5 : n;
  }

  /**
   * Boolean value of a field. Stored as "Yes"/"No" strings; anything other than
   * a case-insensitive "yes" is false. Mirrors `boolValueOfField:`.
   */
  boolValueOfField(field: string): boolean {
    return this.stringValueOfField(field, false).toLowerCase() === 'yes';
  }

  /**
   * Tri-state value of a field: -1 (off/`No`/`0`), 0 (mixed/empty), 1 (on/`Yes`/`2`).
   * BibDesk stores tri-state as "0"/"1"/"2" or via Yes/No strings; we normalize
   * to a signed tri-state. Mirrors `triStateValueOfField:`.
   */
  triStateValueOfField(field: string): -1 | 0 | 1 {
    const s = this.stringValueOfField(field, false).trim().toLowerCase();
    if (s === '' || s === '1' || s === 'mixed') return 0;
    if (s === '2' || s === 'yes' || s === 'on') return 1;
    if (s === '0' || s === 'no' || s === 'off') return -1;
    // numeric fallback
    const n = parseInt(s, 10);
    if (n >= 2) return 1;
    if (n <= 0) return -1;
    return 0;
  }

  // --- crossref --------------------------------------------------------------

  /** The cite key named by this item's `Crossref` field, or undefined. */
  crossrefKey(): string | undefined {
    const v = this.rawValueOfField(FieldNames.Crossref);
    if (isEmptyValue(v)) return undefined;
    return this.stringValueOfField(FieldNames.Crossref, false) || undefined;
  }

  /** Resolve the crossref parent through the bound store, or undefined. */
  crossrefParent(): BibItem | undefined {
    const key = this.crossrefKey();
    if (!key || !this._store) return undefined;
    const parent = this._store.itemForCiteKey(key);
    // Guard against self-reference creating an infinite loop.
    if (parent === this) return undefined;
    return parent;
  }

  /**
   * Validate a candidate crossref value against BibDesk's rules
   * (`canSetCrossref:`). Returns the error code, or `'none'` if allowed.
   *  - `self`        : crossref equals this item's cite key (case-insensitive)
   *  - `chain`       : the target parent itself has a (non-empty) crossref
   *                    (BibTeX allows only single-level crossrefs)
   *  - `isCrossreffed`: this item is already used as a crossref by other items
   *                    (so it cannot itself become a child)
   */
  canSetCrossref(
    candidate: string,
    allItems?: Iterable<BibItem>,
  ): CrossrefError {
    if (candidate.trim() === '') return 'none';
    if (candidate.toLowerCase() === this._citeKey.toLowerCase()) {
      return 'self';
    }
    const parent = this._store?.itemForCiteKey(candidate);
    if (parent && !isEmptyValue(parent.rawValueOfField(FieldNames.Crossref))) {
      return 'chain';
    }
    if (allItems && this.citeKeyIsCrossreffed(this._citeKey, allItems)) {
      return 'isCrossreffed';
    }
    return 'none';
  }

  /** True if any item in `allItems` crossrefs `citeKey` (case-insensitive). */
  private citeKeyIsCrossreffed(
    citeKey: string,
    allItems: Iterable<BibItem>,
  ): boolean {
    const lower = citeKey.toLowerCase();
    for (const item of allItems) {
      if (item === this) continue;
      if (item.crossrefKey()?.toLowerCase() === lower) return true;
    }
    return false;
  }

  /**
   * The BibTeX booktitle workaround (`duplicateTitleToBooktitleOverwriting:`):
   * for entry types where it applies, copy `Title` to `Booktitle` when
   * `Booktitle` is empty. In BibDesk the applicable types come from a
   * preference (`BDSKTypesForDuplicateBooktitleKey`, default `inbook`,
   * `incollection`, `inproceedings`, `conference`). We use that default set so
   * an `@inproceedings`/`@incollection` crossref'ing an `@proceedings`/`@book`
   * carries the title forward as the booktitle.
   */
  private maybeDuplicateTitleToBooktitle(emit = true): void {
    if (!BOOKTITLE_DUP_TYPES.has(this._type)) return;
    const title = this.rawValueOfField(FieldNames.Title);
    if (isEmptyValue(title)) return;
    const booktitle = this.rawValueOfField(FieldNames.Booktitle);
    if (!isEmptyValue(booktitle)) return; // don't overwrite (overwrite=NO default)
    // set Booktitle = Title (without re-triggering the workaround)
    this.setFieldInternal(FieldNames.Booktitle, title!, emit);
  }

  /**
   * Explicitly run the booktitle duplication (e.g. requested by the app/editor).
   * Returns true if it changed anything.
   */
  duplicateTitleToBooktitle(overwrite = false): boolean {
    const title = this.rawValueOfField(FieldNames.Title);
    if (isEmptyValue(title)) return false;
    const booktitle = this.rawValueOfField(FieldNames.Booktitle);
    if (!isEmptyValue(booktitle) && !overwrite) return false;
    if (booktitle !== undefined && valuesEqual(title!, booktitle)) return false;
    this.setField(FieldNames.Booktitle, title!);
    return true;
  }

  // --- files -----------------------------------------------------------------

  /** Replace the linked-files array. Emits a `files` change. */
  setFiles(files: LinkedFile[]): void {
    this._files = [...files];
    this.touchModified();
    this.changes.emit({ type: 'files', item: this, itemId: this.id });
  }

  /** Append a linked file. Emits a `files` change. */
  addFile(file: LinkedFile): void {
    this._files = [...this._files, file];
    this.touchModified();
    this.changes.emit({ type: 'files', item: this, itemId: this.id });
  }

  // --- serialization helpers -------------------------------------------------

  /**
   * Plain-object snapshot for JSON/IPC/clipboard (replaces NSCoding). Includes
   * id, citeKey, type, fields, files, dates. Macro resolver/store are not
   * serialized (rebound on the receiving side).
   */
  toJSON(): {
    id: string;
    citeKey: string;
    type: string;
    fields: Record<string, FieldValue>;
    files: LinkedFile[];
    dateAdded?: string;
    dateModified?: string;
  } {
    const fields: Record<string, FieldValue> = {};
    for (const [k, v] of this._fields) fields[k] = v;
    const out: {
      id: string;
      citeKey: string;
      type: string;
      fields: Record<string, FieldValue>;
      files: LinkedFile[];
      dateAdded?: string;
      dateModified?: string;
    } = {
      id: this.id,
      citeKey: this._citeKey,
      type: this._type,
      fields,
      files: [...this._files],
    };
    if (this._dateAdded !== undefined) out.dateAdded = this._dateAdded;
    if (this._dateModified !== undefined) out.dateModified = this._dateModified;
    return out;
  }

  // --- internals -------------------------------------------------------------

  private invalidatePeople(lowerField: string): void {
    this._peopleCache.delete(lowerField);
  }

  private touchModified(): void {
    // Note: we do NOT auto-write Date-Modified into the fields here to avoid
    // emitting a second change/recursion; the app's mutation pipeline decides
    // when to stamp dates. We only update the in-memory mirror if it was set.
  }
}

/** Crossref validation result codes (mirrors `BDSKCrossrefError`). */
export type CrossrefError = 'none' | 'self' | 'chain' | 'isCrossreffed';

/**
 * Default entry types for which `Title` is duplicated to `Booktitle`
 * (BibDesk `BDSKTypesForDuplicateBooktitleKey` factory default).
 */
const BOOKTITLE_DUP_TYPES = new Set<string>([
  'inbook',
  'incollection',
  'inproceedings',
  'conference',
]);

/**
 * Hook for fields that must never be inherited from a crossref parent
 * (BibDesk's `fieldsToWriteIfEmpty`). Empty by default; the app/preferences
 * layer can populate it later. Lowercased names.
 */
export const fieldsNeverInherited = new Set<string>();

/** Is a {@link FieldValue} "empty" (undefined, or a simple empty/whitespace string)? */
export function isEmptyValue(value: FieldValue | undefined): boolean {
  if (value === undefined) return true;
  if (isComplex(value)) return value.nodes.length === 0;
  return value.trim().length === 0;
}

/**
 * Canonicalize a field-name's casing. If the name is a single token we
 * Title-Case it (BibDesk capitalizes the first letter). Multi-token names and
 * names already containing capitals/hyphens (e.g. `Date-Added`, `Local-Url`,
 * `Item Number`) are preserved as given. This is a best-effort default; callers
 * that already know the canonical casing should pass it.
 */
function canonicalCasing(field: string): string {
  if (field.length === 0) return field;
  // Preserve names that already look canonical (have an uppercase letter).
  if (/[A-Z]/.test(field)) return field;
  // all-lowercase single word -> capitalize first letter
  return field.charAt(0).toUpperCase() + field.slice(1);
}

/**
 * Factory: create a {@link BibItem}. Prefer this over `new BibItem(...)` so the
 * type manager default is applied consistently.
 */
export function createBibItem(
  init: BibItemInit,
  typeManager?: TypeManager,
): BibItem {
  const tm = typeManager ?? init.typeManager;
  if (!tm) {
    throw new Error(
      'createBibItem requires a TypeManager (pass one or set init.typeManager)',
    );
  }
  return new BibItem(init, tm);
}
