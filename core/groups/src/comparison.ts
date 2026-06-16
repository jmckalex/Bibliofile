/**
 * Comparison operator enums + condition key-type classification.
 *
 * The integer values are LOAD-BEARING: they are the on-disk tags persisted in
 * BibDesk smart-group `@comment` plists and must round-trip byte-for-byte with
 * desktop BibDesk. They are the popup-menu item tags from `BDSKCondition.h`.
 *
 * Source of truth (verbatim):
 *   bibdesk/BDSKCondition.h:45-95  — the four NS_ENUMs below.
 *   bibdesk/BDSKFilter.h:43-45     — BDSKConjunction (And=0, Or=1).
 *   bibdesk/NSDate_BDSKExtensions.h:43-47 — BDSKPeriod (Day=1..Year=4).
 */

/**
 * String / generic comparisons (`BDSKStringComparison`, BDSKCondition.h:45-56).
 * Also used (with contain→equal coercion) for Boolean/TriState/Rating/Color
 * key types — see {@link coerceStringComparisonForTypedKey}.
 */
export enum StringComparison {
  GroupContain = 0,
  GroupNotContain = 1,
  Contain = 2,
  NotContain = 3,
  Equal = 4,
  NotEqual = 5,
  StartWith = 6,
  EndWith = 7,
  Smaller = 8,
  Larger = 9,
}

/**
 * Attachment comparisons (`BDSKAttachmentComparison`, BDSKCondition.h:59-68).
 * Count* operate on the number of local files / remote URLs; the remaining
 * operators match against file paths / URL strings.
 */
export enum AttachmentComparison {
  CountEqual = 0,
  CountNotEqual = 1,
  CountLarger = 2,
  CountSmaller = 3,
  Contain = 4,
  NotContain = 5,
  StartWith = 6,
  EndWith = 7,
}

/**
 * Date comparisons (`BDSKDateComparison`, BDSKCondition.h:71-85). 13 cases.
 * Today..LastWeek + Exactly..NotInLast + Between are *relative* windows;
 * Date/AfterDate/BeforeDate/InDateRange are *absolute*; ThisSession uses the
 * document open date.
 */
export enum DateComparison {
  Today = 0,
  Yesterday = 1,
  ThisWeek = 2,
  LastWeek = 3,
  Exactly = 4,
  InLast = 5,
  NotInLast = 6,
  Between = 7,
  Date = 8,
  AfterDate = 9,
  BeforeDate = 10,
  InDateRange = 11,
  ThisSession = 12,
}

/** Filter conjunction (`BDSKConjunction`, BDSKFilter.h:43-45). */
export enum Conjunction {
  And = 0,
  Or = 1,
}

/** Relative-date period units (`BDSKPeriod`, NSDate_BDSKExtensions.h:43-47). */
export enum Period {
  Day = 1,
  Week = 2,
  Month = 3,
  Year = 4,
}

/**
 * Condition key types (`BDSKConditionKeyType`, BDSKCondition.h:87-95). Derived
 * from the field/key by {@link keyTypeForKey}; drives which comparison enum and
 * value interpretation a condition uses.
 */
export enum ConditionKeyType {
  Date = 'date',
  Attachment = 'attachment',
  String = 'string',
  Boolean = 'boolean',
  TriState = 'tristate',
  Rating = 'rating',
  Color = 'color',
}

// --- Special keys (bibdesk/BDSKStringConstants.m) ---------------------------

/** "Any Field" — search across every field. (`BDSKAllFieldsString`) */
export const ALL_FIELDS_KEY = 'Any Field';
/** Date-Added special key. (`BDSKDateAddedString`) */
export const DATE_ADDED_KEY = 'Date-Added';
/** Date-Modified special key. (`BDSKDateModifiedString`) */
export const DATE_MODIFIED_KEY = 'Date-Modified';
/** Local-file attachment pseudo-field. (`BDSKLocalFileString`) */
export const LOCAL_FILE_KEY = 'Local File';
/** Remote-URL attachment pseudo-field. (`BDSKRemoteURLString`) */
export const REMOTE_URL_KEY = 'Remote URL';
/** Color value field. (`BDSKColorString`) */
export const COLOR_KEY = 'Bdsk-Color';
/** Color label field. (`BDSKColorLabelString`) */
export const COLOR_LABEL_KEY = 'Color Label';

/**
 * Minimal field-type classifier the condition evaluator needs. `BibItem`'s
 * `typeManager` satisfies this structurally, but it is also exposed so the
 * evaluator can be unit-tested without a full model.
 */
export interface FieldClassifier {
  isBooleanField(field: string): boolean;
  isTriStateField(field: string): boolean;
  isRatingField(field: string): boolean;
  isPersonField(field: string): boolean;
}

/**
 * Port of `BDSKKeyType()` (BDSKCondition.m:752-767): classify a condition key
 * into a {@link ConditionKeyType}. Special keys win first, then the field-type
 * predicates from the classifier, else String.
 */
export function keyTypeForKey(
  key: string,
  classifier: FieldClassifier,
): ConditionKeyType {
  if (key === DATE_ADDED_KEY || key === DATE_MODIFIED_KEY) {
    return ConditionKeyType.Date;
  }
  if (key === LOCAL_FILE_KEY || key === REMOTE_URL_KEY) {
    return ConditionKeyType.Attachment;
  }
  if (classifier.isBooleanField(key)) return ConditionKeyType.Boolean;
  if (classifier.isTriStateField(key)) return ConditionKeyType.TriState;
  if (classifier.isRatingField(key)) return ConditionKeyType.Rating;
  if (key === COLOR_LABEL_KEY || key === COLOR_KEY) {
    return ConditionKeyType.Color;
  }
  return ConditionKeyType.String;
}

/**
 * For typed (Boolean/TriState/Rating/Color) keys, BibDesk coerces the
 * substring operators into (in)equality before comparing typed values
 * (BDSKCondition.m:321-326): StartWith/EndWith/Contain → Equal,
 * NotContain → NotEqual. Other operators (Equal/NotEqual/Smaller/Larger)
 * pass through unchanged.
 */
export function coerceStringComparisonForTypedKey(
  comparison: StringComparison,
): StringComparison {
  if (
    comparison === StringComparison.StartWith ||
    comparison === StringComparison.EndWith ||
    comparison === StringComparison.Contain
  ) {
    return StringComparison.Equal;
  }
  if (comparison === StringComparison.NotContain) {
    return StringComparison.NotEqual;
  }
  return comparison;
}
