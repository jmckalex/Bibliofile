import { describe, it, expect } from 'vitest';
import { TypeManager } from './type-manager.js';
import { createBibItem, BibItem } from './bib-item.js';
import {
  itemsEqual,
  itemsEquivalent,
  equivalenceHash,
  equivalenceKey,
} from './equality.js';

const tm = new TypeManager();
let n = 0;
function mk(init: Record<string, unknown>): BibItem {
  return createBibItem({ idGenerator: () => `e${n++}`, ...init }, tm);
}

describe('itemsEqual', () => {
  it('equal items: same citeKey, type, standard fields', () => {
    const a = mk({
      citeKey: 'k1',
      type: 'article',
      fields: { Author: 'A. One', Title: 'T', Journal: 'J', Year: '2020' },
    });
    const b = mk({
      citeKey: 'k1',
      type: 'article',
      fields: { Author: 'A. One', Title: 'T', Journal: 'J', Year: '2020' },
    });
    expect(itemsEqual(a, b, tm)).toBe(true);
  });

  it('citeKey compared case-insensitively', () => {
    const a = mk({ citeKey: 'Key', type: 'misc', fields: { Title: 'T' } });
    const b = mk({ citeKey: 'KEY', type: 'misc', fields: { Title: 'T' } });
    expect(itemsEqual(a, b, tm)).toBe(true);
  });

  it('type compared case-insensitively', () => {
    const a = mk({ citeKey: 'k', type: 'Article', fields: { Title: 'T' } });
    const b = mk({ citeKey: 'k', type: 'article', fields: { Title: 'T' } });
    expect(itemsEqual(a, b, tm)).toBe(true);
  });

  it('different citeKey -> not equal', () => {
    const a = mk({ citeKey: 'k1', type: 'misc', fields: { Title: 'T' } });
    const b = mk({ citeKey: 'k2', type: 'misc', fields: { Title: 'T' } });
    expect(itemsEqual(a, b, tm)).toBe(false);
  });

  it('different field value -> not equal (case-sensitive values)', () => {
    const a = mk({
      citeKey: 'k',
      type: 'article',
      fields: { Author: 'A', Title: 'T', Journal: 'J', Year: '2020' },
    });
    const b = mk({
      citeKey: 'k',
      type: 'article',
      fields: { Author: 'A', Title: 't', Journal: 'J', Year: '2020' },
    });
    expect(itemsEqual(a, b, tm)).toBe(false);
  });

  it('crossref empty/non-empty asymmetry', () => {
    const a = mk({ citeKey: 'k', type: 'misc', fields: { Title: 'T', Crossref: 'p' } });
    const b = mk({ citeKey: 'k', type: 'misc', fields: { Title: 'T' } });
    expect(itemsEqual(a, b, tm)).toBe(false);
    const c = mk({ citeKey: 'k', type: 'misc', fields: { Title: 'T', Crossref: 'P' } });
    expect(itemsEqual(a, c, tm)).toBe(true); // crossref case-insensitive
  });
});

