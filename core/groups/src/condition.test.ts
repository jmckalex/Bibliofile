import { describe, it, expect } from 'vitest';
import {
  Condition,
  StringComparison,
  AttachmentComparison,
  DateComparison,
  Period,
  LOCAL_FILE_KEY,
  REMOTE_URL_KEY,
  DATE_ADDED_KEY,
  ALL_FIELDS_KEY,
  type EvaluableItem,
  type EvaluateOptions,
} from './index.js';
import { makeItem } from './test-helpers.js';

const cond = (key: string, comparison: number, value: string): Condition =>
  new Condition({ key, comparison, value });

describe('Condition — empty key', () => {
  it('matches anything', () => {
    const item = makeItem({ fields: { Title: 'X' } });
    expect(cond('', StringComparison.Contain, 'foo').evaluate(item)).toBe(true);
  });
});

describe('Condition — string comparisons', () => {
  const item = makeItem({ fields: { Title: 'The Selfish Gene', Author: 'Dawkins, Richard' } });

  it('Contain (case-insensitive)', () => {
    expect(cond('Title', StringComparison.Contain, 'selfish').evaluate(item)).toBe(true);
    expect(cond('Title', StringComparison.Contain, 'altruistic').evaluate(item)).toBe(false);
  });
  it('NotContain', () => {
    expect(cond('Title', StringComparison.NotContain, 'altruistic').evaluate(item)).toBe(true);
    expect(cond('Title', StringComparison.NotContain, 'gene').evaluate(item)).toBe(false);
  });
  it('StartWith', () => {
    expect(cond('Title', StringComparison.StartWith, 'the ').evaluate(item)).toBe(true);
    expect(cond('Title', StringComparison.StartWith, 'gene').evaluate(item)).toBe(false);
  });
  it('EndWith', () => {
    expect(cond('Title', StringComparison.EndWith, 'GENE').evaluate(item)).toBe(true);
    expect(cond('Title', StringComparison.EndWith, 'selfish').evaluate(item)).toBe(false);
  });
  it('Equal / NotEqual (case-insensitive)', () => {
    expect(cond('Title', StringComparison.Equal, 'the selfish gene').evaluate(item)).toBe(true);
    expect(cond('Title', StringComparison.Equal, 'selfish').evaluate(item)).toBe(false);
    expect(cond('Title', StringComparison.NotEqual, 'selfish').evaluate(item)).toBe(true);
  });
  it('unset field is treated as empty string', () => {
    expect(cond('Note', StringComparison.Contain, 'x').evaluate(item)).toBe(false);
    expect(cond('Note', StringComparison.Equal, '').evaluate(item)).toBe(true);
  });
  it('Smaller / Larger (locale numeric ordering)', () => {
    const yrItem = makeItem({ fields: { Year: '2010' } });
    // Larger: item value (2010) > condition value (2000)
    expect(cond('Year', StringComparison.Larger, '2000').evaluate(yrItem)).toBe(true);
    expect(cond('Year', StringComparison.Larger, '2020').evaluate(yrItem)).toBe(false);
    expect(cond('Year', StringComparison.Smaller, '2020').evaluate(yrItem)).toBe(true);
  });
});

describe('Condition — rating', () => {
  const item = makeItem({ fields: { Rating: '4' } });
  it('Equal via contain-coercion', () => {
    expect(cond('Rating', StringComparison.Contain, '4').evaluate(item)).toBe(true);
    expect(cond('Rating', StringComparison.Equal, '3').evaluate(item)).toBe(false);
  });
  it('Larger / Smaller numeric', () => {
    expect(cond('Rating', StringComparison.Larger, '3').evaluate(item)).toBe(true);
    expect(cond('Rating', StringComparison.Smaller, '5').evaluate(item)).toBe(true);
    expect(cond('Rating', StringComparison.Larger, '4').evaluate(item)).toBe(false);
  });
});

describe('Condition — boolean', () => {
  it('Equal compares booleanValue (contain coerced to equal)', () => {
    const read = makeItem({ fields: { Read: 'Yes' } });
    const unread = makeItem({ fields: { Read: 'No' } });
    expect(cond('Read', StringComparison.Equal, 'Yes').evaluate(read)).toBe(true);
    expect(cond('Read', StringComparison.Contain, 'Yes').evaluate(read)).toBe(true);
    expect(cond('Read', StringComparison.Equal, 'Yes').evaluate(unread)).toBe(false);
    expect(cond('Read', StringComparison.NotContain, 'Yes').evaluate(unread)).toBe(true);
  });
});

describe('Condition — tri-state (via classifier stub)', () => {
  // Build an item-like object so we can mark "Flag" as tri-state.
  function triItem(value: string): EvaluableItem {
    const base = makeItem({ fields: { Flag: value } });
    const tm = {
      isBooleanField: (f: string) => f === 'Read',
      isTriStateField: (f: string) => f === 'Flag',
      isRatingField: (f: string) => f === 'Rating',
      isPersonField: (f: string) => f === 'Author' || f === 'Editor',
      isSingleValuedGroupField: (f: string) => base.typeManager.isSingleValuedGroupField(f),
    };
    return new Proxy(base, {
      get(target, prop, recv) {
        if (prop === 'typeManager') return tm;
        return Reflect.get(target, prop, recv);
      },
    }) as unknown as EvaluableItem;
  }

  it('off / mixed / on ordering: mixed sorts between off and on', () => {
    const on = triItem('2'); // on -> +1
    const off = triItem('0'); // off -> -1
    const mixed = triItem('1'); // mixed -> 0
    expect(cond('Flag', StringComparison.Equal, '2').evaluate(on)).toBe(true);
    expect(cond('Flag', StringComparison.Equal, '0').evaluate(off)).toBe(true);
    // Larger: itemValue(on=+1) vs value(off=-1): on is larger
    expect(cond('Flag', StringComparison.Larger, '0').evaluate(on)).toBe(true);
    // mixed sorts above off
    expect(cond('Flag', StringComparison.Larger, '0').evaluate(mixed)).toBe(true);
  });
});

