import { describe, it, expect } from 'vitest';
import { FtsIndex, toMatchQuery } from './fts.js';

describe('toMatchQuery', () => {
  it('builds a prefix-AND FTS5 match expression', () => {
    expect(toMatchQuery('brown fox')).toBe('"brown"* "fox"*');
    expect(toMatchQuery('  Quick  ')).toBe('"quick"*');
    expect(toMatchQuery('')).toBe('');
    expect(toMatchQuery('   ')).toBe('');
    expect(toMatchQuery('a*(b)c')).toBe('"abc"*'); // operators stripped
  });

  it('turns a double-quoted run into an exact FTS5 phrase (no prefix)', () => {
    expect(toMatchQuery('"brown fox"')).toBe('"brown fox"');
    // phrase + trailing bare word: phrase exact, word prefix-matched
    expect(toMatchQuery('"machine learning" neural')).toBe('"machine learning" "neural"*');
    // leading bare word + phrase
    expect(toMatchQuery('survey "game theory"')).toBe('"survey"* "game theory"');
  });

  it('handles an unterminated quote as a phrase to end-of-input', () => {
    expect(toMatchQuery('"brown fox')).toBe('"brown fox"');
  });
});

const idx = new FtsIndex();

describe.runIf(idx.available)('FtsIndex (better-sqlite3 / FTS5)', () => {
  it('indexes and searches by ranked relevance', () => {
    const fts = new FtsIndex();
    fts.rebuild([
      { id: 'a', text: 'evolution of bargaining game theory' },
      { id: 'b', text: 'quantum mechanics principles dirac' },
      { id: 'c', text: 'bargaining solutions and fairness' },
    ]);
    const hits = fts.search('bargaining');
    expect(hits.sort()).toEqual(['a', 'c']);
    expect(fts.search('dirac')).toEqual(['b']);
    expect(fts.search('nonexistentword')).toEqual([]);
    // prefix matching
    expect(fts.search('barg').sort()).toEqual(['a', 'c']);
    // multi-term AND
    expect(fts.search('bargaining fairness')).toEqual(['c']);
    fts.close();
  });

  it('quoted phrases require adjacent words in order', () => {
    const fts = new FtsIndex();
    fts.rebuild([
      { id: 'a', text: 'the theory of games and bargaining' },
      { id: 'b', text: 'evolutionary game theory and dynamics' },
    ]);
    // both contain "game" and "theory" as words → bare AND matches both
    expect(fts.search('game theory').sort()).toEqual(['a', 'b']);
    // only b has the contiguous phrase "game theory" (a has "theory ... games")
    expect(fts.search('"game theory"')).toEqual(['b']);
    fts.close();
  });

  it('upsert and remove update the index', () => {
    const fts = new FtsIndex();
    fts.rebuild([{ id: 'x', text: 'alpha beta' }]);
    expect(fts.search('alpha')).toEqual(['x']);
    fts.upsert('x', 'gamma delta');
    expect(fts.search('alpha')).toEqual([]);
    expect(fts.search('gamma')).toEqual(['x']);
    fts.remove('x');
    expect(fts.search('gamma')).toEqual([]);
    fts.close();
  });
});

if (!idx.available) {
  // eslint-disable-next-line no-console
  console.log('[fts.test] better-sqlite3 unavailable for this runtime ABI — FTS tests skipped');
}
idx.close();
