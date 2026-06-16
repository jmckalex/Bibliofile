import { describe, it, expect } from 'vitest';
import { makeAuthor, type Author } from './author.js';
import { parseName } from './parseName.js';
import { usingRealDetexify } from './tex.js';

/** Pull just the four parsed parts. */
function parts(a: Author) {
  return { first: a.first, von: a.von, last: a.last, jr: a.jr };
}

describe('makeAuthor — sanity / dependency wiring', () => {
  it('uses the real @bibdesk/tex detexify (not a fallback)', () => {
    expect(usingRealDetexify).toBe(true);
  });

  it('result is frozen (safe to share / structured-clone)', () => {
    const a = makeAuthor('Donald E. Knuth');
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.firstNames)).toBe(true);
    expect(a.originalName).toBe('Donald E. Knuth');
  });
});

describe('makeAuthor — display variants for "Donald E. Knuth"', () => {
  const a = makeAuthor('Donald E. Knuth');
  it('parts', () => {
    expect(parts(a)).toEqual({ first: 'Donald E.', von: '', last: 'Knuth', jr: '' });
  });
  it('name "First von Last, Jr"', () => expect(a.name).toBe('Donald E. Knuth'));
  it('normalizedName "von Last, Jr, First"', () =>
    expect(a.normalizedName).toBe('Knuth, Donald E.'));
  it('fullLastName "von Last, Jr"', () => expect(a.fullLastName).toBe('Knuth'));
  it('abbreviatedName "F. M. von Last, Jr"', () =>
    expect(a.abbreviatedName).toBe('D. E. Knuth'));
  it('abbreviatedNormalizedName', () =>
    expect(a.abbreviatedNormalizedName).toBe('Knuth, D. E.'));
  it('unpunctuatedAbbreviatedNormalizedName', () =>
    expect(a.unpunctuatedAbbreviatedNormalizedName).toBe('Knuth DE'));
  it('sortableName (last first, deTeXified, lowercased)', () =>
    expect(a.sortableName).toBe('knuth donald e.'));
  it('displayName (name, TeX removed)', () =>
    expect(a.displayName).toBe('Donald E. Knuth'));
  it('fuzzyName', () => expect(a.fuzzyName).toBe('knuth'));
  it('firstNames split on space + period', () =>
    expect(a.firstNames).toEqual(['Donald', 'E']));
});

describe('makeAuthor — von names', () => {
  it('"Ludwig von Beethoven"', () => {
    const a = makeAuthor('Ludwig von Beethoven');
    expect(parts(a)).toEqual({ first: 'Ludwig', von: 'von', last: 'Beethoven', jr: '' });
    expect(a.name).toBe('Ludwig von Beethoven');
    expect(a.normalizedName).toBe('von Beethoven, Ludwig');
    expect(a.fullLastName).toBe('von Beethoven');
    expect(a.abbreviatedName).toBe('L. von Beethoven');
    expect(a.abbreviatedNormalizedName).toBe('von Beethoven, L.');
    expect(a.unpunctuatedAbbreviatedNormalizedName).toBe('von Beethoven L');
    // sortableName omits the von part (BibDesk sortCompare semantics)
    expect(a.sortableName).toBe('beethoven ludwig');
    // fuzzyName includes von+last
    expect(a.fuzzyName).toBe('vonbeethoven');
  });

  it('comma form "von Beethoven, Ludwig" produces identical variants', () => {
    const a = makeAuthor('von Beethoven, Ludwig');
    expect(a.name).toBe('Ludwig von Beethoven');
    expect(a.normalizedName).toBe('von Beethoven, Ludwig');
    expect(a.sortableName).toBe('beethoven ludwig');
  });

  it('long von "Charles Louis Xavier Joseph de la Vallée Poussin"', () => {
    const a = makeAuthor('Charles Louis Xavier Joseph de la Vallée Poussin');
    expect(parts(a)).toEqual({
      first: 'Charles Louis Xavier Joseph',
      von: 'de la',
      last: 'Vallée Poussin',
      jr: '',
    });
    expect(a.normalizedName).toBe(
      'de la Vallée Poussin, Charles Louis Xavier Joseph',
    );
    expect(a.fullLastName).toBe('de la Vallée Poussin');
    expect(a.abbreviatedName).toBe('C. L. X. J. de la Vallée Poussin');
    expect(a.abbreviatedNormalizedName).toBe('de la Vallée Poussin, C. L. X. J.');
    expect(a.unpunctuatedAbbreviatedNormalizedName).toBe('de la Vallée Poussin CLXJ');
    expect(a.sortableName).toBe('vallée poussin charles louis xavier joseph');
    expect(a.firstNames).toEqual(['Charles', 'Louis', 'Xavier', 'Joseph']);
  });
});

