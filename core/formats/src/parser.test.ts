import { describe, it, expect } from 'vitest';
import { TypeManager, createBibItem, type BibItem } from '@bibdesk/model';
import { parseFormat } from './parser.js';
import { CITE_KEY_FIELD } from './sanitize.js';

const tm = new TypeManager();

function makeItem(fields: Record<string, string>, type = 'article'): BibItem {
  return createBibItem({ type, fields, typeManager: tm }, tm);
}

const smith2020 = () =>
  makeItem({
    Author: 'John Smith',
    Title: 'A Study of the Quantum Universe',
    Year: '2020',
    Month: 'jan',
    Journal: 'Nature',
  });

const multiAuthor = () =>
  makeItem({
    Author: 'John Smith and Jane Doe and Karl Mueller',
    Title: 'Collaborative Research Methods',
    Year: '2019',
  });

describe('author specifiers', () => {
  it('%a -> all author last names concatenated', () => {
    expect(parseFormat('%a', multiAuthor())).toBe('SmithDoeMueller');
  });
  it('%a1 -> first author last name only', () => {
    expect(parseFormat('%a1', smith2020())).toBe('Smith');
    expect(parseFormat('%a1', multiAuthor())).toBe('Smith');
  });
  it('%2a (separator+count via %a with N) -> first N', () => {
    // %a2 => first 2 authors
    expect(parseFormat('%a2', multiAuthor())).toBe('SmithDoe');
  });
  it('%a with [separator] joins author names', () => {
    expect(parseFormat('%a[-]', multiAuthor())).toBe('Smith-Doe-Mueller');
  });
  it('%a13 -> first author, first 3 chars of last name', () => {
    expect(parseFormat('%a13', smith2020())).toBe('Smi');
  });
  it('%A -> last name + first initial', () => {
    expect(parseFormat('%A1', smith2020())).toBe('Smith.J');
  });
  it('%p falls back to editor when there are no authors', () => {
    const ed = makeItem({ Editor: 'Anna Editor', Title: 'X', Year: '2000' });
    expect(parseFormat('%p', ed)).toBe('Editor');
  });
  it('a non-empty author IS produced when present (no fallback)', () => {
    const ed = makeItem({ Author: 'Anna Author', Title: 'X', Year: '2000' });
    expect(parseFormat('%a', ed, 'Note')).toBe('Author');
  });
  it('an all-empty result falls back to a numeric uniquifier ("1"), never empty', () => {
    // BibDesk forces uniqueSpecifier="n" when parsed + base are empty and there
    // is no unique specifier, for ANY field. The first available numeric (skips
    // leading "0") is "1".
    const ed = makeItem({ Editor: 'Anna Editor', Title: 'X', Year: '2000' });
    expect(parseFormat('%a', ed, CITE_KEY_FIELD, { citeKeyAvailable: () => true })).toBe(
      '1',
    );
    expect(parseFormat('%a', ed, 'Note')).toBe('1');
  });
  it('negative count selects the LAST N authors', () => {
    expect(parseFormat('%a-1', multiAuthor())).toBe('Mueller');
  });
  it('%a[sep][etal] appends the etal text when authors are truncated', () => {
    // %a[ ][ et al]1 => one author, " et al" appended because more remain.
    expect(parseFormat('%a[][ et al]1', multiAuthor())).toBe('Smith et al');
  });
  it('etal trailing digit further limits an explicit author count', () => {
    // explicit count 2 (<3 authors) lets the etal "x1" trailing digit reduce
    // the count to 1; the (digit-stripped) etal "x" is then appended.
    expect(parseFormat('%a[-][x1]2', multiAuthor())).toBe('Smithx');
  });
});

describe('title specifiers', () => {
  it('%t -> whole sanitized title (spaces collapse to dashes in cite key)', () => {
    expect(parseFormat('%t', smith2020())).toBe(
      'A-Study-of-the-Quantum-Universe',
    );
  });
  it('%t5 -> first 5 chars', () => {
    expect(parseFormat('%t5', smith2020())).toBe('A-Stu');
  });
  it('%T -> title by words (joined with sanitized space => dash)', () => {
    expect(parseFormat('%T', smith2020())).toBe(
      'A-Study-of-the-Quantum-Universe',
    );
  });
  it('%T2 -> emits words until 2 SIGNIFICANT (>3 char) words are taken', () => {
    // Short words (A/of/the) are emitted but do not count toward the limit;
    // Study and Quantum are the 2 significant words, then the loop stops.
    expect(parseFormat('%T2', smith2020())).toBe('A-Study-of-the-Quantum');
  });
  it('%T[smallWordLength]N omits words at/below the small-word length entirely', () => {
    // [3] => only words longer than 3 chars are emitted at all; N=1 => first one.
    expect(parseFormat('%T[3]1', smith2020())).toBe('Study');
  });
});

