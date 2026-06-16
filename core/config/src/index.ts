/**
 * @bibdesk/config
 *
 * Ported BibDesk type/field configuration as committed JSON + typed accessors.
 * Platform-agnostic: no Electron/DOM/Node runtime APIs; data is embedded as
 * imported JSON. Feeds `core/model` (TypeManager) and `core/bibtex`.
 *
 * Data sources (extracted once, committed as JSON):
 *  - `src/data/typeinfo.json`         <- BibDesk `TypeInfo.plist`
 *  - `src/data/field-type-sets.json`  <- BibDesk `Preferences.plist` (§4A)
 *
 * Field names and entry-type names are matched case-insensitively, exactly as
 * BibDesk does. The field-type arrays here are FACTORY DEFAULTS; in BibDesk
 * they are user-editable at runtime.
 */

// --- Types ---
export type {
  EntryType,
  FieldName,
  FieldsForType,
  FieldsForTypes,
  FieldTypeSets,
  FieldTypeSetKey,
  FieldTypeSetMeta,
  FlatTagMap,
  NestedTagMap,
  TagMap,
  TypeInfo,
  TypesForFileType,
  ModsGenresForType,
} from './types';

// --- Entry types & required/optional fields ---
export {
  typeInfo,
  fieldsForTypes,
  typesForBibTeX,
  standardTypes,
  fieldsFor,
  requiredFieldsFor,
  optionalFieldsFor,
  isStandardType,
  isKnownType,
} from './type-info';

// --- Field-type classification sets + predicates ---
export {
  fieldTypeSets,
  fieldTypeSetMeta,
  isFieldOfType,
  isPersonField,
  isRatingField,
  isBooleanField,
  isTriStateField,
  isCitationField,
  isLocalFileField,
  isRemoteURLField,
  isDefaultField,
  isURLField,
  isIntegerField,
} from './field-type-sets';

// --- Import/export tag maps ---
export {
  tagMaps,
  BibTeXTypesForRISTypes,
  BibTeXTypesForReferTypes,
  BibTeXTypesForPubMedTypes,
  BibTeXTypesForWebOfScienceTypes,
  BibTeXTypesForHCiteTypes,
  BibTeXTypesForDublinCoreTypes,
  BibTeXTypesForMODSGenres,
  RISTypesForBibTeXTypes,
  ReferTypesForBibTeXTypes,
  MODSGenresForBibTeXType,
  BibTeXFieldNamesForRISTags,
  BibTeXFieldNamesForReferTags,
  BibTeXFieldNamesForPubMedTags,
  BibTeXFieldNamesForJSTORTags,
  BibTeXFieldNamesForWebOfScienceTags,
  BibTeXFieldNamesForDublinCoreTerms,
  BibTeXFieldNamesForMARCTags,
  BibTeXFieldNamesForUNIMARCTags,
  RISTagsForBibTeXFieldNames,
  ReferTagsForBibTeXFieldNames,
  FieldDescriptionsForJSTORTags,
  FieldDescriptionsForWebOfScienceTags,
} from './tag-maps';
