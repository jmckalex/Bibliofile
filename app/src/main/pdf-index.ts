/**
 * Persistent full-text index over the text of PDF attachments, backed by SQLite
 * FTS5 **on disk**.
 *
 * WHY THIS IS SEPARATE FROM {@link FtsIndex}. The two halves of the app's search
 * have opposite characteristics, and conflating them is what made reopening a
 * large library slow:
 *
 * | | field text (title/author/…) | PDF text |
 * |---|---|---|
 * | size | a few MB | hundreds of MB |
 * | changes | on every edit | only when a file changes |
 * | natural key | item id — a FRESH UUID on every parse | the file's absolute path |
 *
 * Field text stays in memory, rebuilt at open: it is small, and its key isn't
 * stable across sessions so persisting it would be worthless. PDF text is keyed
 * by **absolute path**, which IS stable — that is precisely what lets this index
 * be built once and reused forever, with nothing here depending on item identity.
 *
 * The text is never read back into the app. It is written once, tokenized by
 * SQLite, and thereafter only ever matched *inside* the database: {@link
 * PdfTextIndex.search} returns paths, never bodies. A library whose PDFs total
 * half a gigabyte costs a few MB of app memory, not half a gigabyte.
 *
 * Freshness uses a cheap mtime+size stamp, falling back to an MD5 of the file's
 * bytes only when that stamp differs — a PDF that was touched, re-synced by a
 * cloud client, or AutoFiled to a new name has identical content and must not be
 * re-extracted (seconds per file). See {@link PdfTextIndex.check}.
 *
 * Like {@link FtsIndex}, this degrades gracefully: if the native better-sqlite3
 * addon can't load for the current runtime, `available` is false and every method
 * is an inert no-op, leaving field-text search working.
 */

import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readSync, readFileSync, renameSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';

import { toMatchQuery } from './fts.js';

const require = createRequire(import.meta.url);

/** Bump to rebuild the on-disk schema; stored text is always re-derivable. */
const SCHEMA_VERSION = 1;

/** The better-sqlite3 module/handle — untyped, exactly as {@link FtsIndex} treats it. */
type BetterSqlite3 = any;

let DatabaseCtor: BetterSqlite3 | null | undefined;

function loadDatabase(): BetterSqlite3 | null {
  if (DatabaseCtor === undefined) {
    try {
      DatabaseCtor = require('better-sqlite3');
    } catch {
      DatabaseCtor = null;
    }
  }
  return DatabaseCtor;
}

/**
 * MD5 of a file's bytes, read in bounded chunks so hashing a 200 MB PDF costs a
 * 1 MB buffer rather than 200 MB of heap. Returns '' if the file can't be read.
 */
export function md5File(path: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const hash = createHash('md5');
    const buf = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      hash.update(buf.subarray(0, n));
    }
    return hash.digest('hex');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

/** Verdict from {@link PdfTextIndex.check}: whether this file must be extracted. */
export interface PdfCheckResult {
  /** True when the caller must run the (expensive) pdfjs extraction. */
  readonly extract: boolean;
  readonly reason:
    | 'new' // never indexed
    | 'changed' // content genuinely differs (md5 mismatch)
    | 'page-limit' // indexed, but at a different ftsPageLimit
    | 'unknown-hash' // stamp differs and we have no stored md5 to compare (legacy row)
    | 'unchanged' // stamp matches — the cheap path, no hashing done
    | 'restamped' // stamp differed but the bytes are identical; stamp refreshed
    | 'missing'; // the file is gone; nothing to do
}

/** Persistent, path-keyed FTS5 index over extracted PDF text. */
export class PdfTextIndex {
  private db: BetterSqlite3 | null = null;
  readonly available: boolean;

