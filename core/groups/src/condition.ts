/**
 * `BDSKCondition` — a single smart-group predicate term.
 *
 * Port of `-[BDSKCondition isSatisfiedByItem:]` (BDSKCondition.m:227-383). A
 * condition is `{ key, comparison, value, version }`; the key's
 * {@link ConditionKeyType} (derived via {@link keyTypeForKey}) selects the
 * comparison family and value interpretation.
 *
 * Pure: `evaluate(item, opts)` has no side effects. The relative-date timer and
 * KVO/undo coupling of the Cocoa original are dropped; "now" is injected.
 */
import {
  AttachmentComparison,
  ConditionKeyType,
  DateComparison,
  Period,
  StringComparison,
  ALL_FIELDS_KEY,
  DATE_ADDED_KEY,
  DATE_MODIFIED_KEY,
  LOCAL_FILE_KEY,
  REMOTE_URL_KEY,
  coerceStringComparisonForTypedKey,
  keyTypeForKey,
  type FieldClassifier,
} from './comparison.js';
import {
  caseInsensitiveContains,
  caseInsensitiveEndsWith,
  caseInsensitiveEqual,
  caseInsensitiveStartsWith,
  localizedCaseInsensitiveNumericCompare,
} from './strings.js';
import {
  parseBibDeskDate,
  resolveDateWindow,
  dateInWindow,
  type DateConditionParams,
  type DateWindowOptions,
} from './dates.js';
import {
  groupValuesForField,
  itemContainedInGroupForField,
  type Author,
  type GroupFieldItem,
} from './groups-for-field.js';

/** Record-separator sentinel BibDesk wraps "Any Field" values in (`0x1E`). */
const RS = '';

/** A linked attachment as exposed by `BibItem.files`. */
export interface AttachmentLike {
  readonly kind: 'file' | 'url';
  readonly url: string;
}

/** Structural view of the `BibItem` the evaluator reads. */
export interface EvaluableItem extends GroupFieldItem {
  readonly citeKey: string;
  stringValueOfField(field: string, inherit?: boolean): string;
  fieldNames(): string[];
  readonly files: readonly AttachmentLike[];
  readonly dateAdded?: string | undefined;
  readonly dateModified?: string | undefined;
  readonly typeManager: FieldClassifier & GroupFieldItem['typeManager'];
}

/** Options threaded through evaluation. */
export interface EvaluateOptions extends DateWindowOptions {
  /**
   * Build an {@link Author} from a name string, for GroupContain on person
   * fields (BibDesk: `[BibAuthor authorWithName:]`). If omitted, person-field
   * GroupContain falls back to exact `originalName` matching.
   */
  makeAuthor?: (name: string) => Author;
}

/** Booleanish coercion (`-[NSString booleanValue]`): truthy if "yes"/"1"/"true". */
function booleanValue(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === 'yes' || t === '1' || t === 'true' || t === 'y';
}

/** Tri-state coercion → -1/0/1 (`-[NSString triStateValue]`). */
function triStateValue(s: string): number {
  const t = s.trim().toLowerCase();
  if (t === '' || t === '1' || t === 'mixed') return 0;
  if (t === '2' || t === 'yes' || t === 'on') return 1;
  if (t === '0' || t === 'no' || t === 'off') return -1;
  const n = parseInt(t, 10);
  if (Number.isNaN(n)) return 0;
  if (n >= 2) return 1;
  if (n <= 0) return -1;
  return 0;
}

/** Integer coercion (`-[NSString integerValue]`): leading integer, else 0. */
function integerValue(s: string): number {
  const m = /^\s*([+-]?\d+)/.exec(s);
  return m ? parseInt(m[1]!, 10) : 0;
}

/**
 * Port of `compareIntegerValues` (BDSKCondition.m:216-225): for tri-state the
 * mixed (negative) state sorts between off and on. Returns -1/0/1.
 */
function compareIntegerValues(v1: number, v2: number, isTriState: boolean): number {
  const diff = isTriState
    ? 2 * Math.abs(v1) + v1 - 2 * Math.abs(v2) - v2
    : v1 - v2;
  return diff > 0 ? 1 : diff < 0 ? -1 : 0;
}

