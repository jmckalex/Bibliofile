import { describe, it, expect } from 'vitest';
import { parseName } from './parseName.js';

function parts(name: string) {
  const p = parseName(name);
  return { first: p.first, von: p.von, last: p.last, jr: p.jr };
}

describe('parseName — Patashnik 4-part split', () => {
  it('single token is the last name', () => {
    expect(parts('Knuth')).toEqual({ first: '', von: '', last: 'Knuth', jr: '' });
  });

  it('simple "First Last"', () => {
    expect(parts('Donald Knuth')).toEqual({
      first: 'Donald',
      von: '',
      last: 'Knuth',
      jr: '',
    });
  });

  it('first + middle + last', () => {
    expect(parts('Donald E. Knuth')).toEqual({
      first: 'Donald E.',
      von: '',
      last: 'Knuth',
      jr: '',
    });
  });

  it('hyphenated first name "Jean-Paul Sartre"', () => {
    expect(parts('Jean-Paul Sartre')).toEqual({
      first: 'Jean-Paul',
      von: '',
      last: 'Sartre',
      jr: '',
    });
  });

  it('no-comma von form "Ludwig von Beethoven"', () => {
    expect(parts('Ludwig von Beethoven')).toEqual({
      first: 'Ludwig',
      von: 'von',
      last: 'Beethoven',
      jr: '',
    });
  });

  it('comma von form "von Beethoven, Ludwig"', () => {
    expect(parts('von Beethoven, Ludwig')).toEqual({
      first: 'Ludwig',
      von: 'von',
      last: 'Beethoven',
      jr: '',
    });
  });

  it('long multi-token von "Charles Louis Xavier Joseph de la Vallée Poussin"', () => {
    expect(parts('Charles Louis Xavier Joseph de la Vallée Poussin')).toEqual({
      first: 'Charles Louis Xavier Joseph',
      von: 'de la',
      last: 'Vallée Poussin',
      jr: '',
    });
  });

  it('multi-token last name with no von needs a comma: "Brinch Hansen, Per"', () => {
    expect(parts('Brinch Hansen, Per')).toEqual({
      first: 'Per',
      von: '',
      last: 'Brinch Hansen',
      jr: '',
    });
  });

  it('no-comma "Per Brinch Hansen" -> Brinch is part of last only via lowercase rule', () => {
    // No commas, no lowercase tokens -> first = all but last token, last = last token.
    expect(parts('Per Brinch Hansen')).toEqual({
      first: 'Per Brinch',
      von: '',
      last: 'Hansen',
      jr: '',
    });
  });

  it('two-comma jr form "Ford, Jr., Henry"', () => {
    expect(parts('Ford, Jr., Henry')).toEqual({
      first: 'Henry',
      von: '',
      last: 'Ford',
      jr: 'Jr.',
    });
  });

  it('"al-Khwarizmi, Muhammad" — al- starts uppercase A so no von', () => {
    expect(parts('al-Khwarizmi, Muhammad')).toEqual({
      first: 'Muhammad',
      von: '',
      last: 'al-Khwarizmi',
      jr: '',
    });
  });

  it('compound-dash initials "Pomies, M.-P."', () => {
    expect(parts('Pomies, M.-P.')).toEqual({
      first: 'M.-P.',
      von: '',
      last: 'Pomies',
      jr: '',
    });
  });

  it('lowercase-only last name rolls back so a last name survives', () => {
    // "jean de la fontaine" -> all lowercase. The von run can't eat the final
    // token; last token stays as the last name.
    expect(parts('jean de la fontaine')).toEqual({
      first: '',
      von: 'jean de la',
      last: 'fontaine',
      jr: '',
    });
  });
});

describe('parseName — corporate / protected names', () => {
  it('whole name braced "{Barnes and Noble, Inc.}" stays one last-name unit', () => {
    expect(parts('{Barnes and Noble, Inc.}')).toEqual({
      first: '',
      von: '',
      last: '{Barnes and Noble, Inc.}',
      jr: '',
    });
  });

  it('protected last token "John Paul {Getty}"', () => {
    expect(parts('John Paul {Getty}')).toEqual({
      first: 'John Paul',
      von: '',
      last: '{Getty}',
      jr: '',
    });
  });

  it('braced group is not a von token even if it contains lowercase', () => {
    // "{von} Beethoven" — the brace group starts with '{' so is uppercase.
    expect(parts('Ludwig {von} Beethoven')).toEqual({
      first: 'Ludwig {von}',
      von: '',
      last: 'Beethoven',
      jr: '',
    });
  });
});

describe('parseName — whitespace + edge handling', () => {
  it('collapses internal whitespace and newlines', () => {
    expect(parts('  Donald   E.\n Knuth ')).toEqual({
      first: 'Donald E.',
      von: '',
      last: 'Knuth',
      jr: '',
    });
  });

  it('empty string', () => {
    expect(parts('')).toEqual({ first: '', von: '', last: '', jr: '' });
  });

  it('more than two commas: extras demoted', () => {
    // "Last, Jr, First, Extra" -> third comma demoted to space, joining First Extra.
    expect(parts('Ford, Jr, Henry, Sr')).toEqual({
      first: 'Henry Sr',
      von: '',
      last: 'Ford',
      jr: 'Jr',
    });
  });
});
