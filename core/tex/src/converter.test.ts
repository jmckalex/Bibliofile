import { describe, it, expect } from 'vitest';
import {
  detexify,
  texify,
  detexifyCore,
  texifyCore,
  texifyChar,
  detexifyAccentSpan,
} from './index.js';

// ---------------------------------------------------------------------------
// Accent commands on representative letters, both directions.
// ---------------------------------------------------------------------------

describe('accent algorithm — round-trip on representative letters', () => {
  // [unicode (NFC), canonical TeX]
  const PAIRS: ReadonlyArray<readonly [string, string]> = [
    // acute '
    ['á', "{\\'a}"],
    ['é', "{\\'e}"],
    ['í', "{\\'\\i}"], // dotless-i form
    ['ó', "{\\'o}"],
    ['ú', "{\\'u}"],
    ['Á', "{\\'A}"],
    ['É', "{\\'E}"],
    ['ć', "{\\'c}"],
    // grave `
    ['à', '{\\`a}'],
    ['è', '{\\`e}'],
    ['ì', '{\\`\\i}'],
    ['ò', '{\\`o}'],
    ['ù', '{\\`u}'],
    ['Ì', '{\\`I}'],
    // circumflex ^
    ['â', '{\\^a}'],
    ['ê', '{\\^e}'],
    ['î', '{\\^\\i}'],
    ['ô', '{\\^o}'],
    ['û', '{\\^u}'],
    ['Â', '{\\^A}'],
    // tilde ~
    ['ã', '{\\~a}'],
    ['ñ', '{\\~n}'],
    ['õ', '{\\~o}'],
    ['Ã', '{\\~A}'],
    // diaeresis "
    ['ä', '{\\"a}'],
    ['ë', '{\\"e}'],
    ['ï', '{\\"\\i}'],
    ['ö', '{\\"o}'],
    ['ü', '{\\"u}'],
    ['ÿ', '{\\"y}'],
    ['Ä', '{\\"A}'],
    ['Ÿ', '{\\"Y}'],
    // macron =
    ['ā', '{\\=a}'],
    ['ī', '{\\=\\i}'],
    ['ū', '{\\=u}'],
    ['Ā', '{\\=A}'],
    // caron / hacek (v ) — letter accent, needs a space
    ['Š', '{\\v S}'],
    ['š', '{\\v s}'],
    ['Ž', '{\\v Z}'],
    ['ž', '{\\v z}'],
    ['Č', '{\\v C}'],
    ['č', '{\\v c}'],
    ['ě', '{\\v e}'],
    // cedilla (c )
    ['ç', '{\\c c}'],
    ['Ç', '{\\c C}'],
    ['ş', '{\\c s}'],
    // Hungarian double acute (H )
    ['ő', '{\\H o}'],
    // under-dot (d )
    ['ṣ', '{\\d s}'],
    ['Ṣ', '{\\d S}'],
    ['ḥ', '{\\d h}'],
    ['ḍ', '{\\d d}'],
    ['ṭ', '{\\d t}'],
    ['ẓ', '{\\d z}'],
    ['Ḥ', '{\\d H}'],
    ['Ḍ', '{\\d D}'],
    ['Ṭ', '{\\d T}'],
    ['Ẓ', '{\\d Z}'],
  ];

  for (const [uni, tex] of PAIRS) {
    it(`detexify ${JSON.stringify(tex)} -> ${JSON.stringify(uni)}`, () => {
      expect(detexify(tex)).toBe(uni.normalize('NFC'));
    });
    it(`texify ${JSON.stringify(uni)} -> ${JSON.stringify(tex)}`, () => {
      expect(texify(uni)).toBe(tex);
    });
    it(`round-trip texify(detexify(${JSON.stringify(tex)})) is stable`, () => {
      expect(texify(detexify(tex))).toBe(tex);
    });
    it(`round-trip detexify(texify(${JSON.stringify(uni)})) === ${JSON.stringify(uni)}`, () => {
      expect(detexify(texify(uni))).toBe(uni.normalize('NFC'));
    });
  }
});

// ---------------------------------------------------------------------------
// Special letter commands (ligatures / slashed / dotless).
// ---------------------------------------------------------------------------

describe('special letter commands', () => {
  const PAIRS: ReadonlyArray<readonly [string, string]> = [
    ['ß', '{\\ss}'],
    ['ø', '{\\o}'],
    ['Ø', '{\\O}'],
    ['æ', '{\\ae}'],
    ['Æ', '{\\AE}'],
    ['œ', '{\\oe}'],
    ['Œ', '{\\OE}'],
    ['å', '{\\aa}'],
    ['Å', '{\\AA}'],
    ['ł', '{\\l}'],
    ['Ł', '{\\L}'],
  ];
  for (const [uni, tex] of PAIRS) {
    it(`detexify ${tex} -> ${uni}`, () => expect(detexify(tex)).toBe(uni));
    it(`texify ${uni} -> ${tex}`, () => expect(texify(uni)).toBe(tex));
  }

  it('dotless i: {\\i} -> ı and ı -> {\\i} (augmentation beyond plist)', () => {
    expect(detexify('{\\i}')).toBe('ı');
    expect(texify('ı')).toBe('{\\i}');
    expect(detexify(texify('ı'))).toBe('ı');
  });

  it('dotless j: {\\j} -> ȷ and ȷ -> {\\j} (augmentation beyond plist)', () => {
    expect(detexify('{\\j}')).toBe('ȷ');
    expect(texify('ȷ')).toBe('{\\j}');
    expect(detexify(texify('ȷ'))).toBe('ȷ');
  });
});

