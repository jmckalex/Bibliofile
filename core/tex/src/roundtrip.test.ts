import { describe, it, expect } from 'vitest';
import {
  detexify,
  texify,
  ROMAN_TO_TEX,
  TEX_TO_ROMAN,
  ONE_WAY_CONVERSIONS,
} from './index.js';

// ---------------------------------------------------------------------------
// Exhaustive, data-driven round-trip property tests over the full plist tables.
// These iterate every dictionary entry so a regression in any single mapping is caught.
// ---------------------------------------------------------------------------

// "Roman to TeX" entries are the canonical texify mappings. For these,
//   texify(unicode) === tex          (canonical TeX form)
//   detexify(tex)   === unicode       (NFC)
// EXCEPT the dictionary alias `{\cc}` (TeX-to-Roman only) and the literal `{!'}` key
// which is handled separately. We drive from ROMAN_TO_TEX (the texify side).
describe('property: every Roman->TeX entry texifies to its canonical TeX form', () => {
  for (const [uni, tex] of Object.entries(ROMAN_TO_TEX)) {
    it(`texify(${JSON.stringify(uni)}) === ${JSON.stringify(tex)}`, () => {
      expect(texify(uni)).toBe(tex);
    });
  }
});

describe('property: every TeX->Roman entry detexifies to its Unicode char', () => {
  for (const [tex, uni] of Object.entries(TEX_TO_ROMAN)) {
    it(`detexify(${JSON.stringify(tex)}) === ${JSON.stringify(uni)}`, () => {
      expect(detexify(tex)).toBe(uni.normalize('NFC'));
    });
  }
});

describe('property: Unicode -> TeX -> Unicode is identity for all Roman->TeX chars', () => {
  for (const [uni] of Object.entries(ROMAN_TO_TEX)) {
    it(`detexify(texify(${JSON.stringify(uni)})) === ${JSON.stringify(uni)}`, () => {
      expect(detexify(texify(uni))).toBe(uni.normalize('NFC'));
    });
  }
});

describe('property: canonical TeX -> Unicode -> TeX is stable for all Roman->TeX entries', () => {
  for (const [, tex] of Object.entries(ROMAN_TO_TEX)) {
    it(`texify(detexify(${JSON.stringify(tex)})) === ${JSON.stringify(tex)}`, () => {
      expect(texify(detexify(tex))).toBe(tex);
    });
  }
});

// ---------------------------------------------------------------------------
// One-way (lossy) section: texify maps, detexify must NOT reconstruct.
// ---------------------------------------------------------------------------
describe('property: One-Way Conversions are lossy (texify maps, detexify does not reverse)', () => {
  for (const [uni, tex] of Object.entries(ONE_WAY_CONVERSIONS)) {
    it(`texify(${JSON.stringify(uni)}) === ${JSON.stringify(tex)} and is not reversed`, () => {
      expect(texify(uni)).toBe(tex);
      // detexify of the TeX/ASCII output must not yield the original Unicode key.
      expect(detexify(tex)).not.toBe(uni);
    });
  }
});

// ---------------------------------------------------------------------------
// Inverted exclamation mark `¡` <-> `{!'}` : the single non-"{\"-anchored key.
//
// In BibDesk's original `BDSKConverter`, the detexify scanner only matches `{\`,
// so `{!'}` is unreachable and `¡` is effectively one-way (texify only). This port
// adds a literal pre-pass so `¡` round-trips. These tests lock in that improvement.
// ---------------------------------------------------------------------------
describe('inverted exclamation mark round-trips (improvement over BibDesk)', () => {
  it('texify(¡) === {!\'}', () => {
    expect(texify('¡')).toBe("{!'}");
  });
  it("detexify({!'}) === ¡", () => {
    expect(detexify("{!'}")).toBe('¡');
  });
  it('round-trips both directions', () => {
    expect(detexify(texify('¡'))).toBe('¡');
    expect(texify(detexify("{!'}"))).toBe("{!'}");
  });
  it('handles ¡ embedded in surrounding text', () => {
    expect(detexify("{!'}Hola{!'}")).toBe('¡Hola¡');
    expect(texify('¡Hola¡')).toBe("{!'}Hola{!'}");
  });
});

// ---------------------------------------------------------------------------
// Edge cases from subsystem-02 §4 (deTeXification hard problems).
// ---------------------------------------------------------------------------
describe('edge cases — brace scanning & recovery', () => {
  it('unbalanced/missing closing brace: bails, leaves remainder untouched', () => {
    // "{\'e" never closes; BibDesk logs and stops. We leave it as-is.
    expect(detexify("caf{\\'e")).toBe("caf{\\'e");
  });

  it('a converted accent followed by an unbalanced span: converts what it can', () => {
    // first span converts, second is unterminated -> stops after the second open.
    expect(detexify("{\\'e} and caf{\\'e")).toBe("é and caf{\\'e");
  });

  it('failed span advances by one char and is left untouched', () => {
    expect(detexify('{\\unknown x}')).toBe('{\\unknown x}');
  });

  it('rejects a multi-letter base in an accent span (length != 1)', () => {
    expect(detexify("{\\'ab}")).toBe("{\\'ab}");
  });

  it('rejects {\\vS} (letter accent without required space)', () => {
    expect(detexify('{\\vS}')).toBe('{\\vS}');
  });

  it('tolerates {\\\' i} (space between accent and letter)', () => {
    expect(detexify("{\\' i}")).toBe('í'.normalize('NFC'));
  });

  it('NFD input is normalized: e + combining acute texifies to {\\\'e}', () => {
    const decomposed = 'é'; // NFD form of é
    expect(texify(decomposed)).toBe("{\\'e}");
  });

  it('astral / non-Latin chars pass through texify untouched', () => {
    expect(texify('𝓗ello 字 😀')).toBe('𝓗ello 字 😀');
  });

  it('multiple accented chars in a realistic name', () => {
    expect(detexify("{\\v S}ime{\\v c}ek")).toBe('Šimeček'.normalize('NFC'));
    expect(texify('Šimeček')).toBe('{\\v S}ime{\\v c}ek');
  });

  it('math span with no accent group is untouched by detexify', () => {
    expect(detexify('$E = mc^2$')).toBe('$E = mc^2$');
  });
});
