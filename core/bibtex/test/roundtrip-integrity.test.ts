/**
 * Round-trip integrity regressions for the four "silent wrong parse persisted on
 * save" defects from the 2026-07-02 code audit (report 01):
 *
 *   H1  — the serializer emitted unbalanced braces verbatim, so a stored value
 *         with a stray `{`/`}` re-parsed to a DIFFERENT value (a fabricated macro
 *         node, a swallowed following field, or a dropped char).
 *   H2  — an in-entry `%` comment containing `,` / `{` / `}` / `"` desynced the
 *         field split and/or the block-boundary scan, dropping real fields.
 *   MED-1 — parseBraced dropped the last char of an unterminated brace group.
 *   MED-3 — a single missing `}` made the block scanner swallow every following
 *         entry into the broken one.
 */

import { describe, it, expect } from 'vitest';
import { parse, serialize } from '../src/index';
import { isComplex } from '@bibdesk/model';
import { detexify } from '@bibdesk/tex';

const entry = (body: string) => `@article{k,\n${body}\n}\n`;
const firstItem = (src: string) => parse(src).items[0]!;

describe('H1 — serializer balances stray braces (no silent value change on save)', () => {
  // Each of these is invalid BibTeX content that could enter the model via a user
  // typing a lone brace, a malformed import, or the macro editor.
  const cases = [
    { name: 'close-before-open', value: 'a}b{c' },
    { name: 'trailing close', value: 'trailing close}' },
    { name: 'leading open', value: 'unmatched { brace' },
    { name: 'only an open', value: '{' },
    { name: 'only a close', value: '}' },
    { name: 'nested surplus close', value: 'x {ok} } y' },
  ];

  for (const { name, value } of cases) {
    it(`round-trips a stored value with unbalanced braces (${name})`, () => {
      const lib = parse(entry('year = {2020}'));
      lib.items[0]!.setField('Title', value);
      const out = serialize(lib);

      // the emitted BibTeX is brace-balanced (would otherwise corrupt the reader)
      const braceDelta = [...out].reduce((d, c) => d + (c === '{' ? 1 : c === '}' ? -1 : 0), 0);
      expect(braceDelta).toBe(0);

      const back = parse(out).items[0]!;
      const raw = back.rawValueOfField('Title')!;
      // NOT silently turned into a complex value / fabricated macro reference
      expect(isComplex(raw)).toBe(false);
      // the untouched sibling field survives (a stray `{` used to swallow it)
      expect(back.stringValueOfField('Year', false)).toBe('2020');
      // the DISPLAYED value is preserved (control words de-texify back to braces)
      expect(detexify(back.stringValueOfField('Title', false))).toBe(value);
    });
  }

  it('is idempotent from the first save onward (parse∘serialize is a fixed point)', () => {
    const lib = parse(entry('year = {2020}'));
    lib.items[0]!.setField('Title', 'a}b{c');
    const once = serialize(lib);
    const twice = serialize(parse(once));
    expect(twice).toBe(once);
  });

  it('leaves well-formed braces (TeX accents / balanced groups) byte-identical', () => {
    const src = entry('  author = {Erd{\\"o}s, P.},\n  title = {A {Nested} Title},\n  year = {1959}');
    const out = serialize(parse(src));
    expect(out).toContain('author = {Erd{\\"o}s, P.}');
    expect(out).toContain('title = {A {Nested} Title}');
    expect(out).not.toContain('textbraceleft');
    expect(out).not.toContain('textbraceright');
  });

  it('balances an unbalanced @string macro value (reachable from the macro editor)', () => {
    const lib = parse(entry('year = {2020}'));
    lib.macroResolver.parent!.define('mymac', 'x}y{z');
    const out = serialize(lib);
    const braceDelta = [...out].reduce((d, c) => d + (c === '{' ? 1 : c === '}' ? -1 : 0), 0);
    expect(braceDelta).toBe(0);
    // the macro re-reads as a single literal string, not a fabricated concatenation
    const back = parse(out);
    const def = back.macroResolver.parent!.definitionOf('mymac')!;
    expect(isComplex(def)).toBe(false);
    expect(detexify(def as string)).toBe('x}y{z');
  });
});

