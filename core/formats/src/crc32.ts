/**
 * CRC-32 (IEEE 802.3 / zlib `crc32`) — inline implementation, no dependencies.
 *
 * BibDesk uses zlib's `crc32()` (see `BDSKFormatParser.m` `hashedField`) to
 * derive a deterministic unique suffix for cite keys, reproducing the
 * "universal cite key" of Papers 2/3. This is the exact same polynomial and
 * initialization (poly 0xEDB88320, initial 0, final XOR 0xFFFFFFFF) so the
 * numeric hash values match zlib for the same input bytes.
 *
 * The string overload hashes the **UTF-8** encoding of the input, matching
 * BibDesk's `[string dataUsingEncoding:NSUTF8StringEncoding]`.
 */

/** Lazily-built CRC-32 lookup table (256 entries). */
let TABLE: Uint32Array | undefined;

function crcTable(): Uint32Array {
  if (TABLE) return TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  TABLE = t;
  return t;
}

/**
 * Encode a JS string as UTF-8 bytes without relying on `TextEncoder` (which is
 * a DOM/Node global). Pure, platform-agnostic.
 */
export function utf8Bytes(input: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    // surrogate pair -> code point
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/**
 * Compute the CRC-32 (zlib/IEEE) of a string or byte array. Strings are hashed
 * as their UTF-8 encoding. Returns an unsigned 32-bit integer (0..2^32-1),
 * matching zlib's `crc32(0, bytes, len)` return value.
 */
export function crc32(input: string | Uint8Array): number {
  const bytes = typeof input === 'string' ? utf8Bytes(input) : input;
  const table = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** CRC-32 as a lowercase, zero-padded 8-digit hexadecimal string. */
export function crc32Hex(input: string | Uint8Array): string {
  return crc32(input).toString(16).padStart(8, '0');
}
