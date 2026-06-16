/**
 * @bibdesk/names
 *
 * BibTeX name handling, platform-agnostic:
 *   - `splitNameList` — split a person field on top-level ` and ` (brace-aware),
 *     with `others` -> {@link OTHERS} sentinel.
 *   - `parseName` — split a single name into first/von/last/jr per the classic
 *     BibTeX/Patashnik (btparse) algorithm.
 *   - `makeAuthor` — build an {@link Author} value object with all the display
 *     variants BibDesk's `BibAuthor` exposes (name, normalizedName, sortableName,
 *     abbreviatedName, displayName, fuzzyName, firstNames, ...).
 *   - `parseAuthorField` — convenience: field string -> Author[] (+ trailing
 *     `others` flag).
 *   - equality / fuzzy-equivalence / sort comparators.
 *
 * De-TeXification (for sortable/fuzzy/display variants and accented initials)
 * goes through `@bibdesk/tex`'s `detexify` via {@link detexify}.
 */
export { splitNameList, hasOthers, OTHERS } from './splitList.js';
export { parseName, type ParsedName } from './parseName.js';
export { makeAuthor, type Author } from './author.js';
export {
  authorsEqual,
  authorsEquivalent,
  firstNamesCompatible,
  compareAuthorsForSort,
} from './compare.js';
export { detexify, usingRealDetexify } from './tex.js';

import { splitNameList, OTHERS } from './splitList.js';
import { makeAuthor, type Author } from './author.js';

/** Result of parsing a full person field into authors. */
export interface ParsedAuthorField {
  /** Concrete authors (excludes the `others` sentinel). */
  readonly authors: readonly Author[];
  /** True when the field ended with `and others` (BibTeX "et al."). */
  readonly hasOthers: boolean;
}

/**
 * Parse a complete Author/Editor field into {@link Author} objects. The ` and `
 * split is brace-aware; a trailing `others` becomes {@link ParsedAuthorField.hasOthers}
 * rather than an author.
 */
export function parseAuthorField(field: string): ParsedAuthorField {
  const names = splitNameList(field);
  const authors: Author[] = [];
  let othersFlag = false;
  for (const n of names) {
    if (n === OTHERS) {
      othersFlag = true;
      continue;
    }
    authors.push(makeAuthor(n));
  }
  return { authors, hasOthers: othersFlag };
}
