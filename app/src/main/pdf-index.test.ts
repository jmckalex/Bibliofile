/**
 * Tests for the persistent, path-keyed PDF full-text index.
 *
 * The SQLite-backed cases need the native better-sqlite3 addon for the CURRENT
 * runtime; locally the addon is built for the Electron ABI, so they skip (run
 * `pnpm --filter @bibdesk/app rebuild:node` to exercise them, and CI's fresh
 * install runs them against the node ABI). `md5File` is pure and always runs.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { PdfTextIndex, md5File } from './pdf-index.js';

/** Whether the native SQLite backend loads in this runtime. */
const SQLITE = ((): boolean => {
  const dir = mkdtempSync(join(tmpdir(), 'bd-pdfidx-probe-'));
  const idx = new PdfTextIndex(join(dir, 'probe.db'));
  const ok = idx.available;
  idx.close();
  return ok;
})();

/** A temp dir plus a helper that writes a file and returns its path. */
function fixture(label: string): { dir: string; write: (name: string, body: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), label));
  return {
    dir,
    write: (name, body) => {
      const p = join(dir, name);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, body);
      return p;
    },
  };
}

describe('md5File', () => {
  it('hashes file bytes and distinguishes different content', () => {
    const { write } = fixture('bd-md5-');
    const a = write('a.pdf', 'hello world');
    const b = write('b.pdf', 'hello world');
    const c = write('c.pdf', 'different');
    expect(md5File(a)).toBe(md5File(b)); // same bytes → same hash
    expect(md5File(a)).not.toBe(md5File(c));
    expect(md5File(a)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('hashes content larger than the read buffer correctly', () => {
    const { write } = fixture('bd-md5-big-');
    // 3 MB, larger than the 1 MB chunk buffer, so the chunked loop is exercised.
    const body = 'x'.repeat(3 * 1024 * 1024);
    const p = write('big.pdf', body);
    expect(md5File(p)).toBe(createHash('md5').update(readFileSync(p)).digest('hex'));
  });

  it('returns empty string for an unreadable file rather than throwing', () => {
    expect(md5File(join(tmpdir(), 'bd-does-not-exist-xyz.pdf'))).toBe('');
  });
});

describe.runIf(SQLITE)('PdfTextIndex (SQLite)', () => {
  it('stores text, finds it by content, and returns paths not bodies', () => {
    const { dir, write } = fixture('bd-pdfidx-');
    const idx = new PdfTextIndex(join(dir, 'i.db'));
    const p = write('paper.pdf', '%PDF');

    idx.put(p, 'the evolution of conformist bias in signalling games', 0);

    expect(idx.search('conformist')).toEqual([p]);
    expect(idx.search('signalling')).toEqual([p]);
    expect(idx.search('thermodynamics')).toEqual([]);
    expect(idx.count()).toBe(1);
    idx.close();
  });

  it('persists across sessions — reopening does not rebuild', () => {
    const { dir, write } = fixture('bd-pdfidx-persist-');
    const db = join(dir, 'i.db');
    const p = write('paper.pdf', '%PDF');

    const first = new PdfTextIndex(db);
    first.put(p, 'replicator dynamics', 0);
    first.close();

    const second = new PdfTextIndex(db); // fresh process would see exactly this
    expect(second.count()).toBe(1);
    expect(second.search('replicator')).toEqual([p]);
    // The whole point: an unchanged file needs no work on reopen.
    expect(second.check(p, 0)).toEqual({ extract: false, reason: 'unchanged' });
    second.close();
  });

  it('check: new file, unchanged file, and a changed page limit', () => {
    const { dir, write } = fixture('bd-pdfidx-check-');
    const idx = new PdfTextIndex(join(dir, 'i.db'));
    const p = write('paper.pdf', '%PDF');

    expect(idx.check(p, 0)).toEqual({ extract: true, reason: 'new' });
    idx.put(p, 'some text', 0);
    expect(idx.check(p, 0)).toEqual({ extract: false, reason: 'unchanged' });
    // A different ftsPageLimit means the stored text covers the wrong page range.
    expect(idx.check(p, 40)).toEqual({ extract: true, reason: 'page-limit' });
    idx.close();
  });

  it('check: a touched-but-identical file is restamped, NOT re-extracted (md5)', () => {
    const { dir, write } = fixture('bd-pdfidx-touch-');
    const idx = new PdfTextIndex(join(dir, 'i.db'));
    const p = write('paper.pdf', '%PDF same bytes');
    idx.put(p, 'stored text', 0);

    // What a cloud re-sync / backup restore / `touch` does: mtime moves, bytes don't.
    const future = new Date(Date.now() + 60_000);
    utimesSync(p, future, future);

    expect(idx.check(p, 0)).toEqual({ extract: false, reason: 'restamped' });
    // Restamped, so the NEXT check takes the cheap path with no hashing at all.
    expect(idx.check(p, 0)).toEqual({ extract: false, reason: 'unchanged' });
    expect(idx.search('stored')).toEqual([p]); // text survived
    idx.close();
  });

  it('check: genuinely different content IS re-extracted', () => {
    const { dir, write } = fixture('bd-pdfidx-changed-');
    const idx = new PdfTextIndex(join(dir, 'i.db'));
    const p = write('paper.pdf', 'original content');
    idx.put(p, 'original text', 0);

    writeFileSync(p, 'entirely different content of another length');
    expect(idx.check(p, 0)).toEqual({ extract: true, reason: 'changed' });
    idx.close();
  });

  it('check: a missing file is reported, not extracted', () => {
    const { dir } = fixture('bd-pdfidx-missing-');
    const idx = new PdfTextIndex(join(dir, 'i.db'));
    expect(idx.check(join(dir, 'nope.pdf'), 0)).toEqual({ extract: false, reason: 'missing' });
    idx.close();
  });

  it('put replaces prior text for a path instead of accumulating rows', () => {
    const { dir, write } = fixture('bd-pdfidx-replace-');
    const idx = new PdfTextIndex(join(dir, 'i.db'));
    const p = write('paper.pdf', 'v1');
    idx.put(p, 'aardvark text', 0);
    writeFileSync(p, 'v2 longer');
    idx.put(p, 'bumblebee text', 0);

    expect(idx.count()).toBe(1);
    expect(idx.search('bumblebee')).toEqual([p]);
    expect(idx.search('aardvark')).toEqual([]); // old body really gone, not shadowed
    idx.close();
  });

  it('evictMissing drops rows for deleted/moved files and frees their text', () => {
    const { dir, write } = fixture('bd-pdfidx-evict-');
    const idx = new PdfTextIndex(join(dir, 'i.db'));
    const kept = write('kept.pdf', 'a');
    const moved = write('moved.pdf', 'b');
    idx.put(kept, 'kept text', 0);
    idx.put(moved, 'orphan text', 0);

    // What AutoFile does: the file leaves that path (renamed into an author folder).
    writeFileSync(join(dir, 'elsewhere.pdf'), 'b');
    rmSync(moved);

    expect(idx.evictMissing()).toBe(1);
    expect(idx.count()).toBe(1);
    expect(idx.search('orphan')).toEqual([]); // its text is gone from the index too
    expect(idx.search('kept')).toEqual([kept]);
    idx.close();
  });

  it('importLegacyJson imports the old blob, skips dead paths, and moves it aside', () => {
    const { dir, write } = fixture('bd-pdfidx-migrate-');
    const live = write('live.pdf', 'x');
    const legacy = join(dir, 'pdf-text-cache.json');
    writeFileSync(
      legacy,
      JSON.stringify({
        version: 1,
        entries: {
          [live]: { mtimeMs: 1, size: 1, pages: 0, text: 'imported body text' },
          [join(dir, 'gone.pdf')]: { mtimeMs: 1, size: 1, text: 'stale autofile-era row' },
        },
      }),
    );

    const idx = new PdfTextIndex(join(dir, 'i.db'));
    expect(idx.importLegacyJson(legacy)).toEqual({ imported: 1, skipped: 1 });
    expect(idx.search('imported')).toEqual([live]); // no re-extraction needed
    expect(idx.search('stale')).toEqual([]);
    expect(existsSync(legacy)).toBe(false); // moved aside…
    expect(existsSync(`${legacy}.bak`)).toBe(true); // …reversibly

    // Imported rows carry no md5, so a stamp change can't be adjudicated and must
    // re-extract — after which a real hash is stored.
    expect(idx.check(live, 0)).toEqual({ extract: true, reason: 'unknown-hash' });
    idx.close();
  });

  it('an unreadable database degrades to unavailable instead of throwing', () => {
    const { dir } = fixture('bd-pdfidx-bad-');
    // A directory where the DB file should be: SQLite cannot open it.
    const bad = join(dir, 'adir');
    mkdirSync(bad);
    const idx = new PdfTextIndex(bad);
    expect(idx.available).toBe(false);
    expect(idx.search('anything')).toEqual([]); // inert, not a crash
    expect(idx.count()).toBe(0);
    idx.close();
  });
});