  constructor(file: string) {
    const Database = loadDatabase();
    if (!Database) {
      this.available = false;
      return;
    }
    try {
      // The addon is dlopen'd lazily inside `new Database()`, so an ABI mismatch
      // or a missing FTS5 module throws HERE, not in loadDatabase().
      this.db = new Database(file);
      // WAL keeps the incremental per-file writes cheap and leaves the index
      // usable after a crash or a quit mid-index — the old JSON cache persisted
      // only when a whole run finished, so an interrupted first index lost
      // everything and re-extracted the entire library next launch.
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      // Schema generation. The stored text is always re-derivable (from the PDFs,
      // or the legacy blob), so a schema change just rebuilds rather than needing
      // a data migration.
      if (this.db.pragma('user_version', { simple: true }) !== SCHEMA_VERSION) {
        this.db.exec('DROP TABLE IF EXISTS pdf_fts; DROP TABLE IF EXISTS files;');
        this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
      }
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS files (
          path      TEXT PRIMARY KEY,
          mtime_ms  REAL    NOT NULL,
          size      INTEGER NOT NULL,
          pages     INTEGER NOT NULL,
          md5       TEXT    NOT NULL,
          fts_rowid INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS files_by_rowid ON files(fts_rowid);
        -- CONTENTLESS (content=''): FTS5 keeps only the inverted index and does
        -- NOT retain a copy of the body. We never read text back — search returns
        -- paths — so storing it would duplicate the entire corpus on disk for no
        -- benefit. contentless_delete=1 (SQLite >= 3.43; we bundle 3.49) keeps row
        -- deletion working, which eviction and re-extraction both need.
        CREATE VIRTUAL TABLE IF NOT EXISTS pdf_fts USING fts5(
          body, content='', contentless_delete=1, tokenize='porter unicode61'
        );
      `);
      this.available = true;
    } catch {
      try {
        this.db?.close();
      } catch {
        /* nothing to close */
      }
      this.db = null;
      this.available = false;
    }
  }

  /**
   * Decide whether `path` needs extracting at the `pages` limit, WITHOUT reading
   * its text back. Order is deliberate — the expensive check runs last:
   *   1. file gone            → `missing` (caller skips; {@link evictMissing} tidies)
   *   2. no row / new limit   → extract
   *   3. mtime+size match     → `unchanged`, no hashing at all (the common path)
   *   4. stamp differs, md5 equal → `restamped`: same bytes, so the stored text is
   *      still correct; refresh the stamp so the next open takes path 3
   *   5. md5 differs          → extract
   */
  check(path: string, pages: number): PdfCheckResult {
    if (!this.db) return { extract: false, reason: 'missing' };
    let st;
    try {
      st = statSync(path);
    } catch {
      return { extract: false, reason: 'missing' };
    }
    const row = this.db
      .prepare('SELECT mtime_ms, size, pages, md5 FROM files WHERE path = ?')
      .get(path) as { mtime_ms: number; size: number; pages: number; md5: string } | undefined;

    if (!row) return { extract: true, reason: 'new' };
    if (row.pages !== pages) return { extract: true, reason: 'page-limit' };
    if (row.mtime_ms === st.mtimeMs && row.size === st.size) {
      return { extract: false, reason: 'unchanged' };
    }
    // Stamp moved. Rows imported from the legacy JSON cache carry no hash, so
    // there is nothing to compare against — extract, which stores a real md5 and
    // makes every future stamp change cheap to adjudicate.
    if (!row.md5) return { extract: true, reason: 'unknown-hash' };
    if (md5File(path) === row.md5) {
      this.db
        .prepare('UPDATE files SET mtime_ms = ?, size = ? WHERE path = ?')
        .run(st.mtimeMs, st.size, path);
      return { extract: false, reason: 'restamped' };
    }
    return { extract: true, reason: 'changed' };
  }

  /** Store (or replace) the extracted `text` for `path`, stamped and hashed. */
  put(path: string, text: string, pages: number): void {
    if (!this.db) return;
    let st;
    try {
      st = statSync(path);
    } catch {
      return; // file vanished between extraction and storage
    }
    const tx = this.db.transaction(() => {
      const prev = this.db!.prepare('SELECT fts_rowid FROM files WHERE path = ?').get(path) as
        | { fts_rowid: number }
        | undefined;
      if (prev) this.db!.prepare('DELETE FROM pdf_fts WHERE rowid = ?').run(prev.fts_rowid);
      const info = this.db!.prepare('INSERT INTO pdf_fts(body) VALUES (?)').run(text);
      this.db!.prepare(
        `INSERT INTO files(path, mtime_ms, size, pages, md5, fts_rowid) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           mtime_ms = excluded.mtime_ms, size = excluded.size,
           pages = excluded.pages, md5 = excluded.md5, fts_rowid = excluded.fts_rowid`,
      ).run(path, st.mtimeMs, st.size, pages, md5File(path), info.lastInsertRowid);
    });
    tx();
  }

  /** Absolute paths whose PDF text matches `query`, best match first (bm25). */
  search(query: string): string[] {
    if (!this.db) return [];
    const match = toMatchQuery(query);
    if (!match) return [];
    try {
      // The FTS table is contentless, so it stores no path column — the match
      // yields rowids, which `files` maps back to paths (indexed by fts_rowid).
      const rows = this.db
        .prepare(
          `SELECT f.path AS path FROM pdf_fts
             JOIN files f ON f.fts_rowid = pdf_fts.rowid
            WHERE pdf_fts MATCH ? ORDER BY bm25(pdf_fts)`,
        )
        .all(match) as { path: string }[];
      return rows.map((r) => r.path);
    } catch {
      return [];
    }
  }

  /** Whether `path` currently has stored text (regardless of freshness). */
  has(path: string): boolean {
    if (!this.db) return false;
    return this.db.prepare('SELECT 1 FROM files WHERE path = ?').get(path) !== undefined;
  }

  /** How many files are indexed. */
  count(): number {
    if (!this.db) return 0;
    return (this.db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }).n;
  }

  /**
   * Drop rows whose file no longer exists, returning how many went. Without this
   * the index only ever grows: AutoFile moves a PDF to a new path, the new path
   * is indexed, and the old row lingers with a full copy of the same text.
   */
  evictMissing(): number {
    if (!this.db) return 0;
    const rows = this.db.prepare('SELECT path, fts_rowid FROM files').all() as {
      path: string;
      fts_rowid: number;
    }[];
    const dead = rows.filter((r) => !existsSync(r.path));
    if (dead.length === 0) return 0;
    const tx = this.db.transaction(() => {
      for (const r of dead) {
        this.db!.prepare('DELETE FROM pdf_fts WHERE rowid = ?').run(r.fts_rowid);
        this.db!.prepare('DELETE FROM files WHERE path = ?').run(r.path);
      }
    });
    tx();
    return dead.length;
  }

  /**
   * One-time import of the legacy `pdf-text-cache.json` blob, so upgrading does
   * not re-extract a library's worth of PDFs. Rows are inserted WITHOUT an md5
   * (hashing every file here would read the whole corpus); {@link check} treats a
   * missing hash as `unknown-hash` and stores a real one on the next extraction.
   *
   * Entries whose file no longer exists are skipped rather than imported and
   * later evicted. On success the JSON is renamed to `<file>.bak` — reversible,
   * and it stops the blob being re-imported on the next launch.
   */
  importLegacyJson(file: string): { imported: number; skipped: number } {
    if (!this.db || !existsSync(file)) return { imported: 0, skipped: 0 };
    let entries: [string, { mtimeMs: number; size: number; pages?: number; text: string }][];
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as {
        entries?: Record<string, { mtimeMs: number; size: number; pages?: number; text: string }>;
      };
      entries = Object.entries(data.entries ?? {});
    } catch {
      return { imported: 0, skipped: 0 }; // corrupt blob — nothing to salvage
    }
    let imported = 0;
    let skipped = 0;
    const tx = this.db.transaction(() => {
      for (const [path, v] of entries) {
        if (!v || typeof v.text !== 'string' || !existsSync(path)) {
          skipped++;
          continue;
        }
        const info = this.db!.prepare('INSERT INTO pdf_fts(body) VALUES (?)').run(v.text);
        this.db!.prepare(
          `INSERT INTO files(path, mtime_ms, size, pages, md5, fts_rowid) VALUES (?, ?, ?, ?, '', ?)
           ON CONFLICT(path) DO NOTHING`,
        ).run(path, v.mtimeMs, v.size, v.pages ?? 40, info.lastInsertRowid);
        imported++;
      }
    });
    tx();
    try {
      renameSync(file, `${file}.bak`);
    } catch {
      /* best-effort: the import still stands */
    }
    return { imported, skipped };
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      /* already closed */
    }
    this.db = null;
  }
}