describe('itemsEquivalent (duplicate detection)', () => {
  it('ignores cite key', () => {
    const a = mk({
      citeKey: 'k1',
      type: 'article',
      fields: { Author: 'A. One', Title: 'T', Journal: 'J', Year: '2020' },
    });
    const b = mk({
      citeKey: 'k2',
      type: 'article',
      fields: { Author: 'A. One', Title: 'T', Journal: 'J', Year: '2020' },
    });
    expect(itemsEqual(a, b, tm)).toBe(false); // different keys
    expect(itemsEquivalent(a, b, tm)).toBe(true); // equivalent
  });

  it('uses fuzzy author equivalence by default', () => {
    // Fuzzy match: braces stripped + same first-name tokens. The names package
    // does whole-token first-name comparison, so we keep first names identical
    // and exercise the fuzzyName (von+last, brace-stripped) path that exact
    // string comparison would miss because of the braces.
    const a = mk({
      citeKey: 'a',
      type: 'article',
      fields: { Author: '{Knuth}, Donald E.', Title: 'T', Journal: 'J', Year: '2020' },
    });
    const b = mk({
      citeKey: 'b',
      type: 'article',
      fields: { Author: 'Knuth, Donald E.', Title: 'T', Journal: 'J', Year: '2020' },
    });
    // exact string compare would fail ({Knuth} != Knuth), fuzzy should pass
    expect(a.stringValueOfField('Author', false)).not.toBe(
      b.stringValueOfField('Author', false),
    );
    expect(itemsEquivalent(a, b, tm)).toBe(true);
  });

  it('exact-match mode disables fuzzy authors', () => {
    const a = mk({
      citeKey: 'a',
      type: 'article',
      fields: { Author: '{Knuth}, Donald E.', Title: 'T', Journal: 'J', Year: '2020' },
    });
    const b = mk({
      citeKey: 'b',
      type: 'article',
      fields: { Author: 'Knuth, Donald E.', Title: 'T', Journal: 'J', Year: '2020' },
    });
    expect(itemsEquivalent(a, b, tm, { matchAuthorNamesExactly: true })).toBe(false);
  });

  it('different author count -> not equivalent', () => {
    const a = mk({
      citeKey: 'a',
      type: 'article',
      fields: { Author: 'A. One', Title: 'T', Journal: 'J', Year: '2020' },
    });
    const b = mk({
      citeKey: 'b',
      type: 'article',
      fields: { Author: 'A. One and B. Two', Title: 'T', Journal: 'J', Year: '2020' },
    });
    expect(itemsEquivalent(a, b, tm)).toBe(false);
  });

  it('different type -> not equivalent', () => {
    const a = mk({ citeKey: 'a', type: 'article', fields: { Title: 'T' } });
    const b = mk({ citeKey: 'b', type: 'book', fields: { Title: 'T' } });
    expect(itemsEquivalent(a, b, tm)).toBe(false);
  });
});

describe('equivalenceHash / equivalenceKey', () => {
  it('is stable for the same content', () => {
    const a = mk({
      citeKey: 'a',
      type: 'article',
      fields: { Author: 'A', Title: 'T', Journal: 'J', Year: '2020' },
    });
    const b = mk({
      citeKey: 'b', // different key — hash ignores it
      type: 'article',
      fields: { Author: 'A', Title: 'T', Journal: 'J', Year: '2020' },
    });
    expect(equivalenceHash(a, tm)).toBe(equivalenceHash(b, tm));
    expect(equivalenceKey(a, tm)).toBe(equivalenceKey(b, tm));
  });

  it('differs when a standard field differs', () => {
    const a = mk({
      citeKey: 'a',
      type: 'article',
      fields: { Author: 'A', Title: 'T1', Journal: 'J', Year: '2020' },
    });
    const b = mk({
      citeKey: 'a',
      type: 'article',
      fields: { Author: 'A', Title: 'T2', Journal: 'J', Year: '2020' },
    });
    expect(equivalenceHash(a, tm)).not.toBe(equivalenceHash(b, tm));
  });

  it('returns an unsigned 32-bit integer', () => {
    const a = mk({ citeKey: 'a', type: 'article', fields: { Title: 'T' } });
    const h = equivalenceHash(a, tm);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it('can dedup via a Map keyed by equivalenceKey', () => {
    const items = [
      mk({ citeKey: 'a', type: 'article', fields: { Author: 'A', Title: 'T', Journal: 'J', Year: '2020' } }),
      mk({ citeKey: 'b', type: 'article', fields: { Author: 'A', Title: 'T', Journal: 'J', Year: '2020' } }),
      mk({ citeKey: 'c', type: 'article', fields: { Author: 'A', Title: 'Different', Journal: 'J', Year: '2020' } }),
    ];
    const byKey = new Map<string, BibItem>();
    for (const it of items) byKey.set(equivalenceKey(it, tm), it);
    expect(byKey.size).toBe(2); // a & b collapse
  });
});
