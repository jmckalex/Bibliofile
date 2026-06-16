/**
 * Equality, equivalence (duplicate detection), and a stable equivalence hash for
 * {@link BibItem}. Ports `BibItem.m` `isEqualToItem:` / `isEquivalent:` /
 * `equivalenceHash`.
 *
 * Field-gathering rule (all three, matching BibDesk):
 *   keys = requiredFieldsForType(type) ∪ optionalFieldsForType(type)
 *   if the type is unknown (no required/optional), fall back to the union of
 *   both items' field names, minus `Bdsk-Color` (and minus `Local-Url`).
 *   `equals`/`isEquivalent` additionally add the user-default fields.
 *   `Local-Url` is always removed.
 *
 * Field VALUES are compared with the *string-expanded* value (BibDesk compares
 * `stringValueOfField:inherit:NO`), case-sensitively. citeKey and type are
 * compared case-insensitively. Crossref is compared case-insensitively with the
 * empty/non-empty asymmetry BibDesk uses.
 */

import type { BibItem } from './bib-item.js';
import type { TypeManager } from './type-manager.js';
import { authorsEquivalent, type Author } from '@bibdesk/names';

const COLOR_FIELD = 'bdsk-color';
const LOCAL_URL_FIELD = 'local-url';
const CROSSREF_FIELD = 'Crossref';

/**
 * Gather the lowercased field-name set used for comparison/hash.
 *
 * @param includeUserDefaults add the TypeManager user-default fields (equals/equivalent do; hash does not).
 * @param removeColor remove `Bdsk-Color` from the unknown-type fallback (equals/equivalent do this only in the unknown branch).
 */
function gatherKeys(
  a: BibItem,
  b: BibItem | undefined,
  tm: TypeManager,
  includeUserDefaults: boolean,
): Set<string> {
  const keys = new Set<string>();
  for (const f of tm.requiredFieldsForType(a.type)) keys.add(f.toLowerCase());
  for (const f of tm.optionalFieldsForType(a.type)) keys.add(f.toLowerCase());

  if (keys.size === 0) {
    // unknown type: compare all field names from both items
    for (const f of a.fieldNames()) keys.add(f.toLowerCase());
    if (b) for (const f of b.fieldNames()) keys.add(f.toLowerCase());
    keys.delete(COLOR_FIELD);
  }

  if (includeUserDefaults) {
    for (const f of tm.userDefaultFields()) keys.add(f.toLowerCase());
  }

  // Local-Url is always excluded (paths/base64 are environment-specific).
  keys.delete(LOCAL_URL_FIELD);
  return keys;
}

function fieldStringsEqual(a: BibItem, b: BibItem, lowerKey: string): boolean {
  // stringValueOfField is case-insensitive on the name; pass the lowercased key.
  return a.stringValueOfField(lowerKey, false) === b.stringValueOfField(lowerKey, false);
}

function crossrefEqual(a: BibItem, b: BibItem): boolean {
  const x = a.stringValueOfField(CROSSREF_FIELD, false);
  const y = b.stringValueOfField(CROSSREF_FIELD, false);
  const xe = x.trim() === '';
  const ye = y.trim() === '';
  if (xe) return ye;
  if (ye) return false;
  return x.toLowerCase() === y.toLowerCase();
}

/**
 * `isEqualToItem:` — same cite key (case-insensitive) + same type
 * (case-insensitive) + identical standard/user-default field strings + matching
 * crossref. Returns false on the first mismatch.
 */
export function itemsEqual(a: BibItem, b: BibItem, tm: TypeManager): boolean {
  if (a === b) return true;
  if (a.citeKey.toLowerCase() !== b.citeKey.toLowerCase()) return false;
  if (a.type.toLowerCase() !== b.type.toLowerCase()) return false;

  const keys = gatherKeys(a, b, tm, true);
  for (const k of keys) {
    if (!fieldStringsEqual(a, b, k)) return false;
  }
  return crossrefEqual(a, b);
}

