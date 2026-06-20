import { describe, expect, it } from 'vitest';
import type { PublicationRow } from '@bibdesk/shared';

import { reorderColumns, rowSortText, nextTypeMatch } from './PublicationsTable';

const COLS = ['citeKey', 'type', 'authors', 'title', 'year'];

/** Minimal row factory for the type-select tests (only the fields it reads). */
function row(p: Partial<PublicationRow> & { id: string }): PublicationRow {
  return {
    id: p.id,
    citeKey: p.citeKey ?? p.id,
    type: p.type ?? 'article',
    authorsDisplay: p.authorsDisplay ?? '',
    title: p.title ?? '',
    year: p.year ?? '',
    read: 0,
    rating: 0,
    hasKeywords: false,
    attachmentCount: 0,
    extra: p.extra,
  } as PublicationRow;
}

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

describe('rowSortText (type-select column text)', () => {
  it('maps the active sort key to the right row field', () => {
    const r = row({
      id: 'x',
      citeKey: 'smith2020',
      type: 'book',
      authorsDisplay: 'Smith, J.',
      title: 'On Justice',
      year: '2020',
    });
    expect(rowSortText(r, 'citeKey')).toBe('smith2020');
    expect(rowSortText(r, 'type')).toBe('book');
    expect(rowSortText(r, 'authors')).toBe('Smith, J.');
    expect(rowSortText(r, 'title')).toBe('On Justice');
    expect(rowSortText(r, 'year')).toBe('2020');
  });

  it('falls back to title for an unknown key / no sort, and reads extra fields', () => {
    const r = row({ id: 'x', title: 'On Justice', extra: { journal: 'Mind' } });
    expect(rowSortText(r, undefined)).toBe('On Justice');
    expect(rowSortText(r, 'publisher')).toBe('On Justice'); // unknown & not in extra
    expect(rowSortText(r, 'journal')).toBe('Mind'); // arbitrary field column
  });
});

describe('nextTypeMatch (type-select search)', () => {
  const rows = [
    row({ id: 'a', title: 'Apple' }),
    row({ id: 'b', title: 'Banana' }),
    row({ id: 'c', title: 'Apricot' }),
    row({ id: 'd', title: 'Cherry' }),
  ];

  it('finds the first match forward from the start index', () => {
    expect(nextTypeMatch(rows, 0, 'a', 'title')).toBe(0); // Apple
    expect(nextTypeMatch(rows, 0, 'ap', 'title')).toBe(0); // Apple
    expect(nextTypeMatch(rows, 0, 'b', 'title')).toBe(1); // Banana
  });

  it('cycles forward on a repeated letter (start past current)', () => {
    // on Apple (0): pressing "a" again starts at 1 → next "A…" is Apricot (2)
    expect(nextTypeMatch(rows, 1, 'a', 'title')).toBe(2);
    // pressing "a" again from 3 wraps back to Apple (0)
    expect(nextTypeMatch(rows, 3, 'a', 'title')).toBe(0);
  });

  it('refines on a growing buffer from the current row', () => {
    // on Apple (0), buffer "apr" re-checks from 0 → Apricot (2)
    expect(nextTypeMatch(rows, 0, 'apr', 'title')).toBe(2);
  });

  it('returns -1 when nothing matches or the needle is empty', () => {
    expect(nextTypeMatch(rows, 0, 'z', 'title')).toBe(-1);
    expect(nextTypeMatch(rows, 0, '', 'title')).toBe(-1);
    expect(nextTypeMatch([], 0, 'a', 'title')).toBe(-1);
  });

  it('normalises an out-of-range / negative start index', () => {
    expect(nextTypeMatch(rows, -1, 'c', 'title')).toBe(3); // Cherry
    expect(nextTypeMatch(rows, 10, 'b', 'title')).toBe(1); // wraps → Banana
  });
});