describe('Condition — attachments', () => {
  const item = makeItem({
    localFiles: ['/Users/x/papers/dawkins.pdf', '/Users/x/notes.txt'],
    remoteURLs: ['https://example.com/a.html'],
  });

  it('count comparisons on local files', () => {
    expect(cond(LOCAL_FILE_KEY, AttachmentComparison.CountEqual, '2').evaluate(item)).toBe(true);
    expect(cond(LOCAL_FILE_KEY, AttachmentComparison.CountNotEqual, '2').evaluate(item)).toBe(false);
    expect(cond(LOCAL_FILE_KEY, AttachmentComparison.CountLarger, '1').evaluate(item)).toBe(true);
    expect(cond(LOCAL_FILE_KEY, AttachmentComparison.CountSmaller, '3').evaluate(item)).toBe(true);
  });

  it('has-no local files (count == 0)', () => {
    const none = makeItem({});
    expect(cond(LOCAL_FILE_KEY, AttachmentComparison.CountEqual, '0').evaluate(none)).toBe(true);
    expect(cond(LOCAL_FILE_KEY, AttachmentComparison.CountLarger, '0').evaluate(none)).toBe(false);
  });

  it('count comparisons on remote URLs', () => {
    expect(cond(REMOTE_URL_KEY, AttachmentComparison.CountEqual, '1').evaluate(item)).toBe(true);
    expect(cond(REMOTE_URL_KEY, AttachmentComparison.CountLarger, '0').evaluate(item)).toBe(true);
  });

  it('Contain / NotContain on file paths', () => {
    expect(cond(LOCAL_FILE_KEY, AttachmentComparison.Contain, 'dawkins').evaluate(item)).toBe(true);
    expect(cond(LOCAL_FILE_KEY, AttachmentComparison.Contain, 'absent').evaluate(item)).toBe(false);
    expect(cond(LOCAL_FILE_KEY, AttachmentComparison.NotContain, 'absent').evaluate(item)).toBe(true);
  });

  it('StartWith / EndWith on paths', () => {
    expect(cond(LOCAL_FILE_KEY, AttachmentComparison.StartWith, '/users/x/papers').evaluate(item)).toBe(true);
    expect(cond(LOCAL_FILE_KEY, AttachmentComparison.EndWith, '.pdf').evaluate(item)).toBe(true);
    expect(cond(LOCAL_FILE_KEY, AttachmentComparison.EndWith, '.doc').evaluate(item)).toBe(false);
  });

  it('Contain with no attachments returns matchReturnValue=false', () => {
    const none = makeItem({});
    expect(cond(LOCAL_FILE_KEY, AttachmentComparison.Contain, 'x').evaluate(none)).toBe(false);
    expect(cond(LOCAL_FILE_KEY, AttachmentComparison.NotContain, 'x').evaluate(none)).toBe(true);
  });
});

describe('Condition — Any Field', () => {
  const item = makeItem({
    fields: { Title: 'Evolution', Author: 'Darwin, Charles', Note: 'origin of species' },
  });

  it('Contain searches across all fields', () => {
    expect(cond(ALL_FIELDS_KEY, StringComparison.Contain, 'darwin').evaluate(item)).toBe(true);
    expect(cond(ALL_FIELDS_KEY, StringComparison.Contain, 'origin').evaluate(item)).toBe(true);
    expect(cond(ALL_FIELDS_KEY, StringComparison.Contain, 'absent').evaluate(item)).toBe(false);
  });

  it('NotContain across all fields', () => {
    expect(cond(ALL_FIELDS_KEY, StringComparison.NotContain, 'absent').evaluate(item)).toBe(true);
    expect(cond(ALL_FIELDS_KEY, StringComparison.NotContain, 'evolution').evaluate(item)).toBe(false);
  });

  it('Equal matches a whole field value (delimited contain)', () => {
    expect(cond(ALL_FIELDS_KEY, StringComparison.Equal, 'Evolution').evaluate(item)).toBe(true);
    // a substring of a field is NOT equal to a whole field
    expect(cond(ALL_FIELDS_KEY, StringComparison.Equal, 'Evol').evaluate(item)).toBe(false);
  });
});

describe('Condition — date through the Condition class (injected now)', () => {
  const now = new Date(2024, 2, 15, 12, 0, 0);
  const opts: EvaluateOptions = { now };

  it('Date-Added InLast 7 days via dateAdded property', () => {
    const recent = makeItem({ dateAdded: '2024-03-12 10:00:00 +0000' });
    const old = makeItem({ dateAdded: '2024-01-01 10:00:00 +0000' });
    const c = cond(DATE_ADDED_KEY, DateComparison.InLast, `7 ${Period.Day}`);
    expect(c.evaluate(recent, opts)).toBe(true);
    expect(c.evaluate(old, opts)).toBe(false);
  });

  it('Date-Added BeforeDate', () => {
    const c = cond(DATE_ADDED_KEY, DateComparison.BeforeDate, '2024-02-01 00:00:00 +0000');
    const before = makeItem({ dateAdded: '2024-01-15 00:00:00 +0000' });
    const after = makeItem({ dateAdded: '2024-03-01 00:00:00 +0000' });
    expect(c.evaluate(before, opts)).toBe(true);
    expect(c.evaluate(after, opts)).toBe(false);
  });
});
