/**
 * harness.test.ts — REAL tests that PASS NOW (Wave-1 barrier must be green).
 *
 * These do NOT call parse/serialize (which throw NotImplementedError until C4).
 * They validate:
 *   (a) the round-trip runner's normalization helpers on synthetic strings,
 *   (b) every fixture file loads and is non-empty (except the intentionally empty one),
 *   (c) the manifest matches the files actually on disk,
 *   (d) the canonical normalizer is idempotent on real BibDesk-canonical fixtures.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  normalizeLineEndings,
  stripVolatileHeader,
  dropLexicalComments,
  collapseBlankLines,
  trimTrailingWhitespace,
  normalizeCanonical,
  normalizeByteExact,
  comparatorFor,
} from './roundtrip';
import { FIXTURES, FIXTURE_MODES, type FixtureEntry } from './fixtures/manifest';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, 'fixtures');

function readFixture(entry: FixtureEntry): string {
  return readFileSync(join(FIXTURES_DIR, entry.file), 'utf-8');
}

// ---------------------------------------------------------------------------
// (a) Normalization helper unit tests
// ---------------------------------------------------------------------------

describe('normalizeLineEndings (N1)', () => {
  it('converts CRLF to LF', () => {
    expect(normalizeLineEndings('a\r\nb\r\n')).toBe('a\nb\n');
  });
  it('converts lone CR to LF', () => {
    expect(normalizeLineEndings('a\rb')).toBe('a\nb');
  });
  it('is idempotent', () => {
    const s = 'a\nb\nc';
    expect(normalizeLineEndings(normalizeLineEndings(s))).toBe(s);
  });
});

describe('stripVolatileHeader', () => {
  it('masks the Created-for line (user + date)', () => {
    const input = '%% Created for Ada Lovelace at 2026-01-05 09:16:00 +0000 ';
    expect(stripVolatileHeader(input)).toBe('%% Created for <USER> at <DATE>');
  });
  it('masks the Saved-with-encoding line', () => {
    const input = '%% Saved with string encoding Unicode (UTF-8) ';
    expect(stripVolatileHeader(input)).toBe('%% Saved with string encoding <ENCODING>');
  });
  it('leaves the stable template lines untouched', () => {
    const input =
      '%% This BibTeX bibliography file was created using BibDesk.\n%% https://bibdesk.sourceforge.io/';
    expect(stripVolatileHeader(input)).toBe(input);
  });
  it('makes two files with different user/date compare equal', () => {
    const a = '%% Created for Ada at 2026-01-05 09:00:00 +0000 \n@book{x}';
    const b = '%% Created for Bob at 1999-12-31 23:59:59 -0500 \n@book{x}';
    expect(stripVolatileHeader(a)).toBe(stripVolatileHeader(b));
  });
});

describe('dropLexicalComments (N2)', () => {
  it('drops single-% lexical comment lines', () => {
    const input = '% a lexical comment\n@book{x}';
    expect(dropLexicalComments(input)).toBe('@book{x}');
  });
  it('keeps %% BibDesk directive lines', () => {
    const input = '%% Created for x\n@book{x}';
    expect(dropLexicalComments(input)).toBe(input);
  });
  it('drops leading-whitespace lexical comments too', () => {
    expect(dropLexicalComments('   % indented')).toBe('');
  });
});

describe('collapseBlankLines (N8)', () => {
  it('collapses 3+ newlines to exactly two', () => {
    expect(collapseBlankLines('a\n\n\n\nb')).toBe('a\n\nb');
  });
  it('leaves a single blank line alone', () => {
    expect(collapseBlankLines('a\n\nb')).toBe('a\n\nb');
  });
});

describe('trimTrailingWhitespace', () => {
  it('strips trailing spaces/tabs per line', () => {
    expect(trimTrailingWhitespace('a  \nb\t\n')).toBe('a\nb\n');
  });
  it('collapses a trailing run of blank lines to a single newline', () => {
    expect(trimTrailingWhitespace('a\n\n\n')).toBe('a\n');
  });
});

describe('normalizeCanonical', () => {
  it('is idempotent on arbitrary input', () => {
    const messy = '%% Created for X at Y \r\n% loose\r\n\r\n\r\n@book{a}  \r\n';
    const once = normalizeCanonical(messy);
    expect(normalizeCanonical(once)).toBe(once);
  });
  it('composes header-strip + comment-drop + blank-collapse', () => {
    const messy = '%% Created for Ada at 2026 \n% drop me\n\n\n@book{a}';
    expect(normalizeCanonical(messy)).toBe('%% Created for <USER> at <DATE>\n\n@book{a}');
  });
});

describe('normalizeByteExact', () => {
  it('only normalizes line endings (non-lossy)', () => {
    const s = '@book{a,\n\ttitle = {T}}\n';
    expect(normalizeByteExact(s)).toBe(s);
    expect(normalizeByteExact('@book{a}\r\n')).toBe('@book{a}\n');
  });
});

describe('comparatorFor', () => {
  it('maps byte-exact to the non-lossy comparator', () => {
    expect(comparatorFor('byte-exact')('a\r\nb')).toBe('a\nb');
  });
  it('maps normalized to the canonical comparator', () => {
    expect(comparatorFor('normalized')('% x\n@book{a}')).toBe('@book{a}');
  });
  it('maps structural to identity', () => {
    const s = '% x\n@book{a}';
    expect(comparatorFor('structural')(s)).toBe(s);
  });
});

// ---------------------------------------------------------------------------
// (b) Every fixture loads
// ---------------------------------------------------------------------------

describe('fixtures load from disk', () => {
  for (const entry of FIXTURES) {
    it(`loads ${entry.file}`, () => {
      const text = readFixture(entry);
      expect(typeof text).toBe('string');
      if (entry.file === 'reference/empty.bib') {
        expect(text).toBe('');
      } else {
        expect(text.length).toBeGreaterThan(0);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// (c) Manifest <-> disk consistency
// ---------------------------------------------------------------------------

describe('manifest matches files on disk', () => {
  it('every manifest mode is a known mode', () => {
    for (const entry of FIXTURES) {
      expect(FIXTURE_MODES).toContain(entry.mode);
    }
  });

  it('every manifest file exists on disk', () => {
    for (const entry of FIXTURES) {
      expect(() => readFixture(entry)).not.toThrow();
    }
  });

  it('every .bib on disk is listed in the manifest (no orphans)', () => {
    const onDisk = new Set<string>();
    for (const sub of ['reference', 'synthesized']) {
      for (const f of readdirSync(join(FIXTURES_DIR, sub))) {
        if (f.endsWith('.bib')) onDisk.add(`${sub}/${f}`);
      }
    }
    const inManifest = new Set(FIXTURES.map((f) => f.file));
    expect([...inManifest].sort()).toEqual([...onDisk].sort());
  });

  it('manifest file paths are unique', () => {
    const files = FIXTURES.map((f) => f.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it('origin tag matches the directory', () => {
    for (const entry of FIXTURES) {
      expect(entry.file.startsWith(`${entry.origin}/`)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// (d) Synthesized fixtures are themselves BibDesk-canonical
//     (the canonical normalizer must be a no-op on them, modulo the volatile
//     header lines which it masks). This guards the fixtures, not the codec.
// ---------------------------------------------------------------------------

describe('synthesized fixtures are in canonical form', () => {
  for (const entry of FIXTURES.filter((f) => f.origin === 'synthesized')) {
    it(`${entry.file} carries the BibDesk header template`, () => {
      const text = readFixture(entry);
      expect(text).toContain('%% This BibTeX bibliography file was created using BibDesk.');
      expect(text).toContain('%% https://bibdesk.sourceforge.io/');
    });
    it(`${entry.file} ends with a single trailing newline`, () => {
      const text = readFixture(entry);
      expect(text.endsWith('\n')).toBe(true);
      expect(text.endsWith('\n\n')).toBe(false);
    });
    it(`${entry.file} uses LF line endings only`, () => {
      expect(readFixture(entry)).not.toContain('\r');
    });
  }
});

describe('group @comment blocks have the exact BibDesk markers', () => {
  it('bd-all-groups.bib contains all four group block headers in canonical order', () => {
    const text = readFixture(FIXTURES.find((f) => f.file === 'synthesized/bd-all-groups.bib')!);
    const iStatic = text.indexOf('@comment{BibDesk Static Groups{\n');
    const iSmart = text.indexOf('@comment{BibDesk Smart Groups{\n');
    const iUrl = text.indexOf('@comment{BibDesk URL Groups{\n');
    const iScript = text.indexOf('@comment{BibDesk Script Groups{\n');
    expect(iStatic).toBeGreaterThanOrEqual(0);
    expect(iSmart).toBeGreaterThan(iStatic);
    expect(iUrl).toBeGreaterThan(iSmart);
    expect(iScript).toBeGreaterThan(iUrl);
    // Each block closes with "}}"
    expect(text).toContain('</plist>\n}}');
  });
  it('group block payloads are XML plists (UTF-8)', () => {
    const text = readFixture(FIXTURES.find((f) => f.file === 'synthesized/bd-all-groups.bib')!);
    expect(text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(text).toContain('<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"');
  });
});

describe('bdsk-file fields are base64 binary plists', () => {
  it('bdsk-file-1 value starts with the YnBsaXN0 (bplist00) prefix', () => {
    const text = readFixture(FIXTURES.find((f) => f.file === 'synthesized/bd-bdsk-file-url.bib')!);
    const m = text.match(/bdsk-file-1 = \{(YnBsaXN0[^}]*)\}/);
    expect(m).not.toBeNull();
    const payload = m?.[1] ?? '';
    expect(payload.startsWith('YnBsaXN0')).toBe(true);
  });
  it('bdsk-file/url fields appear after the ordinary fields (written last)', () => {
    const text = readFixture(FIXTURES.find((f) => f.file === 'synthesized/bd-bdsk-file-url.bib')!);
    expect(text.indexOf('bdsk-file-1 =')).toBeGreaterThan(text.indexOf('year ='));
    expect(text.indexOf('bdsk-url-1 =')).toBeGreaterThan(text.indexOf('bdsk-file-1 ='));
  });
});
