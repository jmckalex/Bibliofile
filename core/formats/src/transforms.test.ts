import { describe, it, expect } from 'vitest';
import {
  lossyASCII,
  replaceComposedCharacters,
  removeCurlyBraces,
  removeTeX,
  acronym,
  collapseWhitespace,
} from './transforms.js';

describe('removeTeX', () => {
  it('strips math delimiters, command backslashes, and braces', () => {
    expect(removeTeX('$O(\\log n)$')).toBe('O(log n)'); // the reported AutoFile case
    expect(removeTeX('The {DNA} sequence')).toBe('The DNA sequence');
    expect(removeTeX('$x^2$')).toBe('x^2'); // $ removed; ^ left (valid in a filename)
  });
  it('leaves plain text untouched (fast path)', () => {
    expect(removeTeX('A plain title')).toBe('A plain title');
    expect(removeTeX('')).toBe('');
  });
});

describe('lossyASCII', () => {
  it('leaves pure-ASCII strings unchanged', () => {
    expect(lossyASCII('Smith2020')).toBe('Smith2020');
    expect(lossyASCII('')).toBe('');
  });

  it('folds Latin accents to base letters', () => {
    expect(lossyASCII('Müller')).toBe('Muller');
    expect(lossyASCII('café')).toBe('cafe');
    expect(lossyASCII('Crépeau')).toBe('Crepeau');
    expect(lossyASCII('naïve')).toBe('naive');
    expect(lossyASCII('Gödel')).toBe('Godel');
  });

  it('maps ligatures / special letters via the composed-char table', () => {
    expect(lossyASCII('ﬁle')).toBe('file'); // U+FB01 fi ligature
    expect(lossyASCII('Straße')).toBe('Strasse'); // ß -> ss
    expect(lossyASCII('Ø')).toBe('O');
    expect(lossyASCII('æon')).toBe('aeon');
    expect(lossyASCII('Œuvre')).toBe('OEuvre');
  });

  it('drops un-transliterable non-Latin code points (lossy)', () => {
    // Greek/CJK have no NFKD ASCII form -> dropped.
    expect(lossyASCII('Ω')).toBe('');
    expect(lossyASCII('a好b')).toBe('ab');
  });
});

describe('replaceComposedCharacters', () => {
  it('strips combining accents', () => {
    expect(replaceComposedCharacters('Müller')).toBe('Muller');
    expect(replaceComposedCharacters('café')).toBe('cafe');
  });

  it('applies the ligature map but does NOT drop other non-ASCII', () => {
    expect(replaceComposedCharacters('ß')).toBe('ss');
    expect(replaceComposedCharacters('Ø')).toBe('O');
    // a base letter with no combining mark and not in the map stays as-is
    expect(replaceComposedCharacters('Ω')).toBe('Ω');
  });
});

describe('removeCurlyBraces', () => {
  it('removes unescaped braces', () => {
    expect(removeCurlyBraces('{Hello}')).toBe('Hello');
    expect(removeCurlyBraces('a{b}c')).toBe('abc');
  });
  it('keeps backslash-escaped braces', () => {
    expect(removeCurlyBraces('a\\{b\\}c')).toBe('a\\{b\\}c');
  });
});

describe('acronym', () => {
  it('takes first letters of long words', () => {
    expect(acronym('Journal of Artificial Intelligence Research')).toBe('JAIR');
  });
  it('ignores words whose length is <= the ignore length', () => {
    // Only "Journal" (7) exceeds ignoreLength 3; of/the/ACM are <= 3 => skipped.
    expect(acronym('Journal of the ACM', 3)).toBe('J');
  });
  it('a trailing-period word resets its ignore length to 0', () => {
    // "Proc." => trailing period => counts even though "Proc" (4) would anyway.
    // of(2)/Foo(3) are <= 3 => skipped.
    expect(acronym('Proc. of Foo', 3)).toBe('P');
  });
  it('with ignoreLength 0, every word contributes', () => {
    expect(acronym('Journal of the ACM', 0)).toBe('JOTA');
  });
});

describe('collapseWhitespace', () => {
  it('collapses runs and trims', () => {
    expect(collapseWhitespace('  a   b\tc  ')).toBe('a b c');
  });
});
