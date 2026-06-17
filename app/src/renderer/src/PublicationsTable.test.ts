import { describe, expect, it } from 'vitest';

import { reorderColumns } from './PublicationsTable';

const COLS = ['citeKey', 'type', 'authors', 'title', 'year'];

describe('reorderColumns (header drag-and-drop)', () => {
  it('moves a column to sit immediately before the drop target', () => {
    // drag "year" onto "type" → year lands before type
    expect(reorderColumns(COLS, 'year', 'type')).toEqual([
      'citeKey',
      'year',
      'type',
      'authors',
      'title',
    ]);
  });

  it('moves a column rightward, before the target', () => {
    // drag "citeKey" onto "title" → citeKey lands before title
    expect(reorderColumns(COLS, 'citeKey', 'title')).toEqual([
      'type',
      'authors',
      'citeKey',
      'title',
      'year',
    ]);
  });

  it('is a no-op when dragged onto itself', () => {
    expect(reorderColumns(COLS, 'authors', 'authors')).toEqual(COLS);
  });

  it('returns an unchanged copy for unknown ids', () => {
    expect(reorderColumns(COLS, 'nope', 'title')).toEqual(COLS);
    expect(reorderColumns(COLS, 'year', 'nope')).toEqual(COLS);
  });

  it('does not mutate the input array', () => {
    const input = [...COLS];
    reorderColumns(input, 'year', 'type');
    expect(input).toEqual(COLS);
  });
});
