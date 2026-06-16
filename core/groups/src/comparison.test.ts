import { describe, it, expect } from 'vitest';
import {
  StringComparison,
  AttachmentComparison,
  DateComparison,
  Conjunction,
  Period,
  ConditionKeyType,
  keyTypeForKey,
  coerceStringComparisonForTypedKey,
  DATE_ADDED_KEY,
  DATE_MODIFIED_KEY,
  LOCAL_FILE_KEY,
  REMOTE_URL_KEY,
  COLOR_KEY,
  COLOR_LABEL_KEY,
  type FieldClassifier,
} from './index.js';

const classifier: FieldClassifier = {
  isBooleanField: (f) => f === 'Read',
  isTriStateField: (f) => f === 'Flag',
  isRatingField: (f) => f === 'Rating',
  isPersonField: (f) => f === 'Author' || f === 'Editor',
};

describe('comparison enum integer mapping (BDSKCondition.h)', () => {
  it('StringComparison tags', () => {
    expect(StringComparison.GroupContain).toBe(0);
    expect(StringComparison.GroupNotContain).toBe(1);
    expect(StringComparison.Contain).toBe(2);
    expect(StringComparison.NotContain).toBe(3);
    expect(StringComparison.Equal).toBe(4);
    expect(StringComparison.NotEqual).toBe(5);
    expect(StringComparison.StartWith).toBe(6);
    expect(StringComparison.EndWith).toBe(7);
    expect(StringComparison.Smaller).toBe(8);
    expect(StringComparison.Larger).toBe(9);
  });

  it('AttachmentComparison tags', () => {
    expect(AttachmentComparison.CountEqual).toBe(0);
    expect(AttachmentComparison.CountNotEqual).toBe(1);
    expect(AttachmentComparison.CountLarger).toBe(2);
    expect(AttachmentComparison.CountSmaller).toBe(3);
    expect(AttachmentComparison.Contain).toBe(4);
    expect(AttachmentComparison.NotContain).toBe(5);
    expect(AttachmentComparison.StartWith).toBe(6);
    expect(AttachmentComparison.EndWith).toBe(7);
  });

  it('DateComparison tags', () => {
    expect(DateComparison.Today).toBe(0);
    expect(DateComparison.Yesterday).toBe(1);
    expect(DateComparison.ThisWeek).toBe(2);
    expect(DateComparison.LastWeek).toBe(3);
    expect(DateComparison.Exactly).toBe(4);
    expect(DateComparison.InLast).toBe(5);
    expect(DateComparison.NotInLast).toBe(6);
    expect(DateComparison.Between).toBe(7);
    expect(DateComparison.Date).toBe(8);
    expect(DateComparison.AfterDate).toBe(9);
    expect(DateComparison.BeforeDate).toBe(10);
    expect(DateComparison.InDateRange).toBe(11);
    expect(DateComparison.ThisSession).toBe(12);
  });

  it('Conjunction + Period tags', () => {
    expect(Conjunction.And).toBe(0);
    expect(Conjunction.Or).toBe(1);
    expect(Period.Day).toBe(1);
    expect(Period.Week).toBe(2);
    expect(Period.Month).toBe(3);
    expect(Period.Year).toBe(4);
  });
});

describe('keyTypeForKey (BDSKKeyType)', () => {
  it('classifies special keys first', () => {
    expect(keyTypeForKey(DATE_ADDED_KEY, classifier)).toBe(ConditionKeyType.Date);
    expect(keyTypeForKey(DATE_MODIFIED_KEY, classifier)).toBe(ConditionKeyType.Date);
    expect(keyTypeForKey(LOCAL_FILE_KEY, classifier)).toBe(ConditionKeyType.Attachment);
    expect(keyTypeForKey(REMOTE_URL_KEY, classifier)).toBe(ConditionKeyType.Attachment);
    expect(keyTypeForKey(COLOR_KEY, classifier)).toBe(ConditionKeyType.Color);
    expect(keyTypeForKey(COLOR_LABEL_KEY, classifier)).toBe(ConditionKeyType.Color);
  });

  it('classifies typed fields via the classifier', () => {
    expect(keyTypeForKey('Read', classifier)).toBe(ConditionKeyType.Boolean);
    expect(keyTypeForKey('Flag', classifier)).toBe(ConditionKeyType.TriState);
    expect(keyTypeForKey('Rating', classifier)).toBe(ConditionKeyType.Rating);
  });

  it('defaults to String', () => {
    expect(keyTypeForKey('Keywords', classifier)).toBe(ConditionKeyType.String);
    expect(keyTypeForKey('Author', classifier)).toBe(ConditionKeyType.String);
    expect(keyTypeForKey('Any Field', classifier)).toBe(ConditionKeyType.String);
  });
});

describe('coerceStringComparisonForTypedKey', () => {
  it('substring ops collapse to (in)equality', () => {
    expect(coerceStringComparisonForTypedKey(StringComparison.Contain)).toBe(StringComparison.Equal);
    expect(coerceStringComparisonForTypedKey(StringComparison.StartWith)).toBe(StringComparison.Equal);
    expect(coerceStringComparisonForTypedKey(StringComparison.EndWith)).toBe(StringComparison.Equal);
    expect(coerceStringComparisonForTypedKey(StringComparison.NotContain)).toBe(StringComparison.NotEqual);
  });
  it('equality/ordering pass through', () => {
    expect(coerceStringComparisonForTypedKey(StringComparison.Equal)).toBe(StringComparison.Equal);
    expect(coerceStringComparisonForTypedKey(StringComparison.Smaller)).toBe(StringComparison.Smaller);
    expect(coerceStringComparisonForTypedKey(StringComparison.Larger)).toBe(StringComparison.Larger);
  });
});
