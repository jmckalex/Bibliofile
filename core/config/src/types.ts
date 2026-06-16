/**
 * @bibdesk/config — shared TypeScript types for the ported BibDesk
 * entry-type / field configuration.
 *
 * All field names and entry-type names in BibDesk are treated
 * case-insensitively. Data is stored using BibDesk's canonical casing
 * (capitalized field names e.g. `Author`, lowercase type names e.g. `article`);
 * accessor predicates normalize input before comparison.
 */

/** A BibTeX entry-type name in BibDesk's canonical (lowercase) form. */
export type EntryType = string;

/** A BibTeX field name in BibDesk's canonical (capitalized) form. */
export type FieldName = string;

/**
 * Required + optional field lists for a single entry type, as defined in
 * `TypeInfo.plist > FieldsForTypes`.
 */
export interface FieldsForType {
  /** Fields BibTeX requires for this entry type. */
  required: FieldName[];
  /** Fields BibTeX recognizes but does not require for this entry type. */
  optional: FieldName[];
}

/** `TypeInfo.plist > FieldsForTypes`: entry type -> {required, optional}. */
export type FieldsForTypes = Record<EntryType, FieldsForType>;

/**
 * The eight user-default field-classification arrays from `Preferences.plist`,
 * keyed by their EXACT NSUserDefaults literal key. These drive field
 * classification in the data model (`BDSKTypeManager -reloadFieldSets`).
 */
export interface FieldTypeSets {
  /** `BDSKBooleanFieldsKey` — fields rendered as Yes/No checkboxes. */
  'Boolean fields': FieldName[];
  /** `BDSKCitationFieldsKey` — fields holding cite-key references. */
  'Citation fields': FieldName[];
  /** `BDSKDefaultFieldsKey` — extra fields shown by default on every type. */
  'Default Fields': FieldName[];
  /** `BDSKLocalFileFieldsKey` — fields holding local file paths/URLs. */
  'Local File Fields': FieldName[];
  /** `BDSKPersonFieldsKey` — fields parsed as people (authors/editors). */
  'Person fields': FieldName[];
  /** `BDSKRatingFieldsKey` — fields rendered as 0..5 star ratings. */
  'Rating fields': FieldName[];
  /** `BDSKRemoteURLFieldsKey` — fields holding remote URLs. */
  'Remote URL Fields': FieldName[];
  /** `BDSKTriStateFieldsKey` — fields rendered as tri-state checkboxes. */
  'Three state fields': FieldName[];
}

/** The exact NSUserDefaults literal keys of the eight field-type arrays. */
export type FieldTypeSetKey = keyof FieldTypeSets;

/**
 * Maps a BibDesk constant name -> its NSUserDefaults literal key, for the
 * eight field-type arrays. Useful for a settings importer / Fields-pane UI.
 */
export interface FieldTypeSetMeta {
  /** The `BDSK*Key` constant name from `BDSKStringConstants.m`. */
  readonly constant: string;
  /** The exact NSUserDefaults literal key string. */
  readonly key: FieldTypeSetKey;
  /** The `BDSKTypeManager` membership-set name this populates. */
  readonly setName: string;
}

/**
 * An import/export tag map from `TypeInfo.plist`.
 *
 * Two shapes occur:
 *  - flat `Record<string, string>` (e.g. tag -> BibTeX field name), and
 *  - nested `Record<string, Record<string, string>>` (per-type or
 *    per-subfield maps, e.g. RIS tags keyed by BibTeX type, MARC subfields).
 *
 * Maps are captured verbatim from the plist.
 */
export type FlatTagMap = Record<string, string>;
export type NestedTagMap = Record<string, Record<string, string>>;
export type TagMap = FlatTagMap | NestedTagMap;

/** `TypesForFileType` / `StandardTypesForFileType` — file type -> type list. */
export type TypesForFileType = Record<string, EntryType[]>;

/** MODS genres for a BibTeX type, split by `self` / `host` role. */
export type ModsGenresForType = Record<string, Record<string, string[]>>;

/**
 * The full set of named maps/data found in `TypeInfo.plist`. Field names are
 * the exact plist keys. Maps are captured as-is for mechanical lookup.
 */
export interface TypeInfo {
  FieldsForTypes: FieldsForTypes;
  TypesForFileType: TypesForFileType;
  StandardTypesForFileType: TypesForFileType;

  // --- Import: foreign type -> BibTeX type ---
  BibTeXTypesForRISTypes: FlatTagMap;
  BibTeXTypesForReferTypes: FlatTagMap;
  BibTeXTypesForPubMedTypes: FlatTagMap;
  BibTeXTypesForWebOfScienceTypes: FlatTagMap;
  BibTeXTypesForHCiteTypes: FlatTagMap;
  BibTeXTypesForDublinCoreTypes: FlatTagMap;
  BibTeXTypesForMODSGenres: FlatTagMap;

  // --- Export: BibTeX type -> foreign type ---
  RISTypesForBibTeXTypes: FlatTagMap;
  ReferTypesForBibTeXTypes: FlatTagMap;
  MODSGenresForBibTeXType: ModsGenresForType;

  // --- Import: foreign tag -> BibTeX field name ---
  BibTeXFieldNamesForRISTags: NestedTagMap;
  BibTeXFieldNamesForReferTags: FlatTagMap;
  BibTeXFieldNamesForPubMedTags: FlatTagMap;
  BibTeXFieldNamesForJSTORTags: FlatTagMap;
  BibTeXFieldNamesForWebOfScienceTags: FlatTagMap;
  BibTeXFieldNamesForDublinCoreTerms: FlatTagMap;
  BibTeXFieldNamesForMARCTags: NestedTagMap;
  BibTeXFieldNamesForUNIMARCTags: NestedTagMap;

  // --- Export: BibTeX field name -> foreign tag ---
  RISTagsForBibTeXFieldNames: NestedTagMap;
  ReferTagsForBibTeXFieldNames: FlatTagMap;

  // --- Human-readable field descriptions for foreign tags ---
  FieldDescriptionsForJSTORTags: FlatTagMap;
  FieldDescriptionsForWebOfScienceTags: FlatTagMap;
}
