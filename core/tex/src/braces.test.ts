import { describe, it, expect } from 'vitest';
import { balanceBraces } from './braces.js';
import { detexify } from './index.js';

/** Net brace delta of a string (0 == balanced, never negative-in-the-middle). */
function isBraceBalanced(s: string): boolean {
  let depth = 0;
  for (const c of s) {
    if (c === '{') depth++;
    else if (c === '}') {
      if (depth === 0) return false;
      depth--;
    }
  }
  return depth === 0;
}

describe('balanceBraces', () => {
  it('is a strict no-op for already-balanced values', () => {
    for (const s of ['', 'plain', '{a}', '{a}{b}', 'a {b {c} d} e', '{\\"o}', 'Erd{\\"o}s']) {
      expect(balanceBraces(s)).toBe(s);
    }
  });

  it('rewrites unmatched braces to balanced LaTeX control words', () => {
    expect(balanceBraces('a}b{c')).toBe('a{\\textbraceright}b{\\textbraceleft}c');
    expect(balanceBraces('trailing}')).toBe('trailing{\\textbraceright}');
    expect(balanceBraces('{ leading')).toBe('{\\textbraceleft} leading');
    expect(balanceBraces('{')).toBe('{\\textbraceleft}');
    expect(balanceBraces('}')).toBe('{\\textbraceright}');
  });

  it('only touches the UNMATCHED braces, leaving matched groups intact', () => {
    // the `{ok}` group is balanced and must survive; only the surplus `}` is rewritten
    expect(balanceBraces('x {ok} } y')).toBe('x {ok} {\\textbraceright} y');
  });

  it('always produces brace-balanced output (the reader can never desync)', () => {
    for (const s of ['a}b{c', '}}}', '{{{', 'a{b}c}d{e', '}{']) {
      expect(isBraceBalanced(balanceBraces(s))).toBe(true);
    }
  });

  it('is idempotent (its output is balanced, so a second pass is a no-op)', () => {
    for (const s of ['a}b{c', '{', '}', 'x } y { z']) {
      const once = balanceBraces(s);
      expect(balanceBraces(once)).toBe(once);
    }
  });

  it('round-trips through detexify back to the original braces (display preserved)', () => {
    for (const s of ['a}b{c', 'trailing}', '{ leading', '{', '}', 'x}y{z']) {
      expect(detexify(balanceBraces(s))).toBe(s);
    }
  });
});

describe('detexify: literal-brace control words', () => {
  it('maps \\textbraceleft / \\textbraceright back to { / }', () => {
    expect(detexify('{\\textbraceleft}')).toBe('{');
    expect(detexify('{\\textbraceright}')).toBe('}');
    expect(detexify('a{\\textbraceright}b{\\textbraceleft}c')).toBe('a}b{c');
  });
});
