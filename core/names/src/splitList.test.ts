import { describe, it, expect } from 'vitest';
import { splitNameList, hasOthers, OTHERS } from './splitList.js';
import { parseAuthorField } from './index.js';

describe('splitNameList — brace-aware " and " splitting', () => {
  it('two simple authors', () => {
    expect(splitNameList('Donald Knuth and Leslie Lamport')).toEqual([
      'Donald Knuth',
      'Leslie Lamport',
    ]);
  });

  it('three authors', () => {
    expect(splitNameList('A. One and B. Two and C. Three')).toEqual([
      'A. One',
      'B. Two',
      'C. Three',
    ]);
  });

  it('single author, no delimiter', () => {
    expect(splitNameList('Donald Knuth')).toEqual(['Donald Knuth']);
  });

  it('case-insensitive delimiter (AND / And)', () => {
    expect(splitNameList('X AND Y')).toEqual(['X', 'Y']);
    expect(splitNameList('X And Y')).toEqual(['X', 'Y']);
  });

  it('does not split " and " inside braces', () => {
    expect(splitNameList('{Barnes and Noble, Inc.}')).toEqual([
      '{Barnes and Noble, Inc.}',
    ]);
  });

  it('braced group + real delimiter: "{Lecue and Ardila} and Smith, John"', () => {
    expect(splitNameList('{Lecue and Ardila} and Smith, John')).toEqual([
      '{Lecue and Ardila}',
      'Smith, John',
    ]);
  });

  it('does not split "and" that is part of a word (no flanking spaces)', () => {
    expect(splitNameList('Anderson and Sand')).toEqual(['Anderson', 'Sand']);
    expect(splitNameList('Strandberg')).toEqual(['Strandberg']);
  });

  it('drops empty elements from "X and and Y"', () => {
    expect(splitNameList('X and and Y')).toEqual(['X', 'Y']);
  });

  it('collapses whitespace / newlines around delimiter', () => {
    expect(splitNameList('Knuth\n  and\n  Lamport')).toEqual(['Knuth', 'Lamport']);
  });

  it('empty field -> empty list', () => {
    expect(splitNameList('')).toEqual([]);
    expect(splitNameList('   ')).toEqual([]);
  });
});

describe('splitNameList — others handling', () => {
  it('"and others" yields the OTHERS sentinel', () => {
    const list = splitNameList('Knuth and others');
    expect(list).toEqual(['Knuth', OTHERS]);
    expect(hasOthers(list)).toBe(true);
  });

  it('bare "others" alone', () => {
    expect(splitNameList('others')).toEqual([OTHERS]);
  });

  it('case-insensitive "Others"', () => {
    expect(splitNameList('Knuth and Others')).toEqual(['Knuth', OTHERS]);
  });
});

describe('parseAuthorField', () => {
  it('builds Author objects and flags others', () => {
    const r = parseAuthorField('Donald Knuth and others');
    expect(r.authors.map((a) => a.last)).toEqual(['Knuth']);
    expect(r.hasOthers).toBe(true);
  });

  it('corporate author kept as a single Author', () => {
    const r = parseAuthorField('{Barnes and Noble, Inc.}');
    expect(r.authors).toHaveLength(1);
    expect(r.authors[0]!.last).toBe('{Barnes and Noble, Inc.}');
    expect(r.hasOthers).toBe(false);
  });
});
