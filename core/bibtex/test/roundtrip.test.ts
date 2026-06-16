/**
 * roundtrip.test.ts — the LIVE round-trip contract over the golden corpus.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ TODO(C4): remove .skip once parse/serialize are implemented in             │
 * │           core/bibtex/src — this activates the acceptance contract.        │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * These assertions call parse()/serialize() and therefore THROW NotImplementedError
 * until C4 lands. They are wrapped in `describe.skip(...)` so `pnpm -r test` stays
 * green now. Flipping the single `.skip` below to `describe(...)` turns on the
 * contract: for every fixture, serialize(parse(text)) must equal text under that
 * fixture's documented comparison mode (see ../roundtrip.ts and fixtures/manifest.ts).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parse, serialize } from '../src/index';
import { runRoundTrip, comparatorFor, reserialize } from './roundtrip';
import { FIXTURES } from './fixtures/manifest';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, 'fixtures');
const read = (rel: string): string => readFileSync(join(FIXTURES_DIR, rel), 'utf-8');

describe('golden round-trip corpus (C4 contract)', () => {
  // ----- byte-exact + normalized fixtures: text round-trip -----------------
  for (const entry of FIXTURES.filter((f) => f.mode !== 'structural')) {
    it(`round-trips ${entry.file} (${entry.mode})`, () => {
      const input = read(entry.file);
      const result = runRoundTrip(input, entry.mode);
      // On failure, show the normalized diff (vitest prints expected vs actual).
      expect(result.actual).toBe(result.expected);
      expect(result.ok).toBe(true);
    });
  }

  // ----- structural fixtures: parse must succeed and serialize must be a
  //       stable fixed point (serialize is idempotent after the first pass) ---
  for (const entry of FIXTURES.filter((f) => f.mode === 'structural')) {
    it(`parses + reaches a serialize fixed-point for ${entry.file} (structural)`, () => {
      const input = read(entry.file);
      const lib = parse(input);
      expect(lib).toBeTruthy();
      const once = serialize(lib);
      const twice = reserialize(lib);
      // serialize(parse(serialize(lib))) === serialize(lib): canonical output is a fixed point.
      expect(twice).toBe(once);
    });
  }

  // ----- empty file is the simplest contract --------------------------------
  it('serialize(parse("")) === ""', () => {
    expect(serialize(parse(''))).toBe('');
  });

  // ----- the comparator is the one the harness documents --------------------
  it('uses the documented comparators', () => {
    expect(comparatorFor('byte-exact')).toBeTypeOf('function');
    expect(comparatorFor('normalized')).toBeTypeOf('function');
  });
});
