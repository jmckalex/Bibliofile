/**
 * Item-level author/field sorting, building on `@bibdesk/names`
 * `compareAuthorsForSort`.
 *
 * Integration note from C2 (names): BibDesk's author sort compares the *field*
 * (Author vs Editor) first, then `sortableName`, pinning empty-author last.
 * `compareAuthorsForSort` only does the `sortableName` part, so the field and
 * empty-handling tiebreakers live here in the model layer.
 */

import { compareAuthorsForSort, type Author } from '@bibdesk/names';
import type { BibItem } from './bib-item.js';
import { FieldNames } from './bib-item.js';

/**
 * Compare two authors with BibDesk's full author-sort ordering:
 *   1. items WITH an author sort before items WITHOUT (empty pinned last);
 *   2. otherwise by `sortableName` (case-insensitive, via names package).
 *
 * `isEmptyA`/`isEmptyB` flag whether each author slot is empty (no author).
 */
export function compareAuthorsWithEmptyLast(
  a: Author | undefined,
  b: Author | undefined,
): number {
  const aEmpty = a === undefined || a.sortableName === '';
  const bEmpty = b === undefined || b.sortableName === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1; // empty last
  if (bEmpty) return -1;
  return compareAuthorsForSort(a!, b!);
}

/**
 * Compare two items by their primary person of a given field (default
 * `Author`), then fall back to the secondary `Editor` field, with empty pinned
 * last. This is the model-layer item author sort the C2 note asks for.
 */
export function compareItemsByAuthor(
  a: BibItem,
  b: BibItem,
  field: string = FieldNames.Author,
): number {
  const pa = a.peopleForField(field, true);
  const pb = b.peopleForField(field, true);
  const a0 = pa[0];
  const b0 = pb[0];
  const primary = compareAuthorsWithEmptyLast(a0, b0);
  if (primary !== 0) return primary;

  // tiebreak on editor field when authors tie/empty
  if (field !== FieldNames.Editor) {
    const ea = a.peopleForField(FieldNames.Editor, true)[0];
    const eb = b.peopleForField(FieldNames.Editor, true)[0];
    return compareAuthorsWithEmptyLast(ea, eb);
  }
  return 0;
}