describe('makeAuthor — jr / suffix', () => {
  it('"Ford, Jr., Henry"', () => {
    const a = makeAuthor('Ford, Jr., Henry');
    expect(parts(a)).toEqual({ first: 'Henry', von: '', last: 'Ford', jr: 'Jr.' });
    expect(a.name).toBe('Henry Ford, Jr.');
    expect(a.normalizedName).toBe('Ford, Jr., Henry');
    expect(a.fullLastName).toBe('Ford, Jr.');
    expect(a.abbreviatedName).toBe('H. Ford, Jr.');
    expect(a.abbreviatedNormalizedName).toBe('Ford, Jr., H.');
    expect(a.unpunctuatedAbbreviatedNormalizedName).toBe('Ford H Jr.');
    // sortableName omits von AND jr
    expect(a.sortableName).toBe('ford henry');
    expect(a.fuzzyName).toBe('ford');
  });
});

describe('makeAuthor — compound-dash / hyphenated initials', () => {
  it('"Pomies, M.-P." abbreviates to "M.-P." (first LETTER per fragment, dash kept)', () => {
    const a = makeAuthor('Pomies, M.-P.');
    expect(parts(a)).toEqual({ first: 'M.-P.', von: '', last: 'Pomies', jr: '' });
    // firstNames are split on space+period, so "M.-P." -> ["M", "-P"]
    expect(a.firstNames).toEqual(['M', '-P']);
    // critical: NOT "M. -. Pomies" (bug #1436631) — first letter, dash preserved
    expect(a.abbreviatedName).toBe('M.-P. Pomies');
    expect(a.abbreviatedNormalizedName).toBe('Pomies, M.-P.');
    expect(a.unpunctuatedAbbreviatedNormalizedName).toBe('Pomies MP');
    expect(a.name).toBe('M.-P. Pomies');
  });

  it('"Jean-Paul Sartre" abbreviates to "J.-P."', () => {
    const a = makeAuthor('Jean-Paul Sartre');
    expect(parts(a)).toEqual({ first: 'Jean-Paul', von: '', last: 'Sartre', jr: '' });
    // single token containing a dash
    expect(a.firstNames).toEqual(['Jean-Paul']);
    expect(a.abbreviatedName).toBe('J.-P. Sartre');
    expect(a.abbreviatedNormalizedName).toBe('Sartre, J.-P.');
    expect(a.unpunctuatedAbbreviatedNormalizedName).toBe('Sartre JP');
  });
});

describe('makeAuthor — accented names via @bibdesk/tex', () => {
  it("\"{\\'E}variste Galois\" deTeXifies for display + initial", () => {
    const a = makeAuthor("{\\'E}variste Galois");
    expect(parts(a)).toEqual({
      first: "{\\'E}variste",
      von: '',
      last: 'Galois',
      jr: '',
    });
    // firstNames come from the deTeXified first name
    expect(a.firstNames).toEqual(['Évariste']);
    // the initial is the accented letter, not "{" or "\"
    expect(a.abbreviatedName).toBe('É. Galois');
    expect(a.abbreviatedNormalizedName).toBe('Galois, É.');
    // displayName strips TeX
    expect(a.displayName).toBe('Évariste Galois');
    // name keeps the raw TeX source
    expect(a.name).toBe("{\\'E}variste Galois");
    expect(a.fuzzyName).toBe('galois');
  });
});

