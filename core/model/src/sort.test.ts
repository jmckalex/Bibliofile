import { describe, it, expect } from 'vitest';
import { TypeManager } from './type-manager.js';
import { createBibItem, BibItem } from './bib-item.js';
import { makeAuthor } from '@bibdesk/names';
import { compareAuthorsWithEmptyLast, compareItemsByAuthor } from './sort.js';

const tm = new TypeManager();
let n = 0;
function mk(init: Record<string, unknown>): BibItem {
  return createBibItem({ idGenerator: () => `s${n++}`, ...init }, tm);
}

describe('compareAuthorsWithEmptyLast', () => {
  it('sorts by sortableName', () => {
    const a = makeAuthor('Knuth, Donald');
    const b = makeAuthor('Lamport, Leslie');
    expect(compareAuthorsWithEmptyLast(a, b)).toBeLessThan(0);
    expect(compareAuthorsWithEmptyLast(b, a)).toBeGreaterThan(0);
  });

  it('pins empty author last', () => {
    const a = makeAuthor('Knuth, Donald');
    expect(compareAuthorsWithEmptyLast(a, undefined)).toBeLessThan(0);
    expect(compareAuthorsWithEmptyLast(undefined, a)).toBeGreaterThan(0);
    expect(compareAuthorsWithEmptyLast(undefined, undefined)).toBe(0);
  });
});

describe('compareItemsByAuthor', () => {
  it('orders items by their first author, empty last', () => {
    const items = [
      mk({ citeKey: 'c', type: 'article', fields: { Author: 'Zebra, Z.' } }),
      mk({ citeKey: 'a', type: 'article', fields: { Author: 'Apple, A.' } }),
      mk({ citeKey: 'noauth', type: 'article', fields: {} }),
      mk({ citeKey: 'b', type: 'article', fields: { Author: 'Mango, M.' } }),
    ];
    const sorted = [...items].sort((x, y) => compareItemsByAuthor(x, y));
    expect(sorted.map((i) => i.citeKey)).toEqual(['a', 'b', 'c', 'noauth']);
  });

  it('falls back to Editor when authors tie/empty', () => {
    const a = mk({ citeKey: 'a', type: 'book', fields: { Editor: 'Adams, A.' } });
    const b = mk({ citeKey: 'b', type: 'book', fields: { Editor: 'Brown, B.' } });
    expect(compareItemsByAuthor(a, b)).toBeLessThan(0);
  });
});