// ---------------------------------------------------------------------------
// Symbol / punctuation dictionary entries (round-trippable, not one-way).
// ---------------------------------------------------------------------------

describe('symbol dictionary entries (two-way)', () => {
  const PAIRS: ReadonlyArray<readonly [string, string]> = [
    ['§', '{\\S}'],
    ['©', '{\\copyright}'],
    ['®', '{\\textregistered}'],
    ['™', '{\\texttrademark}'],
    ['…', '{\\ldots}'],
    ['¡', "{!'}"],
  ];
  for (const [uni, tex] of PAIRS) {
    it(`detexify ${tex} -> ${uni}`, () => expect(detexify(tex)).toBe(uni));
    it(`texify ${uni} -> ${tex}`, () => expect(texify(uni)).toBe(tex));
    it(`round trip ${uni}`, () => expect(detexify(texify(uni))).toBe(uni));
  }

  // {\cc} is a TeX-to-Roman-only alias for ç (Roman->TeX uses {\c c}).
  it('{\\cc} alias detexifies to ç but texify of ç uses {\\c c}', () => {
    expect(detexify('{\\cc}')).toBe('ç');
    expect(texify('ç')).toBe('{\\c c}');
  });
});

// ---------------------------------------------------------------------------
// Tolerant input forms on detexify.
// ---------------------------------------------------------------------------

describe('detexify tolerant input forms', () => {
  it('accepts a space between accent and letter: {\\\' i}', () => {
    expect(detexify("{\\' i}")).toBe('í'.normalize('NFC'));
  });
  it('accepts {\\v S} (letter accent + space)', () => {
    expect(detexify('{\\v S}')).toBe('Š');
  });
  it('rejects {\\vS} (letter accent without space) — left untouched', () => {
    // not in dictionary, accent codec requires the space, so it passes through.
    expect(detexify('{\\vS}')).toBe('{\\vS}');
  });
  it('multiple accents in one word', () => {
    expect(detexify('na{\\"\\i}ve')).toBe('naïve'.normalize('NFC'));
    expect(texify('naïve')).toBe('na{\\"\\i}ve');
  });
  it('accents embedded in surrounding ASCII', () => {
    expect(detexify("caf{\\'e} au lait")).toBe('café au lait'.normalize('NFC'));
    expect(texify('café au lait')).toBe("caf{\\'e} au lait");
  });
});

// ---------------------------------------------------------------------------
// Single-char / single-span helpers.
// ---------------------------------------------------------------------------

describe('texifyChar helper', () => {
  it('converts a single composed char', () => {
    expect(texifyChar('é')).toBe("{\\'e}");
    expect(texifyChar('Š')).toBe('{\\v S}');
    expect(texifyChar('í')).toBe("{\\'\\i}");
  });
  it('returns null for non-accented ASCII', () => {
    expect(texifyChar('a')).toBe('a'); // base letter, len 1 -> itself
    expect(texifyChar('!')).toBeNull();
  });
  it('returns null for unknown / multi-mark composition', () => {
    expect(texifyChar('字')).toBeNull();
  });
  it('under-dot accents keep the dotted i (no \\i swap)', () => {
    // ị = i + combining dot below
    expect(texifyChar('ị')).toBe('{\\d i}');
  });
});

describe('detexifyAccentSpan helper', () => {
  it('parses a full {\\...} span', () => {
    expect(detexifyAccentSpan("{\\'e}")).toBe('é');
    expect(detexifyAccentSpan('{\\v Z}')).toBe('Ž');
  });
  it('returns null for non-accent spans', () => {
    expect(detexifyAccentSpan('{\\ss}')).toBeNull(); // not an accent command
    expect(detexifyAccentSpan('plain')).toBeNull();
    expect(detexifyAccentSpan("{\\'ee}")).toBeNull(); // two base letters
  });
});

// ---------------------------------------------------------------------------
// Core (plist-faithful) vs. layered behavior.
// ---------------------------------------------------------------------------

describe('core vs layered', () => {
  it('detexifyCore does NOT de-escape reserved chars', () => {
    expect(detexifyCore('AT\\&T')).toBe('AT\\&T');
    expect(detexify('AT\\&T')).toBe('AT&T');
  });
  it('texifyCore does NOT escape reserved chars', () => {
    expect(texifyCore('AT&T')).toBe('AT&T');
    expect(texify('AT&T')).toBe('AT\\&T');
  });
  it('detexifyCore still does accents', () => {
    expect(detexifyCore("{\\'e}")).toBe('é');
  });
});

// ---------------------------------------------------------------------------
// Pass-through behavior.
// ---------------------------------------------------------------------------

describe('pass-through', () => {
  it('empty string', () => {
    expect(detexify('')).toBe('');
    expect(texify('')).toBe('');
  });
  it('plain ASCII unchanged', () => {
    expect(detexify('Hello, world.')).toBe('Hello, world.');
    expect(texify('Hello, world.')).toBe('Hello, world.');
  });
  it('unknown TeX command left untouched', () => {
    expect(detexify('{\\unknowncmd x}')).toBe('{\\unknowncmd x}');
  });
  it('text without {\\ is returned as-is by detexify', () => {
    expect(detexify('a b c')).toBe('a b c');
  });
});
