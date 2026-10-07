/**
 * parseValueStrict decides whether text a person typed is a BibTeX value
 * expression. The editor uses it for a macro-valued field, so editing `nov` to
 * `dec` keeps the month macro instead of storing the literal `{dec}`.
 */

import { describe, it, expect } from 'vitest';
import { isComplex } from '@bibdesk/model';

import { parseValueStrict } from '../src/index';

const nodesOf = (text: string) => {
  const v = parseValueStrict(text);
  return v !== undefined && isComplex(v) ? v.nodes.map((n) => [n.type, n.value]) : v;
};

describe('parseValueStrict — well-formed expressions', () => {
  it('a bare macro name', () => {
    expect(nodesOf('dec')).toEqual([['macro', 'dec']]);
    expect(nodesOf('  dec  ')).toEqual([['macro', 'dec']]);
  });
  it('a #-joined expression', () => {
    expect(nodesOf('"Proc. " # acm')).toEqual([
      ['string', 'Proc. '],
      ['macro', 'acm'],
    ]);
    expect(nodesOf('{May} # " 2020"')).toEqual([
      ['string', 'May'],
      ['string', ' 2020'],
    ]);
  });
  it('a single literal piece unwraps to plain text', () => {
    expect(parseValueStrict('{December}')).toBe('December');
    expect(parseValueStrict('"December"')).toBe('December');
    expect(parseValueStrict('2020')).toBe('2020');
  });
});

describe('parseValueStrict — not an expression', () => {
  it.each([
    ['two words, no #', 'Spring term'],
    ['unclosed brace', '{May'],
    ['unclosed quote', '"May'],
    ['dangling #', 'dec #'],
    ['leading #', '# dec'],
    ['doubled #', 'a ## b'],
    ['empty', ''],
    ['whitespace only', '   '],
    ['brace inside a bare token', 'dec{'],
    ['comma in a bare token', 'jan,feb'],
  ])('%s: %j', (_label, text) => {
    expect(parseValueStrict(text)).toBeUndefined();
  });
});
