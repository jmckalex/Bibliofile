import { describe, it, expect } from 'vitest';
import {
  detexify,
  texify,
  escapeTexReserved,
  unescapeTexReserved,
  TEX_RESERVED_ESCAPES,
} from './index.js';

// ---------------------------------------------------------------------------
// LaTeX reserved-character escaping layer (`\&` `\%` `\$` `\#` `\_`).
//
// This is layered on top of the plist-faithful core by the public `texify`/`detexify`:
//   texify:   `&`->`\&`, `%`->`\%`, `#`->`\#`, `_`->`\_`   (`$` left as math delimiter)
//   detexify: `\&`->`&`, `\%`->`%`, `\$`->`$`, `\#`->`#`, `\_`->`_`
// ---------------------------------------------------------------------------

describe('escapeTexReserved (texify direction, outside math)', () => {
  it('escapes & % # _ each', () => {
    expect(escapeTexReserved('&')).toBe('\\&');
    expect(escapeTexReserved('%')).toBe('\\%');
    expect(escapeTexReserved('#')).toBe('\\#');
    expect(escapeTexReserved('_')).toBe('\\_');
  });

  it('does NOT escape a bare $ (it is the math delimiter)', () => {
    expect(escapeTexReserved('$')).toBe('$');
  });

  it('escapes reserved chars within ordinary text', () => {
    expect(escapeTexReserved('AT&T 50% off #1 a_b')).toBe('AT\\&T 50\\% off \\#1 a\\_b');
  });

  it('does not double-escape already-escaped sequences', () => {
    expect(escapeTexReserved('AT\\&T')).toBe('AT\\&T');
    expect(escapeTexReserved('100\\%')).toBe('100\\%');
  });

  it('preserves a backslash command and its following char verbatim', () => {
    // \& is copied as-is; the following plain text continues to be escaped.
    expect(escapeTexReserved('\\& and & again')).toBe('\\& and \\& again');
  });
});

describe('escapeTexReserved — math spans are left untouched', () => {
  it('does not escape reserved chars inside $...$', () => {
    expect(escapeTexReserved('$a_b$')).toBe('$a_b$');
    expect(escapeTexReserved('$x^2 + y_1$')).toBe('$x^2 + y_1$');
  });

  it('escapes outside, leaves inside untouched (mixed)', () => {
    expect(escapeTexReserved('cost is 50% of $x_1$ total')).toBe(
      'cost is 50\\% of $x_1$ total',
    );
  });

  it('an unterminated $ opens math to end-of-string', () => {
    // trailing math span: its tail (a_b) is not escaped.
    expect(escapeTexReserved('see $a_b')).toBe('see $a_b');
  });

  it('two math spans with escaping between them', () => {
    expect(escapeTexReserved('$a_1$ & $b_2$')).toBe('$a_1$ \\& $b_2$');
  });
});

describe('unescapeTexReserved (detexify direction)', () => {
  it('de-escapes \\& \\% \\$ \\# \\_', () => {
    expect(unescapeTexReserved('\\&')).toBe('&');
    expect(unescapeTexReserved('\\%')).toBe('%');
    expect(unescapeTexReserved('\\$')).toBe('$');
    expect(unescapeTexReserved('\\#')).toBe('#');
    expect(unescapeTexReserved('\\_')).toBe('_');
  });

  it('leaves non-reserved backslash commands intact', () => {
    expect(unescapeTexReserved('\\alpha')).toBe('\\alpha');
    expect(unescapeTexReserved('\\textbf{x}')).toBe('\\textbf{x}');
  });

  it('mixed reserved + command', () => {
    expect(unescapeTexReserved('AT\\&T uses \\alpha')).toBe('AT&T uses \\alpha');
  });

  it('no backslash -> returned unchanged (fast path)', () => {
    expect(unescapeTexReserved('plain text')).toBe('plain text');
  });
});

describe('reserved-char round-trips through public texify/detexify', () => {
  const CASES: ReadonlyArray<readonly [string, string]> = [
    // [literal unicode/ascii, expected TeX after texify]
    ['AT&T', 'AT\\&T'],
    ['50% off', '50\\% off'],
    ['item #3', 'item \\#3'],
    ['file_name', 'file\\_name'],
    ['a&b%c#d_e', 'a\\&b\\%c\\#d\\_e'],
  ];

  for (const [lit, tex] of CASES) {
    it(`texify(${JSON.stringify(lit)}) === ${JSON.stringify(tex)}`, () => {
      expect(texify(lit)).toBe(tex);
    });
    it(`round-trip detexify(texify(${JSON.stringify(lit)})) === ${JSON.stringify(lit)}`, () => {
      expect(detexify(texify(lit))).toBe(lit);
    });
  }

  it('$ round-trips: detexify removes \\$ escape; texify leaves $ alone', () => {
    expect(detexify('price \\$5')).toBe('price $5');
    // texify does not re-escape a literal $ (one-way; preserves math delimiters).
    expect(texify('price $5')).toBe('price $5');
  });

  it('combined reserved chars + accents in one field', () => {
    expect(texify('Müller & Co. 100%')).toBe('M{\\"u}ller \\& Co. 100\\%');
    expect(detexify('M{\\"u}ller \\& Co. 100\\%')).toBe('Müller & Co. 100%'.normalize('NFC'));
  });
});

describe('TEX_RESERVED_ESCAPES table integrity', () => {
  it('exposes the five reserved-char escapes', () => {
    expect(TEX_RESERVED_ESCAPES['&']).toBe('\\&');
    expect(TEX_RESERVED_ESCAPES['%']).toBe('\\%');
    expect(TEX_RESERVED_ESCAPES['#']).toBe('\\#');
    expect(TEX_RESERVED_ESCAPES['_']).toBe('\\_');
    expect(TEX_RESERVED_ESCAPES['$']).toBe('\\$');
    expect(Object.keys(TEX_RESERVED_ESCAPES).length).toBe(5);
  });
});

describe('math spans pass through the full texify pipeline untouched', () => {
  it('leaves a $...$ math span verbatim while escaping outside text', () => {
    expect(texify('see $x_1 + y^2$ & more')).toBe('see $x_1 + y^2$ \\& more');
  });

  it('degree-sign one-way output (math) is not re-escaped on a second texify', () => {
    // texify(°) -> "$\,^{\circ}$"; running texify again must not corrupt the math.
    const once = texify('°');
    expect(once).toBe('$\\,^{\\circ}$');
    expect(texify(once)).toBe('$\\,^{\\circ}$');
  });
});
