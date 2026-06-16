/**
 * Port of `-[BibItem groupsForField:]` (BibItem.m:3389) + `groupArrayForField:`
 * (BibItem.m) — the multi-value split that powers category groups and the
 * GroupContain / GroupNotContain smart-group operators.
 *
 * For a person field the values are {@link Author} objects compared with FUZZY
 * equivalence (the hash table uses `equivalencePointerFunctions` →
 * `-[BibAuthor isEquivalent:]`, NSPointerFunctions_BDSKExtensions.m:103). For
 * other fields the values are strings compared case-insensitively
 * (`-[BibAuthor isEqual:]` is not involved; string membership uses NSString
 * equality, but category-group names are matched case-sensitively in BibDesk —
 * we replicate exact string equality, see {@link fieldContainsStringValue}).
 *
 * Single-valued group fields (Title, Journal, …) are taken whole; everything
 * else is split on the group-field separator characters `;:,` (default
 * `BDSKGroupFieldSeparatorCharactersKey`), falling back to ` and ` separation
 * when none of those characters is present (`componentsSeparatedByAnd`).
 */

/** Structural view of the `BibItem` accessors this module needs. */
export interface GroupFieldItem {
  stringValueOfField(field: string, inherit?: boolean): string;
  peopleForField(field: string, inherit?: boolean): readonly Author[];
  readonly typeManager: GroupFieldClassifier;
}

/** Structural view of the field classifier this module needs. */
export interface GroupFieldClassifier {
  isPersonField(field: string): boolean;
  isSingleValuedGroupField(field: string): boolean;
}

/**
 * Structural `Author` shape (a subset of `@bibdesk/names`' `Author`). We only
 * need the fields involved in fuzzy equivalence (`isEquivalent:`): `fuzzyName`,
 * `first`, and `firstNames`. The full object returned by `BibItem.authors()`
 * satisfies this.
 */
export interface Author {
  readonly originalName: string;
  readonly first: string;
  readonly fuzzyName: string;
  readonly firstNames: readonly string[];
}

/**
 * Port of `-[BibAuthor isEquivalent:]` (BibAuthor.m:193 / compare.ts
 * `authorsEquivalent`): equal `fuzzyName` AND compatible first names. This is
 * the equality used by category-group person membership and by the
 * GroupContain operator on person fields.
 */
export function authorsEquivalent(a: Author, b: Author): boolean {
  if (a.fuzzyName.toLowerCase() !== b.fuzzyName.toLowerCase()) return false;
  const aHas = a.first.length > 0;
  const bHas = b.first.length > 0;
  if (!aHas && !bHas) return true;
  if (!aHas || !bHas) return false;
  const n = Math.min(a.firstNames.length, b.firstNames.length);
  for (let i = 0; i < n; i++) {
    if (a.firstNames[i]!.toLowerCase() !== b.firstNames[i]!.toLowerCase()) return false;
  }
  return true;
}

/** Default group-field separator characters (`BDSKGroupFieldSeparatorCharactersKey` = ";:,"). */
export const DEFAULT_GROUP_FIELD_SEPARATORS = ';:,';

/**
 * Split a raw field string into its constituent group values (non-person path),
 * matching `groupArrayForField:`: split on any separator character (trimming
 * whitespace, dropping empties), or fall back to ` and ` separation when none
 * of the separator characters is present.
 */
export function splitGroupFieldValue(
  value: string,
  separators = DEFAULT_GROUP_FIELD_SEPARATORS,
): string[] {
  const trimmed = value.trim();
  if (trimmed === '') return [];
  const hasSep = [...trimmed].some((c) => separators.includes(c));
  let parts: string[];
  if (hasSep) {
    const sepClass = `[${separators.replace(/[-\\\]^]/g, '\\$&')}]`;
    parts = trimmed.split(new RegExp(sepClass));
  } else {
    // componentsSeparatedByAnd: split on the BibTeX " and " conjunction.
    parts = trimmed.split(/\s+and\s+/i);
  }
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * The distinct group values for `field` on `item`. Returns `Author[]` for
 * person fields, `string[]` otherwise. Single-valued group fields return the
 * whole expanded value as a single element. Empty → `[]`.
 *
 * (BibDesk's hash table dedups with author equivalence; we keep the raw array
 * — membership tests below apply the right equality, and category counts use a
 * separate dedup at the document level which is out of this read-only scope.)
 */
export function groupValuesForField(
  item: GroupFieldItem,
  field: string,
  separators = DEFAULT_GROUP_FIELD_SEPARATORS,
): string[] | Author[] {
  const tm = item.typeManager;
  if (tm.isPersonField(field)) {
    return [...item.peopleForField(field, true)] as Author[];
  }
  const value = item.stringValueOfField(field, true).trim();
  if (value === '') return [];
  if (tm.isSingleValuedGroupField(field)) return [value];
  return splitGroupFieldValue(value, separators);
}

/**
 * Does `item` have category value `name` in `field`? Person fields use fuzzy
 * author equivalence; other fields use exact string equality (matching
 * `-[NSHashTable containsObject:]` with NSString equality, which is
 * case-sensitive — category-group names preserve case).
 */
export function fieldContainsCategory(
  item: GroupFieldItem,
  field: string,
  name: string | Author,
): boolean {
  const values = groupValuesForField(item, field);
  if (item.typeManager.isPersonField(field)) {
    const target =
      typeof name === 'string' ? undefined : (name as Author);
    if (target === undefined) {
      // A string name against a person field: compare against originalName.
      return (values as Author[]).some((a) => a.originalName === name);
    }
    return (values as Author[]).some((a) => authorsEquivalent(a, target));
  }
  const target = typeof name === 'string' ? name : (name as Author).originalName;
  return (values as string[]).some((v) => v === target);
}

/** True iff `item` has no group value for `field` (the BDSKEmptyGroup test). */
export function fieldIsEmptyForGroups(item: GroupFieldItem, field: string): boolean {
  return groupValuesForField(item, field).length === 0;
}

/**
 * GroupContain/GroupNotContain helper (`-[BDSKCondition item:isContainedInGroupForField:]`,
 * BDSKCondition.m:605-613): the condition's string value is matched against the
 * item's group values for `field`; for person fields the value is parsed as an
 * author and compared with fuzzy equivalence.
 */
export function itemContainedInGroupForField(
  item: GroupFieldItem,
  field: string,
  stringValue: string,
  makeAuthor: (name: string) => Author,
): boolean {
  if (item.typeManager.isPersonField(field)) {
    const authorVal = makeAuthor(stringValue);
    const values = groupValuesForField(item, field) as Author[];
    return values.some((a) => authorsEquivalent(a, authorVal));
  }
  const values = groupValuesForField(item, field) as string[];
  return values.some((v) => v === stringValue);
}
