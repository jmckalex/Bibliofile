/**
 * Annotation (the `Annote` "Notes" field) storage codec.
 *
 * Our annotations are **markdown**, which routinely contains characters that are
 * unsafe in a BibTeX field value — above all an unbalanced `}` (which would
 * terminate the field early and corrupt the `.bib`). BibTeX has no way to store
 * an unbalanced brace (an escaped `\}` still counts toward brace depth), so the
 * only safe storage is to encode the value. Two modes:
 *
 * - **compressed** (default): `lz-string.compressToBase64` → base64 (alphabet
 *   `A–Za-z0-9+/=`, so brace-safe by construction) → wrapped to fixed-width lines,
 *   stored in a private `Bdsk-Annotation` field (kept out of the standard `Annote`
 *   so that field stays clean/portable). Markdown compresses well, so this is
 *   usually *smaller* than the raw text rather than base64's ~33% bloat.
 * - **readable** (opt-in): a restricted percent-escape of only the three unsafe
 *   characters `% { }`, stored in the standard `Annote` field — human-readable and
 *   portable, but the flakier path, so not the default.
 *
 * Reading is **format-agnostic** regardless of the active mode, so old files,
 * BibDesk-written files, and both of our modes all decode correctly.
 */

import LZString from 'lz-string';
import type { BibItem } from '@bibdesk/model';

/** Standard BibTeX annotation field (BibDesk's `Annote`). */
export const ANNOTATION_FIELD = 'Annote';
/** Private field holding the lz-string-compressed annotation blob. */
export const COMPRESSED_FIELD = 'Bdsk-Annotation';

export type AnnotationStorage = 'compressed' | 'readable';

/** Wrap width for the compressed base64 blob (keeps lines short in the `.bib`). */
const LINE_WIDTH = 76;

/** lz-string compress → base64 → fixed-width line wrap. */
export function encodeCompressed(markdown: string): string {
  const b64 = LZString.compressToBase64(markdown);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += LINE_WIDTH) lines.push(b64.slice(i, i + LINE_WIDTH));
  return lines.join('\n');
}

/** Strip the line wrapping and decompress. Returns '' if the blob is unreadable. */
export function decodeCompressed(stored: string): string {
  const b64 = stored.replace(/\s+/g, '');
  if (!b64) return '';
  return LZString.decompressFromBase64(b64) ?? '';
}

const READABLE_ESCAPE: Record<string, string> = { '%': '%25', '{': '%7B', '}': '%7D' };
const READABLE_UNESCAPE: Record<string, string> = { '25': '%', '7b': '{', '7d': '}' };

/** Percent-escape ONLY the BibTeX-unsafe characters `% { }`. Reversible. */
export function encodeReadable(markdown: string): string {
  return markdown.replace(/[%{}]/g, (c) => READABLE_ESCAPE[c]!);
}

/**
 * Reverse {@link encodeReadable}. Single-pass over `%25`/`%7B`/`%7D` only, so a
 * plain or foreign `Annote` (e.g. `50% done`) decodes to itself — no false
 * positives from generic percent-decoding.
 */
export function decodeReadable(stored: string): string {
  return stored.replace(/%(25|7B|7D)/gi, (_, h: string) => READABLE_UNESCAPE[h.toLowerCase()]!);
}

/**
 * Read an item's annotation markdown, format-agnostic: prefer the compressed
 * `Bdsk-Annotation` blob, else decode the standard `Annote` (a no-op for plain /
 * foreign / BibDesk-written text).
 */
export function readAnnotation(item: BibItem): string {
  const compressed = item.stringValueOfField(COMPRESSED_FIELD, false);
  if (compressed) return decodeCompressed(compressed);
  const annote = item.stringValueOfField(ANNOTATION_FIELD, false);
  return annote ? decodeReadable(annote) : '';
}

/**
 * Write an item's annotation per `mode`, keeping a single source of truth: the
 * active mode's field is written and the other annotation field is removed. An
 * empty markdown clears both.
 */
export function writeAnnotation(item: BibItem, markdown: string, mode: AnnotationStorage): void {
  if (!markdown) {
    item.removeField(COMPRESSED_FIELD);
    item.removeField(ANNOTATION_FIELD);
  } else if (mode === 'readable') {
    item.setField(ANNOTATION_FIELD, encodeReadable(markdown));
    item.removeField(COMPRESSED_FIELD);
  } else {
    item.setField(COMPRESSED_FIELD, encodeCompressed(markdown));
    item.removeField(ANNOTATION_FIELD);
  }
}