/**
 * A `BDSKCondition`. The serialized form persists `{ key, comparison, value,
 * version }`; `comparison` is the raw integer tag (interpreted per key type).
 */
export class Condition {
  /** Field name or special key (`Any Field`, `Date-Added`, `Local File`, …). */
  readonly key: string;
  /** Raw integer comparison tag (meaning depends on key type). */
  readonly comparison: number;
  /** Serialized value string (multi-part date/attachment values flattened). */
  readonly value: string;
  /** Serialized condition version (BibDesk dictionaryVersion, currently 1). */
  readonly version: number;

  constructor(init: {
    key: string;
    comparison: number;
    value: string;
    version?: number;
  }) {
    this.key = init.key;
    this.comparison = init.comparison;
    this.value = init.value;
    this.version = init.version ?? 1;
  }

  /** The key type this condition's key resolves to, given a classifier. */
  keyType(classifier: FieldClassifier): ConditionKeyType {
    return keyTypeForKey(this.key, classifier);
  }

  /** Pure membership test. Mirrors `-[BDSKCondition isSatisfiedByItem:]`. */
  evaluate(item: EvaluableItem, opts: EvaluateOptions = {}): boolean {
    // empty key matches anything (BDSKCondition.m:228-229)
    if (this.key === '' ) return true;

    const kt = keyTypeForKey(this.key, item.typeManager);
    switch (kt) {
      case ConditionKeyType.Date:
        return this.evaluateDate(item, opts);
      case ConditionKeyType.Attachment:
        return this.evaluateAttachment(item);
      default:
        return this.evaluateStringLike(item, kt, opts);
    }
  }

  // --- date branch -----------------------------------------------------------

  private parseDateParams(): DateConditionParams {
    const comparison = this.comparison as DateComparison;
    const params: DateConditionParams = {
      comparison,
      numberValue: 0,
      andNumberValue: 0,
      periodValue: Period.Day,
      dateValue: null,
      toDateValue: null,
    };
    const v = this.value;
    switch (comparison) {
      case DateComparison.Exactly:
      case DateComparison.InLast:
      case DateComparison.NotInLast: {
        const parts = v.split(' ');
        params.numberValue = integerValue(parts[0] ?? '0');
        params.periodValue = (integerValue(parts[1] ?? '1') || Period.Day) as Period;
        break;
      }
      case DateComparison.Between: {
        const parts = v.split(' ');
        params.numberValue = integerValue(parts[0] ?? '0');
        params.andNumberValue = integerValue(parts[1] ?? '0');
        params.periodValue = (integerValue(parts[2] ?? '1') || Period.Day) as Period;
        break;
      }
      case DateComparison.Date:
      case DateComparison.AfterDate:
      case DateComparison.BeforeDate:
        params.dateValue = parseBibDeskDate(v);
        break;
      case DateComparison.InDateRange: {
        const parts = v.split(' to ');
        params.dateValue = parseBibDeskDate(parts[0] ?? '');
        params.toDateValue = parseBibDeskDate(parts[1] ?? '');
        break;
      }
      default:
        break;
    }
    return params;
  }

  private evaluateDate(item: EvaluableItem, opts: EvaluateOptions): boolean {
    const params = this.parseDateParams();
    const window = resolveDateWindow(params, opts);
    let raw: string | undefined;
    if (this.key === DATE_ADDED_KEY) raw = item.dateAdded ?? item.stringValueOfField(DATE_ADDED_KEY);
    else if (this.key === DATE_MODIFIED_KEY) raw = item.dateModified ?? item.stringValueOfField(DATE_MODIFIED_KEY);
    const date = parseBibDeskDate(raw);
    return dateInWindow(date, window);
  }

  // --- attachment branch -----------------------------------------------------

