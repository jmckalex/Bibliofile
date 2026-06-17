/**
 * `TypeManager` — the TypeScript port of BibDesk's `BDSKTypeManager`.
 *
 * Data-driven from `@bibdesk/config` (the bundled `TypeInfo.plist` +
 * factory-default field-type arrays). On top of those defaults it layers
 * **user-overridable** state, exactly as BibDesk does (the Fields preference
 * pane edits NSUserDefaults arrays at runtime):
 *
 *   - the eight field-type arrays (person/rating/boolean/triState/citation/
 *     localFile/remoteURL/default) can be replaced, and the derived sets
 *     (`isURLField = localFile ∪ remoteURL`,
 *     `isIntegerField = rating ∪ triState ∪ boolean`) are recomputed;
 *   - a `TypeInfo` overlay can add/replace per-type required/optional field
 *     lists, while the 15 standard BibTeX types remain protected.
 *
 * It also owns the **code-level hardcoded sets** that are NOT in config
 * (`noteFieldsSet`, `numericFieldsSet`, `titleFieldsSet`, `containerFieldsSet`,
 * `invalidGroupFieldsSet`, `singleValuedGroupFieldsSet`), ported verbatim from
 * `BDSKTypeManager.m`.
 *
 * All field-name / type-name matching is case-insensitive.
 */

import {
  fieldTypeSets as defaultFieldTypeSets,
  fieldTypeSetMeta,
  requiredFieldsFor as configRequiredFieldsFor,
  optionalFieldsFor as configOptionalFieldsFor,
  isStandardType,
  isKnownType as configIsKnownType,
  typesForBibTeX,
  type FieldTypeSetKey,
} from '@bibdesk/config';

/**
 * The eight user-editable field-classification arrays, keyed by the exact
 * NSUserDefaults literal keys from `@bibdesk/config`. A partial override merges
 * over the factory defaults.
 */
export type FieldTypeSetOverrides = Partial<Record<FieldTypeSetKey, string[]>>;

/** Required + optional field lists for one entry type. */
export interface TypeFields {
  required: string[];
  optional: string[];
}

/**
 * A user `TypeInfo` overlay: per-type required/optional field lists that
 * augment or replace the bundled defaults. Standard types are protected (see
 * {@link TypeManager.setTypeInfoOverlay}).
 */
export type TypeInfoOverlay = Record<string, TypeFields>;

// --- canonical field-name constants (values from BDSKStringConstants.m) ------

const ANNOTE = 'Annote';
const ABSTRACT = 'Abstract';
const RSS_DESCRIPTION = 'Rss-Description';
const YEAR = 'Year';
const VOLUME = 'Volume';
const NUMBER = 'Number';
const PAGES = 'Pages';
const TITLE = 'Title';
const CHAPTER = 'Chapter';
const PUB_TYPE = 'BibTeX Type';
const BOOKTITLE = 'Booktitle';
const JOURNAL = 'Journal';
const SERIES = 'Series';
const DATE_MODIFIED = 'Date-Modified';
const DATE_ADDED = 'Date-Added';
const DATE = 'Date';
const CONTAINER = 'Container';
const ITEM_NUMBER = 'Item Number';
const TYPE = 'Type';
const CROSSREF = 'Crossref';
const VOLUMETITLE = 'Volumetitle';
const MONTH = 'Month';
const PUBLISHER = 'Publisher';
const ADDRESS = 'Address';
const INSTITUTION = 'Institution';
const SCHOOL = 'School';
const ORGANIZATION = 'Organization';
const LOCATION = 'Location';
const COLOR = 'Bdsk-Color';
const LOCAL_URL = 'Local-Url';

function lowerSet(fields: Iterable<string>): Set<string> {
  const s = new Set<string>();
  for (const f of fields) s.add(f.toLowerCase());
  return s;
}

export class TypeManager {
  // user-overridable field-type arrays (canonical casing), keyed by config key
  private fieldArrays: Record<FieldTypeSetKey, string[]>;
  // derived case-insensitive membership lookups
  private lookups!: Record<FieldTypeSetKey, Set<string>>;
  private urlLookup!: Set<string>; // localFile ∪ remoteURL
  private integerLookup!: Set<string>; // rating ∪ triState ∪ boolean

  // hardcoded, code-level sets (ported from BDSKTypeManager.m)
  private readonly noteSet: Set<string>;
  private readonly numericSet: Set<string>;
  private readonly titleSet: Set<string>;
  private readonly containerSet: Set<string>;
  // these two depend on the (mutable) URL/integer sets, recomputed on override
  private invalidGroupSet!: Set<string>;
  private singleValuedGroupSet!: Set<string>;

  // user TypeInfo overlay (lowercased type name -> fields)
  private typeOverlay = new Map<string, TypeFields>();

