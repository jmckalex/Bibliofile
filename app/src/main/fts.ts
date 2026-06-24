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
import { parseSearchQuery } from '@bibdesk/shared';

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
 * Turn a user query into a safe FTS5 MATCH expression. Bare words become quoted
 * prefix terms (`"word"*`); a double-quoted run becomes an exact FTS5 phrase
 * (`"those words"` — the tokens must appear adjacent and in order). Everything is
 * AND-ed together. Returns '' for an empty/space-only query.
 *
 * Quoting each term/phrase makes the input inert to FTS5's own query operators,
 * and the shared parser has already stripped `* ( )` from words — so the result
 * is always a safe MATCH expression. See {@link parseSearchQuery}.
 */
export function toMatchQuery(input: string): string {
  const tokens = parseSearchQuery(input);
  if (tokens.length === 0) return '';
  return tokens
    .map((tk) => (tk.phrase ? `"${tk.words.join(' ')}"` : `"${tk.words[0]}"*`))
    .join(' ');
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
    // The native `.node` addon is dlopen'd lazily inside `new Database()`, not by
    // the `require` above — so an ABI mismatch (Node vs Electron build) or a
    // missing FTS5 module throws *here*, not in loadDatabase(). Guard it so a
    // broken FTS backend degrades to unavailable rather than aborting the whole
    // document open.
    try {
      this.db = new Database(':memory:');
      this.db.exec(
        "CREATE VIRTUAL TABLE docs USING fts5(id UNINDEXED, body, tokenize='porter unicode61')",
      );
      this.available = true;
    } catch {
      this.db?.close();
      this.db = null;
      this.available = false;
    }
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
