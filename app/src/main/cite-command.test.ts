import { describe, it, expect } from 'vitest';
import { parseCite, CITE_PATTERN_ANCHORED } from './cite-command.js';

describe('parseCite', () => {
  it('defaults a bare \\cite to textual', () => {
    expect(parseCite('\\cite{k}')).toMatchObject({ kind: 'textual', keys: ['k'] });
  });

  it('distinguishes the command family', () => {
    expect(parseCite('\\citet{k}')?.kind).toBe('textual');
    expect(parseCite('\\citep{k}')?.kind).toBe('parenthetical');
    expect(parseCite('\\citeauthor{k}')?.kind).toBe('author');
    expect(parseCite('\\fullcite{k}')?.kind).toBe('full');
    expect(parseCite('\\nocite{k}')?.kind).toBe('nocite');
  });

  it('reads the star (all authors)', () => {
    expect(parseCite('\\citeauthor*{k}')?.allAuthors).toBe(true);
    expect(parseCite('\\citeauthor{k}')?.allAuthors).toBe(false);
  });

  it('parses optional args on EVERY variant (one = postnote, two = pre+post)', () => {
    expect(parseCite('\\cite[p. 5]{k}')).toMatchObject({ kind: 'textual', prenote: '', postnote: 'p. 5' });
    expect(parseCite('\\cite[see][p. 5]{k}')).toMatchObject({ prenote: 'see', postnote: 'p. 5' });
    expect(parseCite('\\citet[ch. 2]{k}')).toMatchObject({ kind: 'textual', postnote: 'ch. 2' });
    expect(parseCite('\\citet[see][p. 5]{k}')).toMatchObject({ prenote: 'see', postnote: 'p. 5' });
    expect(parseCite('\\citep[p. 5]{k}')).toMatchObject({ kind: 'parenthetical', postnote: 'p. 5' });
  });

  it('splits multiple comma-separated keys', () => {
    expect(parseCite('\\citep{a, b ,c}')?.keys).toEqual(['a', 'b', 'c']);
    expect(parseCite('\\citep{a,b}')?.keyString).toBe('a,b');
  });

  it('is case-insensitive (so capitalised \\Citet matches)', () => {
    expect(parseCite('\\Citet{k}')?.kind).toBe('textual');
  });

  it('returns null for non-citation text', () => {
    expect(parseCite('not a citation')).toBeNull();
    expect(parseCite('\\citep')).toBeNull(); // no {keys}
  });

  it('the anchored pattern only matches at the start of the source', () => {
    expect(CITE_PATTERN_ANCHORED.test('\\citep{k} rest')).toBe(true);
    expect(CITE_PATTERN_ANCHORED.test('see \\citep{k}')).toBe(false);
  });
});
