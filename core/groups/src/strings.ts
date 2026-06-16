/**
 * String comparison helpers used by the condition evaluator.
 *
 * BibDesk uses `CFStringFindWithOptions` with `kCFCompareCaseInsensitive` for
 * contain/start/end, `-[NSString caseInsensitiveCompare:]` for equal/not-equal
 * (BDSKCondition.m:342), and `NSCaseInsensitiveSearch | NSNumericSearch` for the
 * Smaller/Larger ordering of plain strings (`localizedCaseInsensitiveNumericCompare:`,
 * NSString_BDSKExtensions.m). It does NOT fold diacritics in these paths, so we
 * match that exactly: case-insensitive (locale-independent lowercase) only.
 */

/** Case-insensitive equality (`-[NSString caseInsensitiveCompare:] == NSOrderedSame`). */
export function caseInsensitiveEqual(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Case-insensitive substring containment (`kCFCompareCaseInsensitive`). */
export function caseInsensitiveContains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** Case-insensitive prefix (`kCFCompareAnchored`). */
export function caseInsensitiveStartsWith(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().startsWith(needle.toLowerCase());
}

/** Case-insensitive suffix (`kCFCompareAnchored | kCFCompareBackwards`). */
export function caseInsensitiveEndsWith(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().endsWith(needle.toLowerCase());
}

/**
 * Locale-aware, case-insensitive, numeric-aware string ordering.
 * Mirrors `-[NSString localizedCaseInsensitiveNumericCompare:]`
 * (NSCaseInsensitiveSearch | NSNumericSearch). Returns -1 / 0 / 1.
 *
 * `Intl.Collator` with `numeric: true` and `sensitivity: 'accent'` (so it folds
 * case but keeps diacritics) is the closest standard-library match.
 */
const numericCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'accent',
});

export function localizedCaseInsensitiveNumericCompare(a: string, b: string): number {
  const r = numericCollator.compare(a, b);
  return r < 0 ? -1 : r > 0 ? 1 : 0;
}