  private evaluateAttachment(item: EvaluableItem): boolean {
    const comparison = this.comparison as AttachmentComparison;
    const isLocal = this.key === LOCAL_FILE_KEY;
    const isRemote = this.key === REMOTE_URL_KEY;

    // Count comparisons (tags 0..3 < Contain)
    if (comparison < AttachmentComparison.Contain) {
      let count = 0;
      if (isLocal) count = item.files.filter((f) => f.kind === 'file').length;
      else if (isRemote) count = item.files.filter((f) => f.kind === 'url').length;
      const countValue = integerValue(this.value);
      switch (comparison) {
        case AttachmentComparison.CountEqual:
          return count === countValue;
        case AttachmentComparison.CountNotEqual:
          return count !== countValue;
        case AttachmentComparison.CountLarger:
          return count > countValue;
        case AttachmentComparison.CountSmaller:
          return count < countValue;
        default:
          break;
      }
    }

    // Path/URL string match (Contain/NotContain/StartWith/EndWith)
    const matchReturnValue = comparison !== AttachmentComparison.NotContain;
    let itemValues: string[] = [];
    if (isLocal) itemValues = item.files.filter((f) => f.kind === 'file').map((f) => f.url);
    else if (isRemote) itemValues = item.files.filter((f) => f.kind === 'url').map((f) => f.url);

    const needle = this.value;
    for (const v of itemValues) {
      let hit = false;
      if (comparison === AttachmentComparison.EndWith) hit = caseInsensitiveEndsWith(v, needle);
      else if (comparison === AttachmentComparison.StartWith) hit = caseInsensitiveStartsWith(v, needle);
      else hit = caseInsensitiveContains(v, needle); // Contain or NotContain
      if (hit) return matchReturnValue;
    }
    return !matchReturnValue;
  }

  // --- string / typed branch -------------------------------------------------

  private evaluateStringLike(
    item: EvaluableItem,
    kt: ConditionKeyType,
    opts: EvaluateOptions,
  ): boolean {
    const rawComparison = this.comparison as StringComparison;

    // GroupContain / GroupNotContain
    if (
      rawComparison === StringComparison.GroupContain ||
      rawComparison === StringComparison.GroupNotContain
    ) {
      return this.evaluateGroupContain(item, rawComparison, opts);
    }

    // typed-key coercion (Boolean/TriState/Rating/Color)
    let comparison: StringComparison = rawComparison;
    const isTyped =
      kt === ConditionKeyType.Boolean ||
      kt === ConditionKeyType.TriState ||
      kt === ConditionKeyType.Rating ||
      kt === ConditionKeyType.Color;
    if (isTyped) comparison = coerceStringComparisonForTypedKey(rawComparison);

    let value = this.value;
    let itemValue = item.stringValueOfField(this.key) ?? '';

    const isAllFields = this.key === ALL_FIELDS_KEY;
    // True once the Any-Field branch has already wrapped value/itemValue in
    // record separators, so the contain block below must not recompute them.
    let allFieldsWrapped = false;

    if (comparison === StringComparison.Equal || comparison === StringComparison.NotEqual) {
      if (isAllFields) {
        // wrap in record separators; equal→contain over the delimited field set
        comparison = comparison === StringComparison.Equal
          ? StringComparison.Contain
          : StringComparison.NotContain;
        itemValue = `${RS}${this.allFieldsValue(item)}${RS}`;
        value = `${RS}${this.value}${RS}`;
        allFieldsWrapped = true;
      } else {
        let result: boolean;
        if (kt === ConditionKeyType.Boolean) result = booleanValue(value) === booleanValue(itemValue);
        else if (kt === ConditionKeyType.TriState) result = triStateValue(value) === triStateValue(itemValue);
        else if (kt === ConditionKeyType.Rating) result = integerValue(value) === integerValue(itemValue);
        else if (kt === ConditionKeyType.Color) result = colorEqual(value, itemValue);
        else result = caseInsensitiveEqual(value, itemValue);
        return comparison === StringComparison.Equal ? result : !result;
      }
    } else if (comparison === StringComparison.Smaller || comparison === StringComparison.Larger) {
      let cmp: number;
      if (kt === ConditionKeyType.Boolean) cmp = compareIntegerValues(boolToInt(value), boolToInt(itemValue), false);
      // tri-state values are already normalized to the monotonic -1/0/1
      // (off/mixed/on) encoding, so plain ordering puts mixed between off and on
      // — BibDesk's `isTriState` remap only applies to its NSControlStateValue
      // (off=0/on=1/mixed=-1) raw encoding, which we don't use here.
      else if (kt === ConditionKeyType.TriState) cmp = compareIntegerValues(triStateValue(value), triStateValue(itemValue), false);
      else if (kt === ConditionKeyType.Rating) cmp = compareIntegerValues(integerValue(value), integerValue(itemValue), false);
      else if (kt === ConditionKeyType.Color) cmp = colorCompare(value, itemValue);
      else cmp = localizedCaseInsensitiveNumericCompare(value, itemValue);
      // result == (Smaller ? Descending(+1) : Ascending(-1))
      return cmp === (comparison === StringComparison.Smaller ? 1 : -1);
    }

    // contain / not-contain / start / end
    if (isAllFields) {
      if (!allFieldsWrapped) {
        const flat = this.allFieldsValue(item);
        if (comparison === StringComparison.EndWith) {
          itemValue = `${flat}${RS}`;
          value = `${this.value}${RS}`;
        } else if (comparison === StringComparison.StartWith) {
          itemValue = `${RS}${flat}`;
          value = `${RS}${this.value}`;
        } else {
          itemValue = flat;
        }
      }
      // anchoring is emulated by the sentinels; use plain contains
      const found = caseInsensitiveContains(itemValue, value);
      return comparison === StringComparison.NotContain ? !found : found;
    }

    let found: boolean;
    if (comparison === StringComparison.EndWith) found = caseInsensitiveEndsWith(itemValue, value);
    else if (comparison === StringComparison.StartWith) found = caseInsensitiveStartsWith(itemValue, value);
    else found = caseInsensitiveContains(itemValue, value); // Contain or NotContain
    return comparison === StringComparison.NotContain ? !found : found;
  }

