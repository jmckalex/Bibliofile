/**
 * Cite-key generation with collision avoidance — the convenience wrapper that
 * BibDesk exposes as `[BibItem suggestedCiteKey]`
 * (`parseFormat:forField:BDSKCiteKeyString ofItem:`), plus the `existingKeys`
 * plumbing that the document layer supplies through the publications collection.
 */

import type { BibItem } from '@bibdesk/model';
import { parseFormat, type ParseOptions } from './parser.js';
import { CITE_KEY_FIELD } from './sanitize.js';

/**
 * BibDesk's factory-default cite-key format (`Preferences.plist`
 * `Cite Key Format` = `%a1:%Y%u2`): first author last name, `:`, 4-digit year,
 * and a 2-letter lowercase uniquifier.
 */
export const DEFAULT_CITE_KEY_FORMAT = '%a1:%Y%u2';

/** Options for {@link generateCiteKey}. */
export interface GenerateCiteKeyOptions extends ParseOptions {
  /**
   * Treat key comparison case-insensitively (BibDesk's `itemsForCiteKey:` is
   * case-insensitive). Defaults to true.
   */
  caseInsensitive?: boolean;
}

/**
 * Generate a cite key for `item` using `format`, avoiding collisions with any
 * key in `existingKeys`. The item's own current cite key is allowed (so
 * re-generating a key for an item that already owns "smith:2020" can return the
 * same key). If the format has no unique specifier and the literal result
 * collides, the result is returned as-is (BibDesk only disambiguates when a
 * `%u/%U/%n` specifier is present, or when the key would otherwise be empty).
 *
 * `existingKeys` may be any iterable (array, Set, generator).
 */
export function generateCiteKey(
  format: string,
  item: BibItem,
  existingKeys: Iterable<string>,
  opts: GenerateCiteKeyOptions = {},
): string {
  const caseInsensitive = opts.caseInsensitive ?? true;
  const norm = (k: string) => (caseInsensitive ? k.toLowerCase() : k);

  const taken = new Set<string>();
  for (const k of existingKeys) taken.add(norm(k));

  const ownKey = norm(opts.currentCiteKey ?? item.citeKey);

  // A candidate is "available" if it is not taken by another item. The item's
  // own current key is always available to itself.
  const citeKeyAvailable =
    opts.citeKeyAvailable ??
    ((candidate: string) => {
      const c = norm(candidate);
      if (c === ownKey) return true;
      return !taken.has(c);
    });

  return parseFormat(format, item, CITE_KEY_FIELD, {
    ...opts,
    citeKeyAvailable,
  });
}
