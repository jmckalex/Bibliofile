/**
 * `bdsk-file-N` codec.
 *
 * A `Bdsk-File-N` field value is the base64 of a binary property list
 * (`bplist00…`, base64 prefix `YnBsaXN0`) describing a `BDSKLinkedFile`. The
 * dictionary carries one of `"bookmark"` (security-scoped NSData, macOS-only),
 * legacy `"aliasData"`, and/or a portable `"relativePath"`
 * (subsystem-12 §2). We decode it with `bplist-parser` and retain the decoded
 * structure so the serializer can re-encode it byte-for-byte with
 * `bplist-creator` (verified byte-exact for the `relativePath` shape, which is
 * what the cross-platform port relies on).
 */

import bplistParser from 'bplist-parser';
import bplistCreator from 'bplist-creator';

/** The base64 marker for a binary plist (`bplist00`). */
export const BDSK_FILE_PREFIX = 'YnBsaXN0';

/**
 * The decoded binary-plist structure for a `bdsk-file-N` field, retained so it
 * can be re-encoded byte-faithfully. Opaque to the rest of the codec; the app
 * layer reads `relativePath` for cross-platform resolution.
 */
export type BdskFilePlist = unknown;

/** True if a raw field value looks like a base64 binary-plist blob. */
export function isBdskFileBlob(value: string): boolean {
  return value.startsWith(BDSK_FILE_PREFIX);
}

/**
 * Decode a base64 binary-plist `bdsk-file-N` value to its plist structure.
 * Returns `undefined` if the value is not a decodable bplist (caller keeps the
 * raw string as a fallback).
 */
export function decodeBdskFile(value: string): BdskFilePlist | undefined {
  try {
    const buf = Buffer.from(value, 'base64');
    const parsed = bplistParser.parseBuffer(buf);
    return parsed[0];
  } catch {
    return undefined;
  }
}

/**
 * Re-encode a decoded `bdsk-file-N` plist structure back to a base64 string.
 * Byte-identical to the original for the `{ relativePath }` shape produced by
 * BibDesk's cross-platform writer (verified against the golden fixture).
 */
export function encodeBdskFile(plist: BdskFilePlist): string {
  const buf = bplistCreator(plist as object);
  return buf.toString('base64');
}

/**
 * Extract a portable relative path from a decoded `bdsk-file-N` plist, if
 * present. Used by the app layer to resolve the file cross-platform.
 */
export function relativePathOf(plist: BdskFilePlist): string | undefined {
  if (
    typeof plist === 'object' &&
    plist !== null &&
    typeof (plist as { relativePath?: unknown }).relativePath === 'string'
  ) {
    return (plist as { relativePath: string }).relativePath;
  }
  return undefined;
}