describe('year / month specifiers', () => {
  it('%Y -> 4-digit year', () => {
    expect(parseFormat('%Y', smith2020())).toBe('2020');
  });
  it('%y -> 2-digit year', () => {
    expect(parseFormat('%y', smith2020())).toBe('20');
  });
  it('%m -> 2-digit month from name', () => {
    expect(parseFormat('%m', smith2020())).toBe('01');
  });
  it('two-digit input year is normalized', () => {
    const it = makeItem({ Author: 'A B', Title: 'T', Year: '95' });
    expect(parseFormat('%Y', it)).toBe('1995');
    expect(parseFormat('%y', it)).toBe('95');
  });
});

describe('field / words / acronym / boolean specifiers', () => {
  it('%f{Journal} -> field value', () => {
    expect(parseFormat('%f{Journal}', smith2020())).toBe('Nature');
  });
  it('%f{Journal}3 -> first 3 chars', () => {
    expect(parseFormat('%f{Journal}3', smith2020())).toBe('Nat');
  });
  it('%f{Cite Key} reads the existing cite key for a non-cite-key field', () => {
    const it = smith2020();
    it.setCiteKey('Existing2020');
    expect(parseFormat('%f{Cite Key}', it, 'Note')).toBe('Existing2020');
  });
  it('%f{Missing} contributes nothing; combined with text the text remains', () => {
    // The empty field adds nothing, so only the literal prefix survives (and
    // because the overall result is non-empty, no uniquifier fallback fires).
    expect(parseFormat('vol%f{Volume}', smith2020(), 'Note')).toBe('vol');
  });
  it('%c{Title} -> acronym of significant words', () => {
    // "A Study of the Quantum Universe": Study, Quantum, Universe (>3) => SQU
    expect(parseFormat('%c{Title}', smith2020())).toBe('SQU');
  });
  it('%w{Title}[ ][/][_]2 -> first 2 words joined by sep', () => {
    expect(parseFormat('%w{Title}[ ][/][_]2', smith2020())).toBe('A_Study');
  });
  it('%s{Field}[yes][no] -> boolean selector', () => {
    tm.setFieldTypeOverrides({ 'Boolean fields': ['Read'] });
    const it = makeItem({
      Author: 'A B',
      Title: 'T',
      Year: '2000',
      Read: 'Yes',
    });
    expect(parseFormat('%s{Read}[Y][N]', it)).toBe('Y');
    const it2 = makeItem({ Author: 'A B', Title: 'T', Year: '2000', Read: 'No' });
    expect(parseFormat('%s{Read}[Y][N]', it2)).toBe('N');
    tm.resetFieldTypeOverrides();
  });
});

describe('escaped + literal specifiers', () => {
  it('%% -> literal percent', () => {
    expect(parseFormat('a%%b', smith2020())).toBe('a%b');
  });
  it('literal text passes through', () => {
    expect(parseFormat('REF-%a1-%Y', smith2020())).toBe('REF-Smith-2020');
  });
  it('%[ and %] escape brackets', () => {
    expect(parseFormat('%[x%]', smith2020())).toBe('[x]');
  });
});

describe('composite cite-key formats', () => {
  it('%a%Y', () => {
    expect(parseFormat('%a%Y', smith2020())).toBe('Smith2020');
  });
  it('%a%y%t (truncated by following specifiers)', () => {
    expect(parseFormat('%a1%y%t5', smith2020())).toBe('Smith20A-Stu');
  });
  it('%a1:%Y (the default-format prefix)', () => {
    expect(parseFormat('%a1:%Y', smith2020())).toBe('Smith:2020');
  });
});

describe('random specifiers (deterministic via injected RNG)', () => {
  it('%r3 -> 3 lowercase letters from RNG', () => {
    let i = 0;
    const seq = [0, 1, 25]; // a, b, z
    const random = () => seq[i++ % seq.length]! / 26;
    expect(parseFormat('%r3', smith2020(), CITE_KEY_FIELD, { random })).toBe(
      'abz',
    );
  });
  it('%d2 -> 2 digits from RNG', () => {
    let i = 0;
    const seq = [0, 9];
    const random = () => seq[i++ % seq.length]! / 10;
    expect(parseFormat('%d2', smith2020(), CITE_KEY_FIELD, { random })).toBe(
      '09',
    );
  });
});

describe('lowercase option', () => {
  it('lowercases the whole key', () => {
    expect(parseFormat('%a1%Y', smith2020(), CITE_KEY_FIELD, { lowercase: true })).toBe(
      'smith2020',
    );
  });
});
