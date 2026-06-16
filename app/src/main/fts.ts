/**
 * Full-text search index over a document, backed by SQLite **FTS5** via
 * better-sqlite3 (in-memory; the `.bib` file remains the source of truth, this is
 * a rebuildable cache). Indexes each item's field text plus extracted PDF text
 * from its attachments.
 *
 * better-sqlite3 is a native addon whose binary is ABI-specific (Node vs
 * Electron). We load it lazily and degrade gracefully: if it can't be loaded for
 * the current runtime, `available` is false and the renderer falls back to its
 * client-side substring filter. Run `pnpm electron-rebuild` to enable FTS in the
 * packaged app.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/* eslint-disable @typescript-eslint/no-explicit-any */
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

/** One indexable record: an item id + the concatenated searchable text. */
export interface FtsRecord {
  readonly id: string;
  readonly text: string;
}

/**
 * Turn a user query into a safe FTS5 MATCH expression: split on whitespace,
 * strip FTS5 operators, quote each term and append `*` for prefix matching,
 * AND them together. Returns '' for an empty/space-only query.
 */
export function toMatchQuery(input: string): string {
  const terms = input
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/["*()]/g, '').trim())
    .filter((t) => t.length > 0);
  if (terms.length === 0) return '';
  return terms.map((t) => `"${t}"*`).join(' ');
}

/** In-memory FTS5 index. No-ops (and `search` returns []) when unavailable. */
export class FtsIndex {
  private db: BetterSqlite3 | null = null;
  readonly available: boolean;

  constructor() {
    const Database = loadDatabase();
    if (!Database) {
      this.available = false;
      return;
    }
    this.db = new Database(':memory:');
    this.db.exec(
      "CREATE VIRTUAL TABLE docs USING fts5(id UNINDEXED, body, tokenize='porter unicode61')",
    );
    this.available = true;
  }

  /** Replace the whole index with the given records (one transaction). */
  rebuild(records: readonly FtsRecord[]): void {
    if (!this.db) return;
    const insert = this.db.prepare('INSERT INTO docs(id, body) VALUES (?, ?)');
    const tx = this.db.transaction((rs: readonly FtsRecord[]) => {
      this.db!.exec('DELETE FROM docs');
      for (const r of rs) insert.run(r.id, r.text);
    });
    tx(records);
  }

  /** Update (or insert) one record's text. */
  upsert(id: string, text: string): void {
    if (!this.db) return;
    this.db.prepare('DELETE FROM docs WHERE id = ?').run(id);
    this.db.prepare('INSERT INTO docs(id, body) VALUES (?, ?)').run(id, text);
  }

  /** Remove one record. */
  remove(id: string): void {
    if (!this.db) return;
    this.db.prepare('DELETE FROM docs WHERE id = ?').run(id);
  }

  /** Return matching item ids, best-match first (bm25). Empty query → []. */
  search(query: string): string[] {
    if (!this.db) return [];
    const match = toMatchQuery(query);
    if (!match) return [];
    try {
      const rows = this.db
        .prepare('SELECT id FROM docs WHERE docs MATCH ? ORDER BY bm25(docs)')
        .all(match) as { id: string }[];
      return rows.map((r) => r.id);
    } catch {
      return [];
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
