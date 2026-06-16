/**
 * @bibdesk/groups — the group taxonomy + the `BDSKFilter`/`BDSKCondition`
 * smart-group predicate evaluator, ported from BibDesk.
 *
 * Platform-agnostic and pure: no Electron/DOM/Node runtime APIs, no `fs`. The
 * evaluator takes an injectable `now` so relative-date windows are
 * deterministic, replacing BibDesk's midnight `NSTimer` cache invalidation.
 */

// --- comparison enums + key-type classification ----------------------------
export {
  StringComparison,
  AttachmentComparison,
  DateComparison,
  Conjunction,
  Period,
  ConditionKeyType,
  ALL_FIELDS_KEY,
  DATE_ADDED_KEY,
  DATE_MODIFIED_KEY,
  LOCAL_FILE_KEY,
  REMOTE_URL_KEY,
  COLOR_KEY,
  COLOR_LABEL_KEY,
  keyTypeForKey,
  coerceStringComparisonForTypedKey,
  type FieldClassifier,
} from './comparison.js';

// --- date windows ----------------------------------------------------------
export {
  startOfPeriod,
  parseBibDeskDate,
  resolveDateWindow,
  dateInWindow,
  type DateWindow,
  type DateWindowOptions,
  type DateConditionParams,
} from './dates.js';

// --- string comparison helpers ---------------------------------------------
export {
  caseInsensitiveEqual,
  caseInsensitiveContains,
  caseInsensitiveStartsWith,
  caseInsensitiveEndsWith,
  localizedCaseInsensitiveNumericCompare,
} from './strings.js';

// --- groups-for-field (multi-value split + author equivalence) -------------
export {
  authorsEquivalent,
  splitGroupFieldValue,
  groupValuesForField,
  fieldContainsCategory,
  fieldIsEmptyForGroups,
  itemContainedInGroupForField,
  DEFAULT_GROUP_FIELD_SEPARATORS,
  type Author,
  type GroupFieldItem,
  type GroupFieldClassifier,
} from './groups-for-field.js';

// --- condition / filter evaluator ------------------------------------------
export {
  Condition,
  type EvaluableItem,
  type EvaluateOptions,
  type AttachmentLike,
} from './condition.js';
export { Filter, evaluateFilter } from './filter.js';

// --- group taxonomy --------------------------------------------------------
export {
  LibraryGroup,
  StaticGroup,
  SmartGroup,
  CategoryGroup,
  EmptyCategoryGroup,
  URLGroup,
  ScriptGroup,
  type Group,
  type GroupKind,
  type GroupBase,
} from './group.js';

// --- serialized interop (C4) -----------------------------------------------
export {
  groupFromSerialized,
  toSerialized,
  filterFromSerialized,
  filterToSerialized,
  escapeGroupPlistEntities,
  unescapeGroupPlistEntities,
  type RawGroupRecord,
  type StaticGroupPlist,
  type SmartGroupPlist,
  type SmartConditionPlist,
  type URLGroupPlist,
  type ScriptGroupPlist,
} from './serialized.js';
