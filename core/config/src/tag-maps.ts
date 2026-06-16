/**
 * Import/export tag maps from `TypeInfo.plist`, captured verbatim.
 *
 * These are mechanical lookup tables used by importers/exporters
 * (RIS, Refer, PubMed, JSTOR, Web of Science, Dublin Core, MODS, MARC,
 * UNIMARC, HCite). Each is re-exported individually plus collected in
 * `tagMaps`. Lookups in BibDesk are key-exact (foreign tags carry their own
 * casing), so these are exposed as-is without case folding.
 */
import { typeInfo } from './type-info';
import type {
  FlatTagMap,
  ModsGenresForType,
  NestedTagMap,
} from './types';

// --- Import: foreign type -> BibTeX type ---
export const BibTeXTypesForRISTypes: FlatTagMap = typeInfo.BibTeXTypesForRISTypes;
export const BibTeXTypesForReferTypes: FlatTagMap = typeInfo.BibTeXTypesForReferTypes;
export const BibTeXTypesForPubMedTypes: FlatTagMap = typeInfo.BibTeXTypesForPubMedTypes;
export const BibTeXTypesForWebOfScienceTypes: FlatTagMap = typeInfo.BibTeXTypesForWebOfScienceTypes;
export const BibTeXTypesForHCiteTypes: FlatTagMap = typeInfo.BibTeXTypesForHCiteTypes;
export const BibTeXTypesForDublinCoreTypes: FlatTagMap = typeInfo.BibTeXTypesForDublinCoreTypes;
export const BibTeXTypesForMODSGenres: FlatTagMap = typeInfo.BibTeXTypesForMODSGenres;

// --- Export: BibTeX type -> foreign type ---
export const RISTypesForBibTeXTypes: FlatTagMap = typeInfo.RISTypesForBibTeXTypes;
export const ReferTypesForBibTeXTypes: FlatTagMap = typeInfo.ReferTypesForBibTeXTypes;
export const MODSGenresForBibTeXType: ModsGenresForType = typeInfo.MODSGenresForBibTeXType;

// --- Import: foreign tag -> BibTeX field name ---
export const BibTeXFieldNamesForRISTags: NestedTagMap = typeInfo.BibTeXFieldNamesForRISTags;
export const BibTeXFieldNamesForReferTags: FlatTagMap = typeInfo.BibTeXFieldNamesForReferTags;
export const BibTeXFieldNamesForPubMedTags: FlatTagMap = typeInfo.BibTeXFieldNamesForPubMedTags;
export const BibTeXFieldNamesForJSTORTags: FlatTagMap = typeInfo.BibTeXFieldNamesForJSTORTags;
export const BibTeXFieldNamesForWebOfScienceTags: FlatTagMap = typeInfo.BibTeXFieldNamesForWebOfScienceTags;
export const BibTeXFieldNamesForDublinCoreTerms: FlatTagMap = typeInfo.BibTeXFieldNamesForDublinCoreTerms;
export const BibTeXFieldNamesForMARCTags: NestedTagMap = typeInfo.BibTeXFieldNamesForMARCTags;
export const BibTeXFieldNamesForUNIMARCTags: NestedTagMap = typeInfo.BibTeXFieldNamesForUNIMARCTags;

// --- Export: BibTeX field name -> foreign tag ---
export const RISTagsForBibTeXFieldNames: NestedTagMap = typeInfo.RISTagsForBibTeXFieldNames;
export const ReferTagsForBibTeXFieldNames: FlatTagMap = typeInfo.ReferTagsForBibTeXFieldNames;

// --- Human-readable field descriptions for foreign tags ---
export const FieldDescriptionsForJSTORTags: FlatTagMap = typeInfo.FieldDescriptionsForJSTORTags;
export const FieldDescriptionsForWebOfScienceTags: FlatTagMap = typeInfo.FieldDescriptionsForWebOfScienceTags;

/** All tag maps collected by their original `TypeInfo.plist` key. */
export const tagMaps = {
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
} as const;
