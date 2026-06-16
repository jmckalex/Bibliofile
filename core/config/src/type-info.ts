/**
 * Entry-type / required-optional-field data and accessors, extracted from
 * BibDesk's bundled `TypeInfo.plist`.
 *
 * Field names are matched case-insensitively (BibDesk treats both field names
 * and entry-type names case-insensitively). Data uses BibDesk's canonical
 * casing.
 */
import typeInfoData from './data/typeinfo.json';
import type {
  EntryType,
  FieldName,
  FieldsForType,
  FieldsForTypes,
  TypeInfo,
} from './types';

/** The complete `TypeInfo.plist` data, captured verbatim. */
export const typeInfo: TypeInfo = typeInfoData as unknown as TypeInfo;

/** Per-entry-type required + optional field lists. */
export const fieldsForTypes: FieldsForTypes = typeInfo.FieldsForTypes;

/**
 * All BibTeX entry types BibDesk knows about (from
 * `TypesForFileType.BibTeX`).
 */
export const typesForBibTeX: readonly EntryType[] = Object.freeze([
  ...(typeInfo.TypesForFileType.BibTeX ?? []),
]);

/**
 * The standard (protected) BibTeX entry types
 * (from `StandardTypesForFileType.BibTeX`).
 */
export const standardTypes: readonly EntryType[] = Object.freeze([
  ...(typeInfo.StandardTypesForFileType.BibTeX ?? []),
]);

const standardTypeLookup = new Set(standardTypes.map((t) => t.toLowerCase()));
const knownTypeLookup = new Set(typesForBibTeX.map((t) => t.toLowerCase()));
// Case-insensitive lookup from a lowercased type name to its FieldsForType.
const fieldsByLowerType = new Map<string, FieldsForType>(
  Object.entries(fieldsForTypes).map(([type, fields]) => [
    type.toLowerCase(),
    fields,
  ]),
);

/** Returns the {required, optional} record for a type, case-insensitively. */
export function fieldsFor(type: EntryType): FieldsForType | undefined {
  return fieldsByLowerType.get(type.toLowerCase());
}

/** Required fields for an entry type (empty array if type unknown). */
export function requiredFieldsFor(type: EntryType): FieldName[] {
  return fieldsFor(type)?.required.slice() ?? [];
}

/** Optional fields for an entry type (empty array if type unknown). */
export function optionalFieldsFor(type: EntryType): FieldName[] {
  return fieldsFor(type)?.optional.slice() ?? [];
}

/** True if `type` is a standard/protected BibTeX type (case-insensitive). */
export function isStandardType(type: EntryType): boolean {
  return standardTypeLookup.has(type.toLowerCase());
}

/** True if `type` is any entry type BibDesk knows (case-insensitive). */
export function isKnownType(type: EntryType): boolean {
  return knownTypeLookup.has(type.toLowerCase());
}
