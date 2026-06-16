import { describe, it, expect } from 'vitest';
import { crc32, crc32Hex, utf8Bytes } from './crc32.js';

describe('crc32', () => {
  it('matches the canonical zlib check vector for "123456789"', () => {
    // The standard CRC-32 (IEEE) check value.
    expect(crc32('123456789')).toBe(0xcbf43926);
    expect(crc32Hex('123456789')).toBe('cbf43926');
  });

  it('crc32 of empty input is 0', () => {
    expect(crc32('')).toBe(0);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('matches the known vector for "The quick brown fox jumps over the lazy dog"', () => {
    expect(crc32('The quick brown fox jumps over the lazy dog')).toBe(
      0x414fa339,
    );
  });

  it('matches a single-character vector ("a" => 0xe8b7be43)', () => {
    expect(crc32('a')).toBe(0xe8b7be43);
  });

  it('hashes string and byte forms identically', () => {
    const s = 'hello world';
    expect(crc32(s)).toBe(crc32(utf8Bytes(s)));
  });

  it('returns an unsigned 32-bit integer', () => {
    const v = crc32('some longer string with various characters !@#$%^&*()');
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(v)).toBe(true);
  });

  it('encodes UTF-8 for non-ASCII (é => C3 A9)', () => {
    expect(Array.from(utf8Bytes('é'))).toEqual([0xc3, 0xa9]);
    // surrogate pair (emoji)
    expect(Array.from(utf8Bytes('\u{1F600}'))).toEqual([
      0xf0, 0x9f, 0x98, 0x80,
    ]);
  });
});