/**
 * `isEquivalent:` — like {@link itemsEqual} but ignoring the cite key (used for
 * duplicate detection). Same type, same standard/user-default field strings,
 * matching crossref.
 *
 * Optionally upgrade person-field comparison to author *fuzzy-equivalence* via
 * `@bibdesk/names` (default ON, mirroring BibDesk's duplicate detection with
 * `matchAuthorNamesExactly == NO`). Set `matchAuthorNamesExactly` to use exact
 * string comparison for person fields too (the preferences hook left for C2).
 */
export function itemsEquivalent(
  a: BibItem,
  b: BibItem,
  tm: TypeManager,
  options: { matchAuthorNamesExactly?: boolean } = {},
): boolean {
  if (a === b) return true;
  if (a.type.toLowerCase() !== b.type.toLowerCase()) return false;

  const matchExactly = options.matchAuthorNamesExactly ?? false;
  const keys = gatherKeys(a, b, tm, true);
  for (const k of keys) {
    if (!matchExactly && tm.isPersonField(k)) {
      if (!personFieldsEquivalent(a, b, k)) return false;
    } else if (!fieldStringsEqual(a, b, k)) {
      return false;
    }
  }
  return crossrefEqual(a, b);
}

/**
 * Compare a person field by author fuzzy-equivalence: same number of authors and
 * each pair {@link authorsEquivalent}. Falls back to exact string equality if
 * the counts differ. (Only the fuzzy path exists in `@bibdesk/names` today; an
 * exact-match mode is wired in {@link itemsEquivalent} via the option.)
 */
function personFieldsEquivalent(a: BibItem, b: BibItem, lowerKey: string): boolean {
  const aa: readonly Author[] = a.peopleForField(lowerKey, false);
  const bb: readonly Author[] = b.peopleForField(lowerKey, false);
  if (aa.length !== bb.length) {
    // different author counts can't be fuzzy-equal; cheap string compare too
    return a.stringValueOfField(lowerKey, false) === b.stringValueOfField(lowerKey, false);
  }
  for (let i = 0; i < aa.length; i++) {
    if (!authorsEquivalent(aa[i]!, bb[i]!)) return false;
  }
  return true;
}

/**
 * `equivalenceHash` — stable prime-31 hash over the required ∪ optional fields
 * (NO user-default fields, `Local-Url` excluded), consistent with
 * {@link itemsEquivalent} for the exact-match case. Returns a 32-bit unsigned
 * integer.
 *
 * Algorithm (mirrors BibItem.m): `hash = ciHash(type)`, then for each field (in
 * a deterministic sorted order so the result is stable): `factor *= 31;
 * hash += factor * ci/strHash(fieldValue)`.
 */
export function equivalenceHash(item: BibItem, tm: TypeManager): number {
  const type = item.type ?? '';
  let hash = caseInsensitiveStringHash(type) >>> 0;
  let factor = 1;

  // required ∪ optional, no user defaults, Local-Url removed; sorted for stability
  const keys = new Set<string>();
  for (const f of tm.requiredFieldsForType(type)) keys.add(f.toLowerCase());
  for (const f of tm.optionalFieldsForType(type)) keys.add(f.toLowerCase());
  keys.delete(LOCAL_URL_FIELD);
  const sorted = [...keys].sort();

  for (const k of sorted) {
    factor = Math.imul(factor, 31) >>> 0;
    const valueHash = stringHash(item.stringValueOfField(k, false)) >>> 0;
    hash = (hash + Math.imul(factor, valueHash)) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A stable, deterministic string key suitable for indexing/dedup. Combines the
 * (case-insensitive) type with the {@link equivalenceHash}. Items that are
 * `itemsEquivalent` (exact-match) produce the same key.
 */
export function equivalenceKey(item: BibItem, tm: TypeManager): string {
  return `${item.type.toLowerCase()}#${equivalenceHash(item, tm).toString(36)}`;
}

// --- hash primitives (32-bit, FNV-ish, deterministic) ------------------------

/** Deterministic 32-bit hash of a string (djb2/FNV style). */
function stringHash(s: string): number {
  let h = 2166136261 >>> 0; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0; // FNV prime
  }
  return h >>> 0;
}

/** Case-insensitive variant (used for the type seed). */
function caseInsensitiveStringHash(s: string): number {
  return stringHash(s.toLowerCase());
}
