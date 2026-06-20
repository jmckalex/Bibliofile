/**
 * Regression: a `"` inside a brace group must be treated as a literal character,
 * not a string delimiter (BibTeX only treats `"` as a delimiter at brace depth
 * 0). The field/segment splitters previously opened "quote mode" on ANY `"`, so
 * a TeX accent like `{\"o}` started a phantom string that ran to end-of-entry —
 * collapsing every field after it into one `#`-concatenated value and producing
 * empty bibliography entries. (See computational-philosophy-merged-with-pdfs.bib:
 * Erdős/Rényi, Grüne-Yanoff, Björnerstedt, … all rendered blank.)
 */

import { describe, it, expect } from 'vitest';
import { parse, serialize } from '../src/index';

const entry = (body: string) => `@article{k,\n${body}\n}\n`;

describe('nested braces / quotes-inside-braces (field splitting)', () => {
  it('does not collapse fields after a TeX accent ({\\"o}) into one value', () => {
    const src = entry(
      '  author = {Erd{\\"o}s, P., R{\\\'e}nyi, A.},\n  title = {On random graphs I},\n  year = {1959}',
    );
    const out = serialize(parse(src));
    expect(out).not.toContain(' # , # '); // the corruption signature
    expect(out).toContain('author = {Erd{\\"o}s, P., R{\\\'e}nyi, A.}');
    expect(out).toContain('title = {On random graphs I}');
    expect(out).toContain('year = {1959}');
  });

  it('keeps the parse into discrete fields (3 fields, not 1)', () => {
    const lib = parse(
      entry('  author = {M{\\"u}ller, A.},\n  journal = {J},\n  year = {2020}'),
    );
    const item = lib.items[0]!;
    expect(item.fieldNames().map((n) => n.toLowerCase()).sort()).toEqual([
      'author',
      'journal',
      'year',
    ]);
  });

  it('is idempotent across repeated round-trips', () => {
    const src = entry('  author = {Gr{\\"u}ne-Yanoff, Till},\n  year = {2009}');
    const once = serialize(parse(src));
    const twice = serialize(parse(once));
    expect(twice).toBe(once);
    expect(once).not.toContain(' # , # ');
  });

  it('still honours a genuine quote-delimited value', () => {
    const lib = parse(entry('  author = "Smith, J.",\n  year = {2020}'));
    const item = lib.items[0]!;
    expect(item.stringValueOfField('Author', false)).toBe('Smith, J.');
    expect(item.stringValueOfField('Year', false)).toBe('2020');
  });

  it('treats a " inside braces as literal, inside a quoted value', () => {
    // value is the quoted string `a {"x"} b` — the inner quotes are literal.
    const lib = parse(entry('  title = "a {"x"} b",\n  year = {2020}'));
    const item = lib.items[0]!;
    expect(item.stringValueOfField('Year', false)).toBe('2020'); // year not swallowed
  });
});
