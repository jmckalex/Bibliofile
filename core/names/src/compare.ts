/**
 * Author equality, equivalence (fuzzy), and sort comparison.
 *
 * Mirrors `BibAuthor.m`:
 *   - isEqual / hash  -> based on `normalizedName` (case-insensitive)
 *   - isEquivalent    -> fuzzy: equal `fuzzyName` AND compatible first names
 *   - sortCompare     -> `sortableName` (case-insensitive)
 */
import type { Author } from './author.js';

/** Exact equality: case-insensitive `normalizedName` (BibAuthor `-isEqual:`). */
export function authorsEqual(a: Author, b: Author): boolean {
  return a.normalizedName.toLowerCase() === b.normalizedName.toLowerCase();
}

/**
 * Fuzzy equivalence for duplicate detection (BibAuthor `-isEquivalent:` with
 * `matchAuthorNamesExactly == NO`):
 *   1. `fuzzyName` (von+last, deTeXified, punctuation-stripped) must match.
 *   2. If both first names are empty -> equivalent.
 *   3. If exactly one first name is empty -> not equivalent.
 *   4. Otherwise every shared-prefix first-name token must be case-insensitively
 *      equal (so "D. E." matches "Donald E." up to the shorter list).
 */
export function authorsEquivalent(a: Author, b: Author): boolean {
  if (a.fuzzyName.toLowerCase() !== b.fuzzyName.toLowerCase()) return false;

  const aHasFirst = a.first.length > 0;
  const bHasFirst = b.first.length > 0;
  if (!aHasFirst && !bHasFirst) return true;
  if (!aHasFirst || !bHasFirst) return false;

  return firstNamesCompatible(a.firstNames, b.firstNames);
}

/**
 * Port of `__BibAuthorsHaveEqualFirstNames`: compare the first-name token lists
 * up to the length of the shorter list; each pair must be case-insensitively
 * equal. (Note: this is a *prefix* comparison of whole tokens, not initials, so
 * "Don" and "Donald" are NOT compatible — matching BibDesk.)
 */
export function firstNamesCompatible(
  a: readonly string[],
  b: readonly string[],
): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i]!.toLowerCase() !== b[i]!.toLowerCase()) return false;
  }
  return true;
}

/** Tableview sort comparison: case-insensitive `sortableName` (BibAuthor `sortCompare:`). */
export function compareAuthorsForSort(a: Author, b: Author): number {
  const x = a.sortableName;
  const y = b.sortableName;
  return x < y ? -1 : x > y ? 1 : 0;
}