describe('H2 — in-entry % comments no longer drop/corrupt real fields', () => {
  it('a comment containing a comma does not swallow the following field', () => {
    const item = firstItem(
      '@article{k,\n title = {Hello},\n % note, with a comma here\n author = {Smith}\n}\n',
    );
    expect(item.citeKey).toBe('k');
    expect(item.fieldNames().map((n) => n.toLowerCase()).sort()).toEqual(['author', 'title']);
    expect(item.stringValueOfField('Title', false)).toBe('Hello');
    expect(item.stringValueOfField('Author', false)).toBe('Smith');
  });

  it('a comment containing an open brace does not corrupt the following fields', () => {
    const item = firstItem(
      '@article{k,\n year = {2020},\n % see { note\n author = {Smith},\n title = {The Title}\n}\n',
    );
    expect(item.fieldNames().map((n) => n.toLowerCase()).sort()).toEqual(['author', 'title', 'year']);
    expect(item.stringValueOfField('Year', false)).toBe('2020');
    expect(item.stringValueOfField('Author', false)).toBe('Smith');
    expect(item.stringValueOfField('Title', false)).toBe('The Title');
  });

  it('a % INSIDE a brace value is preserved (literal, not a comment)', () => {
    const item = firstItem('@article{k,\n note = {50% off today}\n}\n');
    expect(item.stringValueOfField('Note', false)).toBe('50% off today');
  });

  it('a % inside a top-level quoted value is preserved (not a comment)', () => {
    const item = firstItem('@article{k,\n note = "50% off",\n year = {2020}\n}\n');
    expect(item.stringValueOfField('Note', false)).toBe('50% off');
    expect(item.stringValueOfField('Year', false)).toBe('2020');
  });

  // A free-text @comment / @preamble body is NOT a field list: a literal `%` in it
  // is content, not a comment. The block scanner must not apply comment-stripping to
  // these, or it eats the block's own closing brace and corrupts a well-formed file.
  it('preserves a literal % in a free @comment body (e.g. a JabRef/Zotero export)', () => {
    const src = '@comment{Coverage 95% done}\n\n@article{key,\n\ttitle = {Hello}\n}\n';
    const out = serialize(parse(src));
    expect(out).toContain('@comment{Coverage 95% done}');
    expect(out).not.toContain('Coverage 95% done}\n\n}'); // no injected stray brace
    // the following entry is intact, and the round-trip is a fixed point
    expect(out).toContain('title = {Hello}');
    expect(serialize(parse(out))).toBe(out);
  });

  it('does not swallow to EOF when a %-bearing free @comment is the LAST block', () => {
    const src = '@article{key,\n\ttitle = {Hello}\n}\n\n@comment{note 50% done}\n';
    const lib = parse(src);
    expect(lib.items.map((i) => i.citeKey)).toEqual(['key']);
    const out = serialize(lib);
    expect(out).toContain('@comment{note 50% done}');
    expect(out).toContain('title = {Hello}');
  });

  it('preserves a literal % in an @preamble body', () => {
    const src = '@preamble{"50\\% and a note"}\n\n@article{k,\n\tyear = {2020}\n}\n';
    const out = serialize(parse(src));
    expect(out).toContain('@preamble{"50\\% and a note"}');
    expect(out).toContain('year = {2020}');
  });

  it('STILL strips a real in-line % comment from a @string body (field list)', () => {
    const lib = parse('@string{ pub = {ACME} % the publisher\n }\n\n@article{k,\n\tyear={2020}\n}\n');
    // the macro is defined correctly (comment stripped, not folded into the value)
    const def = lib.macroResolver.parent!.definitionOf('pub');
    expect(def).toBe('ACME');
  });
});

describe('MED-1 — parseBraced keeps the last char of an unterminated brace group', () => {
  // Reading a malformed/truncated value must not silently drop content. Reached
  // through parse() by an entry whose last field value is missing its `}`.
  it('an unterminated final value keeps all of its content', () => {
    const item = firstItem('@article{k,\n title = {abc\n}\n');
    // the entry close `}` terminates the value; content is `abc\n` (no dropped `c`)
    expect(item.stringValueOfField('Title', false)).toContain('abc');
    expect(item.stringValueOfField('Title', false).replace(/\s/g, '')).toBe('abc');
  });
});

describe('MED-3 — a missing } no longer swallows every following entry', () => {
  it('the following entry survives when one entry is missing its close brace', () => {
    const src = '@article{a,\n title = {T1}\n\n@article{b,\n title = {T2}\n}\n';
    const items = parse(src).items;
    const keys = items.map((i) => i.citeKey).sort();
    expect(keys).toEqual(['a', 'b']);
    expect(items.find((i) => i.citeKey === 'b')!.stringValueOfField('Title', false)).toBe('T2');
    // the malformed entry a is recovered too (resync cut at the next @entry)
    expect(items.find((i) => i.citeKey === 'a')!.stringValueOfField('Title', false)).toBe('T1');
  });

  it('does not resync on an @ inside a field value (only line-start entry starts)', () => {
    const item = firstItem('@article{k,\n author = {a@b.com},\n title = {T}\n}\n');
    expect(item.stringValueOfField('Author', false)).toBe('a@b.com');
    expect(item.stringValueOfField('Title', false)).toBe('T');
  });
});
