/**
 * The group taxonomy as a discriminated union, ported from BibDesk's
 * `BDSKGroup` class hierarchy (`BDSKGroup.h`, `BDSKLibraryGroup`,
 * `BDSKStaticGroup`, `BDSKSmartGroup`, `BDSKCategoryGroup` + external stubs).
 *
 * Each concrete group has a stable `kind`, a `name`, an `id`, and a pure
 * `containsItem(item)`. External/URL/Script/Web/Shared groups are TYPE-ONLY in
 * this read-only session (no live fetch); their membership returns `false`.
 */
import { Filter } from './filter.js';
import type { EvaluableItem, EvaluateOptions } from './condition.js';
import {
  fieldContainsCategory,
  fieldIsEmptyForGroups,
  type Author,
  type GroupFieldItem,
} from './groups-for-field.js';

/** Every group kind's discriminant tag. */
export type GroupKind =
  | 'library'
  | 'static'
  | 'smart'
  | 'category'
  | 'empty-category'
  | 'url'
  | 'script';

/** Common shape implemented by every concrete group. */
export interface GroupBase {
  readonly kind: GroupKind;
  readonly id: string;
  readonly name: string;
  containsItem(item: EvaluableItem, opts?: EvaluateOptions): boolean;
}

let __seq = 0;
function nextId(prefix: string): string {
  __seq += 1;
  return `${prefix}-${__seq}`;
}

/**
 * The library group: the entire collection. `containsItem` is always true
 * (`-[BDSKLibraryGroup containsItem:]` → YES).
 */
export class LibraryGroup implements GroupBase {
  readonly kind = 'library' as const;
  readonly id: string;
  readonly name: string;
  constructor(name = 'Library', id = nextId('library')) {
    this.name = name;
    this.id = id;
  }
  containsItem(_item?: EvaluableItem): boolean {
    return true;
  }
}

/**
 * A static group: an explicit list of cite keys. Membership is case-insensitive
 * cite-key containment.
 *
 * (BibDesk's `BDSKStaticGroup` resolves cite keys to `BibItem`s on document
 * binding and tests object identity; with no document here we test the key
 * directly, case-insensitively, which is BibDesk's cite-key matching rule.)
 */
export class StaticGroup implements GroupBase {
  readonly kind = 'static' as const;
  readonly id: string;
  readonly name: string;
  /** Cite keys, original casing preserved (compared case-insensitively). */
  readonly keys: readonly string[];
  private readonly keySet: Set<string>;

  constructor(name: string, keys: readonly string[], id = nextId('static')) {
    this.name = name;
    this.keys = keys;
    this.id = id;
    this.keySet = new Set(keys.map((k) => k.toLowerCase()));
  }

  containsItem(item: EvaluableItem): boolean {
    return this.keySet.has(item.citeKey.toLowerCase());
  }
}

/**
 * A smart group: membership delegates to its {@link Filter}. Mirrors
 * `-[BDSKSmartGroup containsItem:]` → `[filter testItem:item]` (the owner check
 * is a document concern handled by the caller).
 */
export class SmartGroup implements GroupBase {
  readonly kind = 'smart' as const;
  readonly id: string;
  readonly name: string;
  readonly filter: Filter;

  constructor(name: string, filter: Filter, id = nextId('smart')) {
    this.name = name;
    this.filter = filter;
    this.id = id;
  }

  containsItem(item: EvaluableItem, opts: EvaluateOptions = {}): boolean {
    return this.filter.evaluate(item, opts);
  }
}

/**
 * A category / field group: all items whose `field` contains the category
 * `value`. `value` is a string for ordinary fields and an {@link Author} for
 * person fields (matched with fuzzy author equivalence). Mirrors
 * `-[BDSKCategoryGroup containsItem:]` → `[[item groupsForField:key]
 * containsObject:name]`.
 */
export class CategoryGroup implements GroupBase {
  readonly kind = 'category' as const;
  readonly id: string;
  /** The field this group categorizes by (e.g. `Keywords`, `Author`). */
  readonly field: string;
  /** The category value (string, or Author for person fields). */
  readonly value: string | Author;

  constructor(field: string, value: string | Author, id = nextId('category')) {
    this.field = field;
    this.value = value;
    this.id = id;
  }

  /** Display name: the value itself (author display name for person values). */
  get name(): string {
    return typeof this.value === 'string' ? this.value : this.value.originalName;
  }

  containsItem(item: GroupFieldItem): boolean {
    return fieldContainsCategory(item, this.field, this.value);
  }
}

/**
 * The "empty" category group: items with NO value for the categorizing field
 * (BibDesk's `BDSKEmptyGroup`, `-[… containsItem:]` → `groupsForField:.count==0`).
 */
export class EmptyCategoryGroup implements GroupBase {
  readonly kind = 'empty-category' as const;
  readonly id: string;
  readonly field: string;
  readonly name: string;

  constructor(field: string, name = 'Empty', id = nextId('empty-category')) {
    this.field = field;
    this.name = name;
    this.id = id;
  }

  containsItem(item: GroupFieldItem): boolean {
    return fieldIsEmptyForGroups(item, this.field);
  }
}

/**
 * URL group (type-only in this session). No live fetch — membership is always
 * false. Carries the source URL for round-trip serialization.
 */
export class URLGroup implements GroupBase {
  readonly kind = 'url' as const;
  readonly id: string;
  readonly name: string;
  readonly url: string;
  constructor(name: string, url: string, id = nextId('url')) {
    this.name = name;
    this.url = url;
    this.id = id;
  }
  containsItem(_item?: EvaluableItem): boolean {
    return false;
  }
}

/**
 * Script group (type-only). No execution — membership is always false. Carries
 * script metadata for round-trip serialization.
 */
export class ScriptGroup implements GroupBase {
  readonly kind = 'script' as const;
  readonly id: string;
  readonly name: string;
  readonly scriptPath: string;
  readonly scriptArguments: string;
  readonly scriptType: number;
  constructor(
    name: string,
    scriptPath: string,
    scriptArguments = '',
    scriptType = 0,
    id = nextId('script'),
  ) {
    this.name = name;
    this.scriptPath = scriptPath;
    this.scriptArguments = scriptArguments;
    this.scriptType = scriptType;
    this.id = id;
  }
  containsItem(_item?: EvaluableItem): boolean {
    return false;
  }
}

/** The discriminated union of all group kinds. */
export type Group =
  | LibraryGroup
  | StaticGroup
  | SmartGroup
  | CategoryGroup
  | EmptyCategoryGroup
  | URLGroup
  | ScriptGroup;