  /**
   * "Any Field" flattened value: every field's display string, joined by the
   * `0x1E` record separator (BibDesk wraps each value so "equal" becomes a
   * delimited "contain"). We join all set fields' display strings with the
   * sentinel between them.
   */
  private allFieldsValue(item: EvaluableItem): string {
    const parts: string[] = [];
    for (const f of item.fieldNames()) {
      const v = item.stringValueOfField(f);
      if (v !== '') parts.push(v);
    }
    return parts.join(RS);
  }

  private evaluateGroupContain(
    item: EvaluableItem,
    comparison: StringComparison,
    opts: EvaluateOptions,
  ): boolean {
    const isContain = comparison === StringComparison.GroupContain;
    const make = opts.makeAuthor;
    const match = (field: string): boolean => {
      if (make) {
        return itemContainedInGroupForField(item, field, this.value, make);
      }
      // no author-maker: person fields fall back to exact originalName match
      const values = groupValuesForField(item, field);
      if (item.typeManager.isPersonField(field)) {
        return (values as Author[]).some((a) => a.originalName === this.value);
      }
      return (values as string[]).some((v) => v === this.value);
    };

    if (this.key === ALL_FIELDS_KEY) {
      for (const field of item.fieldNames()) {
        if (match(field)) return isContain;
      }
      return !isContain;
    }
    return isContain === match(this.key);
  }
}

function boolToInt(s: string): number {
  return booleanValue(s) ? 1 : 0;
}

/**
 * Color equality — BibDesk compares `NSColor`s parsed from a four-byte string.
 * With no color subsystem here we compare the raw color strings
 * case-insensitively (structural). Empty/unparseable both map to "clear".
 */
function colorEqual(a: string, b: string): boolean {
  return (a || 'clear').toLowerCase() === (b || 'clear').toLowerCase();
}

/** Structural color ordering: lexical on the normalized color string. */
function colorCompare(a: string, b: string): number {
  const x = (a || 'clear').toLowerCase();
  const y = (b || 'clear').toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}
