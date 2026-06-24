/**
 * Abstract field storage codec — the optional brace-safe encodings for the
 * `Abstract` field, mirroring the annotation codec ({@link ./annotation.ts}).
 *
 * The abstract is an ordinary BibTeX field, so by default it's stored as **plain
 * text** (portable, fed to CSL, read by other tools). But like notes, a pasted
 * abstract can contain an **unbalanced `}`** that would terminate the field and
 * corrupt the `.bib`. So we offer the same opt-in protections as annotations:
 *
 * - **plain** (default): the value verbatim in the standard `Abstract` field.
 * - **readable**: percent-escape only `% { }` in the standard `Abstract` field —
 *   brace-safe and still readable, at the cost of `%7B`/`%7D` in foreign tools.
 * - **compressed**: lz-string + base64 in a private `Bdsk-Abstract` field
 *   (brace-safe by construction, compact) — but opaque to other tools and absent
 *   from the standard field, so CSL/foreign readers won't see it.
 *
 * Reading is **format-agnostic** regardless of the active mode, so plain files,
 * foreign files, and all three of our modes decode correctly.
 */

import { decodeCompressed, decodeReadable, encodeCompressed, encodeReadable } from './annotation.js';
import type { BibItem } from '@bibdesk/model';

export type AbstractStorage = 'plain' | 'readable' | 'compressed';

/** Standard BibTeX abstract field. */
export const ABSTRACT_FIELD = 'Abstract';
/** Private field holding the lz-string-compressed abstract blob. */
export const ABSTRACT_COMPRESSED_FIELD = 'Bdsk-Abstract';

/**
 * Read an item's abstract markdown, format-agnostic: prefer the compressed
 * `Bdsk-Abstract` blob, else decode the standard `Abstract` (a no-op for plain /
 * foreign text). `inherit` follows crossref inheritance for the plain field
 * (matching the preview card's behaviour); the compressed blob is always read
 * from the item's own fields.
 */
export function readAbstract(item: BibItem, inherit = true): string {
  const compressed = item.stringValueOfField(ABSTRACT_COMPRESSED_FIELD, false);
  if (compressed) return decodeCompressed(compressed);
  const plain = item.stringValueOfField(ABSTRACT_FIELD, inherit);
  return plain ? decodeReadable(plain) : '';
}

/**
 * Write an item's abstract per `mode`, keeping a single source of truth: the
 * active mode's field is written and the other is removed. Empty text clears both.
 */
export function writeAbstract(item: BibItem, text: string, mode: AbstractStorage): void {
  if (!text) {
    item.removeField(ABSTRACT_COMPRESSED_FIELD);
    item.removeField(ABSTRACT_FIELD);
  } else if (mode === 'compressed') {
    item.setField(ABSTRACT_COMPRESSED_FIELD, encodeCompressed(text));
    item.removeField(ABSTRACT_FIELD);
  } else if (mode === 'readable') {
    item.setField(ABSTRACT_FIELD, encodeReadable(text));
    item.removeField(ABSTRACT_COMPRESSED_FIELD);
  } else {
    item.setField(ABSTRACT_FIELD, text);
    item.removeField(ABSTRACT_COMPRESSED_FIELD);
  }
}