describe('makeAuthor — corporate / protected names', () => {
  it('"{Barnes and Noble, Inc.}" is a single last-name unit', () => {
    const a = makeAuthor('{Barnes and Noble, Inc.}');
    expect(parts(a)).toEqual({
      first: '',
      von: '',
      last: '{Barnes and Noble, Inc.}',
      jr: '',
    });
    expect(a.name).toBe('{Barnes and Noble, Inc.}');
    expect(a.normalizedName).toBe('{Barnes and Noble, Inc.}');
    // no first name -> abbreviatedName == fullLastName
    expect(a.abbreviatedName).toBe('{Barnes and Noble, Inc.}');
    expect(a.firstNames).toEqual([]);
    // sortableName strips braces; fuzzyName strips all punctuation
    expect(a.sortableName).toBe('barnes and noble, inc.');
    expect(a.fuzzyName).toBe('barnesandnobleinc');
  });

  it('"John Paul {Getty}" keeps the protected last token braced', () => {
    const a = makeAuthor('John Paul {Getty}');
    expect(parts(a)).toEqual({ first: 'John Paul', von: '', last: '{Getty}', jr: '' });
    expect(a.name).toBe('John Paul {Getty}');
    expect(a.normalizedName).toBe('{Getty}, John Paul');
    expect(a.abbreviatedName).toBe('J. P. {Getty}');
    // braces stripped for sort key, dropped for fuzzy key
    expect(a.sortableName).toBe('getty john paul');
    expect(a.fuzzyName).toBe('getty');
  });
});

describe('makeAuthor — arabic article prefix', () => {
  it('"al-Khwarizmi, Muhammad" — "al-" is part of the last name', () => {
    const a = makeAuthor('al-Khwarizmi, Muhammad');
    expect(parts(a)).toEqual({
      first: 'Muhammad',
      von: '',
      last: 'al-Khwarizmi',
      jr: '',
    });
    expect(a.abbreviatedName).toBe('M. al-Khwarizmi');
    expect(a.fuzzyName).toBe('alkhwarizmi');
  });
});

describe('makeAuthor — multi-token last name', () => {
  it('"Brinch Hansen, Per"', () => {
    const a = makeAuthor('Brinch Hansen, Per');
    expect(parts(a)).toEqual({
      first: 'Per',
      von: '',
      last: 'Brinch Hansen',
      jr: '',
    });
    expect(a.abbreviatedName).toBe('P. Brinch Hansen');
    expect(a.sortableName).toBe('brinch hansen per');
    expect(a.fuzzyName).toBe('brinchhansen');
  });
});

describe('makeAuthor — empty author', () => {
  it('empty name yields all-empty variants', () => {
    const a = makeAuthor('');
    expect(parts(a)).toEqual({ first: '', von: '', last: '', jr: '' });
    expect(a.name).toBe('');
    expect(a.normalizedName).toBe('');
    expect(a.firstNames).toEqual([]);
    expect(a.abbreviatedName).toBe('');
  });
});

describe('normalizedName re-parse invariant', () => {
  // Parsing an author's normalizedName ("von Last, Jr, First") must round-trip
  // back to the same four parts.
  const cases = [
    'Donald E. Knuth',
    'Ludwig von Beethoven',
    'von Beethoven, Ludwig',
    'Charles Louis Xavier Joseph de la Vallée Poussin',
    'Ford, Jr., Henry',
    'Pomies, M.-P.',
    'al-Khwarizmi, Muhammad',
    'Brinch Hansen, Per',
    'John Paul {Getty}',
    '{Barnes and Noble, Inc.}',
  ];
  for (const name of cases) {
    it(`"${name}" -> normalizedName re-parses to the same parts`, () => {
      const a = makeAuthor(name);
      const re = parseName(a.normalizedName);
      expect({ first: re.first, von: re.von, last: re.last, jr: re.jr }).toEqual(
        parts(a),
      );
    });
  }
});
