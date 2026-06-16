import { describe, it, expect } from 'vitest';
import { makeAuthor } from './author.js';
import {
  authorsEqual,
  authorsEquivalent,
  firstNamesCompatible,
  compareAuthorsForSort,
} from './compare.js';

describe('authorsEqual — case-insensitive normalizedName', () => {
  it('same canonical name in different input forms are equal', () => {
    expect(
      authorsEqual(makeAuthor('Ludwig von Beethoven'), makeAuthor('von Beethoven, Ludwig')),
    ).toBe(true);
  });

  it('case-insensitive on the normalized form', () => {
    // Both capitalize the leading token (so neither triggers the von rule); they
    // differ only in the case of the last name, which -isEqual: ignores.
    expect(authorsEqual(makeAuthor('Donald Knuth'), makeAuthor('Donald KNUTH'))).toBe(
      true,
    );
  });

  it('different first names are NOT equal', () => {
    expect(authorsEqual(makeAuthor('Donald Knuth'), makeAuthor('D. Knuth'))).toBe(false);
  });

  it('abbreviated vs full first name are NOT exactly equal', () => {
    expect(
      authorsEqual(makeAuthor('Knuth, Donald E.'), makeAuthor('Knuth, D. E.')),
    ).toBe(false);
  });
});

describe('authorsEquivalent — fuzzy duplicate detection', () => {
  it('same last name, both first names empty -> equivalent', () => {
    expect(authorsEquivalent(makeAuthor('Knuth'), makeAuthor('Knuth'))).toBe(true);
  });

  it('one first name present, the other empty -> not equivalent', () => {
    expect(authorsEquivalent(makeAuthor('Donald Knuth'), makeAuthor('Knuth'))).toBe(
      false,
    );
  });

  it('different last names -> not equivalent regardless of first', () => {
    expect(authorsEquivalent(makeAuthor('Donald Knuth'), makeAuthor('Donald Lamport'))).toBe(
      false,
    );
  });

  it('matching first-name prefix tokens -> equivalent ("Donald E." vs "Donald")', () => {
    // shorter token list is a prefix of the longer; shared tokens are equal
    expect(
      authorsEquivalent(makeAuthor('Knuth, Donald E.'), makeAuthor('Knuth, Donald')),
    ).toBe(true);
  });

  it('initial vs full first name -> NOT equivalent (whole-token compare, like BibDesk)', () => {
    // firstNames ["D","E"] vs ["Donald","E"]; "D" != "Donald"
    expect(
      authorsEquivalent(makeAuthor('Knuth, D. E.'), makeAuthor('Knuth, Donald E.')),
    ).toBe(false);
  });

  it('matching initials are equivalent ("D. E." vs "D. E.")', () => {
    expect(authorsEquivalent(makeAuthor('Knuth, D. E.'), makeAuthor('Knuth, D. E.'))).toBe(
      true,
    );
  });

  it('fuzzy ignores TeX/braces/punctuation in the last name', () => {
    // "{Getty}" and "Getty" collapse to the same fuzzyName
    expect(authorsEquivalent(makeAuthor('John {Getty}'), makeAuthor('John Getty'))).toBe(
      true,
    );
  });
});

describe('firstNamesCompatible — prefix token comparison', () => {
  it('empty lists are compatible', () => {
    expect(firstNamesCompatible([], [])).toBe(true);
  });
  it('prefix match up to shorter list', () => {
    expect(firstNamesCompatible(['Donald'], ['Donald', 'E'])).toBe(true);
  });
  it('case-insensitive', () => {
    expect(firstNamesCompatible(['donald'], ['Donald'])).toBe(true);
  });
  it('mismatch fails', () => {
    expect(firstNamesCompatible(['Don'], ['Donald'])).toBe(false);
  });
});

describe('compareAuthorsForSort — sortableName ordering', () => {
  it('orders by last name', () => {
    const a = makeAuthor('Donald Knuth');
    const b = makeAuthor('Leslie Lamport');
    expect(compareAuthorsForSort(a, b)).toBeLessThan(0);
    expect(compareAuthorsForSort(b, a)).toBeGreaterThan(0);
  });

  it('equal sortable names compare equal', () => {
    expect(
      compareAuthorsForSort(makeAuthor('Donald Knuth'), makeAuthor('Donald Knuth')),
    ).toBe(0);
  });

  it('von part is ignored in sort key (sorts on last name)', () => {
    // "von Beethoven" sorts under "beethoven", before "Knuth"
    const beethoven = makeAuthor('Ludwig von Beethoven');
    const knuth = makeAuthor('Donald Knuth');
    expect(compareAuthorsForSort(beethoven, knuth)).toBeLessThan(0);
  });

  it('a list sorts into expected order', () => {
    const authors = [
      makeAuthor('Donald Knuth'),
      makeAuthor('Ludwig von Beethoven'),
      makeAuthor('Leslie Lamport'),
    ];
    const sorted = [...authors].sort(compareAuthorsForSort).map((a) => a.last);
    expect(sorted).toEqual(['Beethoven', 'Knuth', 'Lamport']);
  });
});
