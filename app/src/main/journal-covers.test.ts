import { describe, expect, it } from 'vitest';

import { buildCoverIndex, resolveCover } from './journal-covers';

const MANIFEST = [
  { issnL: '0028-0836', file: 'nature.jpg', kind: 'og:image' },
  { issnL: '0031-8248', file: 'phil-sci.png', kind: 'twitter:image' },
];
const RECORDS = [
  { name: 'Nature', issnL: '0028-0836', issn: ['0028-0836', '1476-4687'] },
  { name: 'The Philosophy of Science', issnL: '0031-8248', issn: ['0031-8248'] },
  { name: 'No Cover Here', issnL: '1111-2222', issn: ['1111-2222'] },
];

describe('resolveCover', () => {
  const idx = buildCoverIndex(MANIFEST, RECORDS);

  it('resolves by ISSN-L (canonical form, hyphen-insensitive)', () => {
    expect(resolveCover(idx, '0028-0836', '')?.file).toBe('nature.jpg');
    expect(resolveCover(idx, '00280836', '')?.file).toBe('nature.jpg');
  });

  it('resolves by an alternate (electronic) ISSN that maps to the ISSN-L', () => {
    expect(resolveCover(idx, '1476-4687', '')?.file).toBe('nature.jpg');
  });

  it('resolves by journal name when no ISSN is given (drops leading "the")', () => {
    expect(resolveCover(idx, '', 'Philosophy of Science')?.file).toBe('phil-sci.png');
    expect(resolveCover(idx, '', 'The Philosophy of Science')?.file).toBe('phil-sci.png');
  });

  it('carries the cover kind through (real art vs logo)', () => {
    expect(resolveCover(idx, '0028-0836', '')?.kind).toBe('og:image');
  });

  it('returns null when a known journal has no downloaded cover', () => {
    expect(resolveCover(idx, '1111-2222', 'No Cover Here')).toBeNull();
  });

  it('returns null for an unknown ISSN and unknown name', () => {
    expect(resolveCover(idx, '9999-9999', 'Unheard Of Quarterly')).toBeNull();
    expect(resolveCover(idx, '', '')).toBeNull();
  });
});

describe('resolveCover with name-keyed (Wikipedia) covers', () => {
  const idx = buildCoverIndex(MANIFEST, RECORDS, [
    { name: 'Synthese', file: 'wiki-synthese.jpg', kind: 'wikipedia' },
    { name: 'Erkenntnis', file: 'wiki-erkenntnis.png', kind: 'wikipedia', issn: '0165-0106' },
  ]);

  it('resolves a journal with no ISSN directly by name', () => {
    const hit = resolveCover(idx, '', 'Synthese');
    expect(hit?.file).toBe('wiki-synthese.jpg');
    expect(hit?.kind).toBe('wikipedia');
  });

  it('also registers a name-keyed cover under its ISSN', () => {
    expect(resolveCover(idx, '0165-0106', '')?.file).toBe('wiki-erkenntnis.png');
  });

  it('still prefers a curated ISSN-matched cover over a name fallback', () => {
    // Biology & Philosophy has a real ISSN cover; a name match must not override it.
    expect(resolveCover(idx, '0028-0836', 'Synthese')?.file).toBe('nature.jpg');
  });
});
