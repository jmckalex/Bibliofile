/**
 * Split an author/editor field into individual name strings.
 *
 * BibTeX joins names with ` and ` (space-AND-space). This is brace-aware: an
 * ` and ` inside a `{...}` group does not split (so `{Barnes and Noble, Inc.}`
 * stays one name). The trailing `and others` is represented by the
 * {@link OTHERS} sentinel.
 *
 * Matches btparse `bt_split_list` + BibDesk `__BDSKArrayOfNames` semantics.
 */
import { collapseWhitespace, splitTopLevelDelimited } from './brace.js';

/**
 * Sentinel returned in place of the literal `others` token (from `... and others`).
 * BibTeX uses bare `others` to mean "et al."; callers can test
 * `name === OTHERS`.
 */
export const OTHERS = 'others' as const;

/**
 * Split a person field on top-level ` and `. Empty pieces (e.g. from `X and and Y`)
 * are dropped. A bare `others` piece becomes the {@link OTHERS} sentinel.
 *
 * Whitespace is collapsed first (newlines removed, runs squeezed) exactly as
 * BibDesk does before name handling. If braces are unbalanced the field is
 * returned as a single (collapsed) element — a lenient fallback that keeps the
 * caller working rather than dropping data (BibDesk surfaces an error and
 * returns empty; we prefer not to silently lose the name).
 */
export function splitNameList(field: string): string[] {
  const collapsed = collapseWhitespace(field);
  if (collapsed.length === 0) return [];

  const pieces = splitTopLevelDelimited(collapsed, 'and');
  if (pieces === null) {
    // Unbalanced braces: treat the whole field as one name.
    return [collapsed];
  }

  const out: string[] = [];
  for (const raw of pieces) {
    const piece = raw.trim();
    if (piece.length === 0) continue; // drop empty elements ("and and")
    out.push(piece.toLowerCase() === OTHERS ? OTHERS : piece);
  }
  return out;
}

/** True if the given list ends with the `others` sentinel (`... and others`). */
export function hasOthers(names: readonly string[]): boolean {
  return names.length > 0 && names[names.length - 1] === OTHERS;
}
