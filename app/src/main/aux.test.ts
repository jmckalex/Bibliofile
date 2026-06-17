import { describe, it, expect } from 'vitest';
import { parseAuxCiteKeys } from './aux.js';

describe('parseAuxCiteKeys', () => {
  it('extracts \\citation keys, splitting comma lists and de-duping in order', () => {
    const aux = [
      '\\relax',
      '\\citation{knuth1984,lamport1994}',
      '\\citation{knuth1984}', // duplicate
      '\\citation{dijkstra1968}',
    ].join('\n');
    expect(parseAuxCiteKeys(aux)).toEqual(['knuth1984', 'lamport1994', 'dijkstra1968']);
  });

  it('skips the \\nocite{*} marker', () => {
    expect(parseAuxCiteKeys('\\citation{*}\n\\citation{real2020}')).toEqual(['real2020']);
  });

  it('reads \\bibcite keys (BibTeX write-back), taking the first brace', () => {
    expect(parseAuxCiteKeys('\\bibcite{smith2001}{1}')).toEqual(['smith2001']);
  });

  it('reads biblatex \\abx@aux@cite in both 1- and 2-arg forms (key is the last brace)', () => {
    const aux = '\\abx@aux@cite{older1999}\n\\abx@aux@cite{0}{newer2020}';
    expect(parseAuxCiteKeys(aux)).toEqual(['older1999', 'newer2020']);
  });

  it('merges all forms, de-duped, preserving first-seen order', () => {
    const aux = [
      '\\citation{a,b}',
      '\\bibcite{b}{2}', // dup of b
      '\\abx@aux@cite{0}{c}',
      '\\citation{a}', // dup of a
    ].join('\n');
    expect(parseAuxCiteKeys(aux)).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for an aux with no citations', () => {
    expect(parseAuxCiteKeys('\\relax\n\\@input{sub.aux}')).toEqual([]);
  });
});