  constructor() {
    // seed field arrays from factory defaults (copied so we never mutate config)
    this.fieldArrays = {} as Record<FieldTypeSetKey, string[]>;
    for (const meta of fieldTypeSetMeta) {
      this.fieldArrays[meta.key] = [...defaultFieldTypeSets[meta.key]];
    }

    // hardcoded sets that never change (BDSKTypeManager.m:139-142)
    this.noteSet = lowerSet([ANNOTE, ABSTRACT, RSS_DESCRIPTION]);
    this.numericSet = lowerSet([YEAR, VOLUME, NUMBER, PAGES]);
    this.titleSet = lowerSet([TITLE, CHAPTER, PAGES, PUB_TYPE]);
    this.containerSet = lowerSet([
      TITLE,
      BOOKTITLE,
      JOURNAL,
      VOLUME,
      SERIES,
      PUB_TYPE,
    ]);

    this.recomputeDerived();
  }

  // --- user-overridable field-type sets --------------------------------------

  /**
   * Replace one or more of the eight field-type arrays (e.g. from loaded user
   * preferences) and recompute the derived URL/integer/group sets. Arrays not
   * present in `overrides` keep their current value. Mirrors
   * `BDSKTypeManager reloadFieldSets`.
   */
  setFieldTypeOverrides(overrides: FieldTypeSetOverrides): void {
    for (const [key, arr] of Object.entries(overrides) as [
      FieldTypeSetKey,
      string[] | undefined,
    ][]) {
      if (arr) this.fieldArrays[key] = [...arr];
    }
    this.recomputeDerived();
  }

  /** Reset every field-type array back to the factory defaults from config. */
  resetFieldTypeOverrides(): void {
    for (const meta of fieldTypeSetMeta) {
      this.fieldArrays[meta.key] = [...defaultFieldTypeSets[meta.key]];
    }
    this.recomputeDerived();
  }

  /** Current canonical-cased array for a given field-type set key. */
  fieldArray(key: FieldTypeSetKey): string[] {
    return [...this.fieldArrays[key]];
  }

  private recomputeDerived(): void {
    this.lookups = {} as Record<FieldTypeSetKey, Set<string>>;
    for (const meta of fieldTypeSetMeta) {
      this.lookups[meta.key] = lowerSet(this.fieldArrays[meta.key]);
    }
    // derived: allURLFieldsSet = local ∪ remote
    this.urlLookup = new Set<string>([
      ...this.lookups['Local File Fields'],
      ...this.lookups['Remote URL Fields'],
    ]);
    // derived: integerFieldsSet = rating ∪ triState ∪ boolean
    this.integerLookup = new Set<string>([
      ...this.lookups['Rating fields'],
      ...this.lookups['Three state fields'],
      ...this.lookups['Boolean fields'],
    ]);
    this.recomputeGroupSets();
  }

  private recomputeGroupSets(): void {
    // invalidGroupFieldsSet (BDSKTypeManager.m:236-242): a fixed core list ∪ allURL
    this.invalidGroupSet = new Set<string>([
      ...lowerSet([
        DATE_MODIFIED,
        DATE_ADDED,
        DATE,
        TITLE,
        CONTAINER,
        CHAPTER,
        VOLUME,
        NUMBER,
        PAGES,
        ITEM_NUMBER,
        ABSTRACT,
        ANNOTE,
        RSS_DESCRIPTION,
      ]),
      ...this.urlLookup,
    ]);
    // singleValuedGroupFieldsSet (BDSKTypeManager.m:244-246): fixed core list ∪ integer
    this.singleValuedGroupSet = new Set<string>([
      ...lowerSet([
        PUB_TYPE,
        TYPE,
        CROSSREF,
        JOURNAL,
        BOOKTITLE,
        VOLUMETITLE,
        SERIES,
        YEAR,
        MONTH,
        PUBLISHER,
        ADDRESS,
        INSTITUTION,
        SCHOOL,
        ORGANIZATION,
        LOCATION,
        COLOR,
      ]),
      ...this.integerLookup,
    ]);
  }

  // --- field-type predicates (case-insensitive) ------------------------------

  isPersonField(field: string): boolean {
    return this.lookups['Person fields'].has(field.toLowerCase());
  }
  isRatingField(field: string): boolean {
    return this.lookups['Rating fields'].has(field.toLowerCase());
  }
  isBooleanField(field: string): boolean {
    return this.lookups['Boolean fields'].has(field.toLowerCase());
  }
  isTriStateField(field: string): boolean {
    return this.lookups['Three state fields'].has(field.toLowerCase());
  }
  isCitationField(field: string): boolean {
    return this.lookups['Citation fields'].has(field.toLowerCase());
  }
  isLocalFileField(field: string): boolean {
    return this.lookups['Local File Fields'].has(field.toLowerCase());
  }
  isRemoteURLField(field: string): boolean {
    return this.lookups['Remote URL Fields'].has(field.toLowerCase());
  }
  isDefaultField(field: string): boolean {
    return this.lookups['Default Fields'].has(field.toLowerCase());
  }
  /** Derived: local-file ∪ remote-URL. URL fields must NOT be TeXified. */
  isURLField(field: string): boolean {
    return this.urlLookup.has(field.toLowerCase());
  }
  /** Derived: rating ∪ triState ∪ boolean (stored as integer-ish strings). */
  isIntegerField(field: string): boolean {
    return this.integerLookup.has(field.toLowerCase());
  }

