import { describe, it, expect } from 'vitest';
import { parseSearchQuery, searchTokensMatch } from './search.js';

describe('parseSearchQuery', () => {
  it('returns no tokens for blank input', () => {
    expect(parseSearchQuery('')).toEqual([]);
    expect(parseSearchQuery('   ')).toEqual([]);
  });

  it('splits bare words into single-word, non-phrase tokens', () => {
    expect(parseSearchQuery('Brown  FOX')).toEqual([
      { words: ['brown'], phrase: false },
      { words: ['fox'], phrase: false },
    ]);
  });

  it('treats a double-quoted run as one phrase token', () => {
    expect(parseSearchQuery('"game theory"')).toEqual([
      { words: ['game', 'theory'], phrase: true },
    ]);
  });

  it('mixes bare words and phrases', () => {
    expect(parseSearchQuery('survey "machine learning" 2020')).toEqual([
      { words: ['survey'], phrase: false },
      { words: ['machine', 'learning'], phrase: true },
      { words: ['2020'], phrase: false },
    ]);
  });

  it('treats an unterminated quote as a phrase running to end of input', () => {
    expect(parseSearchQuery('"brown fox')).toEqual([{ words: ['brown', 'fox'], phrase: true }]);
  });

  it('strips FTS5 operator characters and drops empty tokens', () => {
    expect(parseSearchQuery('a*(b)c')).toEqual([{ words: ['abc'], phrase: false }]);
    expect(parseSearchQuery('""')).toEqual([]);
    expect(parseSearchQuery('"  "')).toEqual([]);
  });
});

describe('searchTokensMatch', () => {
  const text = 'Knuth The Art of Computer Programming 1968';
  it('matches everything for an empty query', () => {
    expect(searchTokensMatch(text, parseSearchQuery(''))).toBe(true);
  });
  it('requires every bare word (AND), order-independent', () => {
    expect(searchTokensMatch(text, parseSearchQuery('programming knuth'))).toBe(true);
    expect(searchTokensMatch(text, parseSearchQuery('programming missing'))).toBe(false);
  });
  it('requires a phrase to appear contiguously', () => {
    expect(searchTokensMatch(text, parseSearchQuery('"computer programming"'))).toBe(true);
    expect(searchTokensMatch(text, parseSearchQuery('"programming computer"'))).toBe(false);
  });
});
