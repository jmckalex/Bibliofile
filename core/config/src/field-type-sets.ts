/**
 * The eight user-default field-classification arrays from
 * `Preferences.plist` (subsystem-10 §4A), plus case-insensitive membership
 * predicates and the derived sets `BDSKTypeManager` computes.
 *
 * In BibDesk these arrays live in NSUserDefaults and are user-editable at
 * runtime (Fields preference pane). The values here are the FACTORY DEFAULTS.
 * A live `core/model` TypeManager should load the user's current values and
 * recompute the derived sets when `BDSKCustomFieldsChangedNotification` fires.
 */
import fieldTypeSetsData from './data/field-type-sets.json';
import type {
  FieldName,
  FieldTypeSetKey,
  FieldTypeSetMeta,
  FieldTypeSets,
} from './types';

/** Factory-default field-type arrays, keyed by exact NSUserDefaults key. */
export const fieldTypeSets: FieldTypeSets =
  fieldTypeSetsData as unknown as FieldTypeSets;

/**
 * Metadata for the eight arrays: BibDesk constant name, exact NSUserDefaults
 * literal key, and the `BDSKTypeManager` membership-set name each populates.
 * (Source: subsystem-10 §4A table.)
 */
export const fieldTypeSetMeta: readonly FieldTypeSetMeta[] = Object.freeze([
  { constant: 'BDSKLocalFileFieldsKey', key: 'Local File Fields', setName: 'localFileFieldsSet' },
  { constant: 'BDSKRemoteURLFieldsKey', key: 'Remote URL Fields', setName: 'remoteURLFieldsSet' },
  { constant: 'BDSKRatingFieldsKey', key: 'Rating fields', setName: 'ratingFieldsSet' },
  { constant: 'BDSKBooleanFieldsKey', key: 'Boolean fields', setName: 'booleanFieldsSet' },
  { constant: 'BDSKTriStateFieldsKey', key: 'Three state fields', setName: 'triStateFieldsSet' },
  { constant: 'BDSKCitationFieldsKey', key: 'Citation fields', setName: 'citationFieldsSet' },
  { constant: 'BDSKPersonFieldsKey', key: 'Person fields', setName: 'personFieldsSet' },
  { constant: 'BDSKDefaultFieldsKey', key: 'Default Fields', setName: 'userDefaultFields' },
]);

/** Build a case-insensitive lookup set from a field-name array. */
function lowerSet(fields: readonly FieldName[]): Set<string> {
  return new Set(fields.map((f) => f.toLowerCase()));
}

const setKeys = Object.keys(fieldTypeSets) as FieldTypeSetKey[];
// Case-insensitive membership lookups for each of the eight arrays.
const lookups: Record<FieldTypeSetKey, Set<string>> = Object.fromEntries(
  setKeys.map((k) => [k, lowerSet(fieldTypeSets[k])]),
) as Record<FieldTypeSetKey, Set<string>>;

/** True if `field` belongs to the given field-type array (case-insensitive). */
export function isFieldOfType(field: FieldName, key: FieldTypeSetKey): boolean {
  return lookups[key].has(field.toLowerCase());
}

/** `isPersonField` — Author/Editor by default. Case-insensitive. */
export const isPersonField = (field: FieldName): boolean =>
  isFieldOfType(field, 'Person fields');

/** `isRatingField` — Rating by default. Case-insensitive. */
export const isRatingField = (field: FieldName): boolean =>
  isFieldOfType(field, 'Rating fields');

/** `isBooleanField` — Read by default. Case-insensitive. */
export const isBooleanField = (field: FieldName): boolean =>
  isFieldOfType(field, 'Boolean fields');

/** `isTriStateField` — empty by default. Case-insensitive. */
export const isTriStateField = (field: FieldName): boolean =>
  isFieldOfType(field, 'Three state fields');

/** `isCitationField` — Cited-By/Cites by default. Case-insensitive. */
export const isCitationField = (field: FieldName): boolean =>
  isFieldOfType(field, 'Citation fields');

/** `isLocalFileField` — Local-Url by default. Case-insensitive. */
export const isLocalFileField = (field: FieldName): boolean =>
  isFieldOfType(field, 'Local File Fields');

/** `isRemoteURLField` — Url/Doi/Citeseerurl by default. Case-insensitive. */
export const isRemoteURLField = (field: FieldName): boolean =>
  isFieldOfType(field, 'Remote URL Fields');

/** `isDefaultField` — Keywords by default. Case-insensitive. */
export const isDefaultField = (field: FieldName): boolean =>
  isFieldOfType(field, 'Default Fields');

/**
 * `isURLField` — derived set `allURLFieldsSet = localFile ∪ remoteURL`.
 * URL fields must NOT be TeXified on output. Case-insensitive.
 */
export const isURLField = (field: FieldName): boolean =>
  isLocalFileField(field) || isRemoteURLField(field);

/**
 * `isIntegerField` — derived set `integerFieldsSet = rating ∪ triState ∪
 * boolean` (these are stored as integer-ish string values). Case-insensitive.
 */
export const isIntegerField = (field: FieldName): boolean =>
  isRatingField(field) || isTriStateField(field) || isBooleanField(field);
