import { describe, it, expect } from 'vitest';
import {
  authorsEquivalent,
  splitGroupFieldValue,
  groupValuesForField,
  fieldContainsCategory,
  fieldIsEmptyForGroups,
  itemContainedInGroupForField,
  type Author,
} from './index.js';
import { makeItem } from './test-helpers.js';

const author = (
  originalName: string,
  first: string,
  fuzzyName: string,
  firstNames: string[],
): Author => ({ originalName, first, fuzzyName, firstNames });

describe('authorsEquivalent (fuzzy)', () => {
  it('equal fuzzyName + both no first name -> equivalent', () => {
    expect(
      authorsEquivalent(author('Dawkins', '', 'dawkins', []), author('Dawkins', '', 'dawkins', [])),
    ).toBe(true);
  });
  it('one empty first name -> not equivalent', () => {
    expect(
      authorsEquivalent(author('Dawkins', '', 'dawkins', []), author('Dawkins, R', 'R', 'dawkins', ['R'])),
    ).toBe(false);
  });
  it('initials match prefix -> equivalent', () => {
    expect(
      authorsEquivalent(
        author('Dawkins, R.', 'R.', 'dawkins', ['R.']),
        author('Dawkins, R. E.', 'R. E.', 'dawkins', ['R.', 'E.']),
      ),
    ).toBe(true);
  });
  it('different fuzzyName -> not equivalent', () => {
    expect(
      authorsEquivalent(author('Dawkins', 'R', 'dawkins', ['R']), author('Darwin', 'C', 'darwin', ['C'])),
    ).toBe(false);
  });
});

describe('splitGroupFieldValue', () => {
  it('splits on the default separators ;:,', () => {
    expect(splitGroupFieldValue('evolution; biology, genetics')).toEqual([
      'evolution',
      'biology',
      'genetics',
    ]);
  });
  it('falls back to " and " when no separator chars present', () => {
    expect(splitGroupFieldValue('Smith and Jones and Lee')).toEqual(['Smith', 'Jones', 'Lee']);
  });
  it('trims and drops empties', () => {
    expect(splitGroupFieldValue('  a ;; b ,')).toEqual(['a', 'b']);
  });
  it('empty string -> []', () => {
    expect(splitGroupFieldValue('')).toEqual([]);
  });
});

describe('groupValuesForField on real BibItems', () => {
  it('splits a multi-value Keywords field', () => {
    const item = makeItem({ fields: { Keywords: 'evolution, biology, genetics' } });
    expect(groupValuesForField(item, 'Keywords')).toEqual(['evolution', 'biology', 'genetics']);
  });
  it('takes a single-valued group field whole (Journal)', () => {
    const item = makeItem({ fields: { Journal: 'Nature; Science' } });
    expect(groupValuesForField(item, 'Journal')).toEqual(['Nature; Science']);
  });
  it('returns Author objects for a person field', () => {
    const item = makeItem({ fields: { Author: 'Dawkins, Richard and Darwin, Charles' } });
    const vals = groupValuesForField(item, 'Author') as Author[];
    expect(vals.length).toBe(2);
    expect(vals[0]!.fuzzyName.length).toBeGreaterThan(0);
  });
  it('empty field -> []', () => {
    const item = makeItem({ fields: {} });
    expect(groupValuesForField(item, 'Keywords')).toEqual([]);
  });
});

describe('fieldContainsCategory', () => {
  it('string category membership (exact, case-sensitive)', () => {
    const item = makeItem({ fields: { Keywords: 'evolution, biology' } });
    expect(fieldContainsCategory(item, 'Keywords', 'biology')).toBe(true);
    expect(fieldContainsCategory(item, 'Keywords', 'Biology')).toBe(false); // case-sensitive
    expect(fieldContainsCategory(item, 'Keywords', 'genetics')).toBe(false);
  });

  it('person category with fuzzy author equivalence', () => {
    const item = makeItem({ fields: { Author: 'Dawkins, Richard' } });
    // whole-token first name "Robert" is NOT compatible with the item's "Richard"
    const wrongFirst = author('Dawkins, Robert', 'Robert', 'dawkins', ['Robert']);
    expect(fieldContainsCategory(item, 'Author', wrongFirst)).toBe(false);
    // matching whole first name -> equivalent
    const sameFirst = author('Dawkins, Richard', 'Richard', 'dawkins', ['Richard']);
    expect(fieldContainsCategory(item, 'Author', sameFirst)).toBe(true);
    // an initials prefix of the item's first names is compatible (R. vs Richard
    // are NOT — whole-token compare — but R. vs R. would be). Different surname:
    const otherSurname = author('Darwin, Charles', 'Charles', 'darwin', ['Charles']);
    expect(fieldContainsCategory(item, 'Author', otherSurname)).toBe(false);
  });
});

describe('fieldIsEmptyForGroups', () => {
  it('true when the field has no value', () => {
    const item = makeItem({ fields: { Title: 'X' } });
    expect(fieldIsEmptyForGroups(item, 'Keywords')).toBe(true);
  });
  it('false when the field has a value', () => {
    const item = makeItem({ fields: { Keywords: 'evolution' } });
    expect(fieldIsEmptyForGroups(item, 'Keywords')).toBe(false);
  });
});

describe('itemContainedInGroupForField (GroupContain helper)', () => {
  it('non-person: exact string match', () => {
    const item = makeItem({ fields: { Keywords: 'evolution, biology' } });
    const make = (n: string): Author => author(n, '', n, []);
    expect(itemContainedInGroupForField(item, 'Keywords', 'biology', make)).toBe(true);
    expect(itemContainedInGroupForField(item, 'Keywords', 'genetics', make)).toBe(false);
  });
});