  // hardcoded-set predicates
  isNoteField(field: string): boolean {
    return this.noteSet.has(field.toLowerCase());
  }
  isNumericField(field: string): boolean {
    return this.numericSet.has(field.toLowerCase());
  }
  isTitleField(field: string): boolean {
    return this.titleSet.has(field.toLowerCase());
  }
  isContainerField(field: string): boolean {
    return this.containerSet.has(field.toLowerCase());
  }
  isInvalidGroupField(field: string): boolean {
    return this.invalidGroupSet.has(field.toLowerCase());
  }
  isSingleValuedGroupField(field: string): boolean {
    return this.singleValuedGroupSet.has(field.toLowerCase());
  }

  /**
   * Should `field` be TeXified when writing BibTeX?
   *
   * Per `BibItem.m bibTeXDataWithOptions:` (line 1806-1808) only **URL fields**
   * (local-file ∪ remote-URL) are excluded from TeXification at the call site;
   * however BibDesk never stores TeX in citation/note fields either, and the
   * port spec (C4) treats URL/local-file/citation/note fields as the
   * never-TeXify set. We expose that exact union here. Field NAMES and macro
   * tokens are handled by the serializer separately.
   */
  shouldTeXifyField(field: string): boolean {
    return !(
      this.isURLField(field) ||
      this.isCitationField(field) ||
      this.isNoteField(field)
    );
  }

  // --- type info (required/optional fields) ----------------------------------

  /**
   * Install / replace a user `TypeInfo` overlay. The 15 standard BibTeX types
   * are **protected**: an attempt to override a standard type is ignored (it
   * keeps the bundled defaults), matching BibDesk where standard types can't be
   * removed/renamed. Non-standard (custom) types are taken from the overlay.
   * Pass `{}` (or call again) to replace the whole overlay.
   */
  setTypeInfoOverlay(overlay: TypeInfoOverlay): void {
    this.typeOverlay = new Map<string, TypeFields>();
    for (const [type, fields] of Object.entries(overlay)) {
      if (isStandardType(type)) continue; // protected
      this.typeOverlay.set(type.toLowerCase(), {
        required: [...fields.required],
        optional: [...fields.optional],
      });
    }
  }

  /** Clear the user TypeInfo overlay (revert to bundled defaults). */
  clearTypeInfoOverlay(): void {
    this.typeOverlay = new Map<string, TypeFields>();
  }

  /** Required fields for an entry type (overlay wins for non-standard types). */
  requiredFieldsForType(type: string): string[] {
    const ov = this.typeOverlay.get(type.toLowerCase());
    if (ov) return [...ov.required];
    return configRequiredFieldsFor(type);
  }

  /** Optional fields for an entry type (overlay wins for non-standard types). */
  optionalFieldsForType(type: string): string[] {
    const ov = this.typeOverlay.get(type.toLowerCase());
    if (ov) return [...ov.optional];
    return configOptionalFieldsFor(type);
  }

  /** required ∪ optional for a type (BibDesk `regularFieldsForType:`). */
  regularFieldsForType(type: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const f of [
      ...this.requiredFieldsForType(type),
      ...this.optionalFieldsForType(type),
    ]) {
      const k = f.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(f);
      }
    }
    return out;
  }

  /** True if `type` is a protected standard BibTeX type (case-insensitive). */
  isStandardType(type: string): boolean {
    return isStandardType(type);
  }

  /** True if `type` is any known type (bundled or overlay), case-insensitive. */
  isKnownType(type: string): boolean {
    return configIsKnownType(type) || this.typeOverlay.has(type.toLowerCase());
  }

  /** The user-default extra fields shown on every type (BibDesk userDefaultFields). */
  userDefaultFields(): string[] {
    return [...this.fieldArrays['Default Fields']];
  }

  /** All bundled BibTeX entry-type names (canonical casing; excludes user overlay types). */
  bundledTypes(): string[] {
    return [...typesForBibTeX];
  }
}

/**
 * A process-wide default {@link TypeManager} (mirrors BibDesk's
 * `[BDSKTypeManager sharedManager]`). Most callers want this; create a fresh
 * instance only when isolating configuration (e.g. in tests).
 */
export const sharedTypeManager = new TypeManager();
