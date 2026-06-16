import { describe, it, expect } from 'vitest';
import { texify, detexify, ONE_WAY_CONVERSIONS } from './index.js';

// The "One-Way Conversions" section of CharacterConversion.plist is lossy BY DESIGN:
// it is part of the texify (Unicode -> TeX) dictionary only, and is NOT in the
// TeX -> Roman (detexify) dictionary. So texify maps the Unicode char to its TeX/ASCII
// form, but detexify does NOT reconstruct the original Unicode (the ASCII form is kept).
//
// These tests document and lock in that intentional asymmetry.

describe('one-way (lossy) conversions — texify direction', () => {
  const CASES: ReadonlyArray<readonly [string, string, string]> = [
    // [name, unicode input, expected texify output]
    ['en-dash', '–', '--'],
    ['em-dash', '—', '---'],
    ['left single quote', '‘', '`'],
    ['right single quote (apostrophe)', '’', "'"],
    ['left double quote', '“', '``'],
    ['right double quote', '”', "''"],
    ['low-9 double quote', '‟', '``'],
    ['single high-reversed-9 quote', '‛', '`'],
    ['bullet', '•', '*'],
    ['degree sign', '°', '$\\,^{\\circ}$'],
    ['plus-minus', '±', '$\\pm$'],
    ['soft hyphen', '­', '-'],
    ['no-break space', ' ', ' '],
    ['ff ligature', 'ﬀ', 'ff'],
    ['fi ligature', 'ﬁ', 'fi'],
    ['fl ligature', 'ﬂ', 'fl'],
    ['ffi ligature', 'ﬃ', 'ffi'],
    ['ffl ligature', 'ﬄ', 'ffl'],
  ];

  for (const [name, input, expected] of CASES) {
    it(`texify ${name}`, () => {
      expect(texify(input)).toBe(expected);
    });
  }
});

describe('one-way conversions are NOT reversed by detexify (documented lossiness)', () => {
  it('en-dash: texify(–)=-- but detexify(--) stays --', () => {
    expect(texify('–')).toBe('--');
    expect(detexify('--')).toBe('--');
  });
  it('em-dash: texify(—)=--- but detexify(---) stays ---', () => {
    expect(texify('—')).toBe('---');
    expect(detexify('---')).toBe('---');
  });
  it('ligature fi: texify(ﬁ)=fi but detexify(fi) stays fi', () => {
    expect(texify('ﬁ')).toBe('fi');
    expect(detexify('fi')).toBe('fi');
  });
  it('smart quotes do not round-trip back to curly quotes', () => {
    expect(texify('“Hi”')).toBe('``Hi\'\'');
    expect(detexify('``Hi\'\'')).toBe('``Hi\'\''); // stays ASCII
  });
  it('degree sign: texify produces math, detexify does not reconstruct °', () => {
    expect(texify('°')).toBe('$\\,^{\\circ}$');
    // detexify leaves the math span untouched (no {\ accent group inside)
    expect(detexify('$\\,^{\\circ}$')).toBe('$\\,^{\\circ}$');
  });

  // Property: every one-way value, fed back through detexify, is unchanged (lossy).
  it('all one-way TeX forms are stable under detexify', () => {
    for (const value of Object.values(ONE_WAY_CONVERSIONS)) {
      // detexify must not turn the ASCII/TeX form back into the original Unicode key.
      expect(detexify(value)).toBe(value);
    }
  });
});

describe('one-way table integrity', () => {
  it('exposes the verbatim One-Way Conversions table', () => {
    expect(Object.keys(ONE_WAY_CONVERSIONS).length).toBe(18);
    expect(ONE_WAY_CONVERSIONS['–']).toBe('--');
    expect(ONE_WAY_CONVERSIONS['—']).toBe('---');
  });
});
