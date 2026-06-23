/**
 * Persistent cache of extracted PDF text, keyed by absolute path and validated
 * by the file's mtime + size. Lets reopening a library skip re-extraction
 * entirely — the expensive pdfjs pass runs once per (unchanged) file, ever.
 *
 * Stored as a single JSON file under userData. Reads are validated against the
 * live file stat, so a moved/edited/replaced PDF transparently misses and
 * re-extracts. All operations are best-effort and never throw.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

interface CacheEntry {
  readonly mtimeMs: number;
  readonly size: number;
  /** The page limit the text was extracted at (0 = all pages). A different limit
   * misses, so raising/lowering it re-extracts. Absent on pre-existing entries. */
  readonly pages?: number;
  readonly text: string;
}

export class PdfTextCache {
  private readonly file: string;
  private readonly map = new Map<string, CacheEntry>();
  private dirty = false;

  constructor(file: string) {
    this.file = file;
    try {
      if (existsSync(file)) {
        const data = JSON.parse(readFileSync(file, 'utf8')) as {
          entries?: Record<string, CacheEntry>;
        };
        for (const [k, v] of Object.entries(data.entries ?? {})) this.map.set(k, v);
      }
    } catch {
      /* corrupt/unreadable cache — start empty */
    }
  }

  /** Cached text for `absPath` if the file is unchanged (mtime+size match) AND it
   * was extracted at the same `maxPages` limit, else undefined. */
  get(absPath: string, maxPages = 40): string | undefined {
    const entry = this.map.get(absPath);
    if (!entry) return undefined;
    if ((entry.pages ?? 40) !== maxPages) return undefined; // re-extract at a new limit
    try {
      const st = statSync(absPath);
      if (st.mtimeMs === entry.mtimeMs && st.size === entry.size) return entry.text;
    } catch {
      /* file gone — treat as a miss */
    }
    return undefined;
  }

  /** Record extracted `text` for `absPath`, stamped with its mtime+size + page limit. */
  set(absPath: string, text: string, maxPages = 40): void {
    try {
      const st = statSync(absPath);
      this.map.set(absPath, { mtimeMs: st.mtimeMs, size: st.size, pages: maxPages, text });
      this.dirty = true;
    } catch {
      /* file gone between extract and cache — skip */
    }
  }

  /** Write the cache to disk if anything changed since the last flush. */
  flush(): void {
    if (!this.dirty) return;
    try {
      writeFileSync(this.file, JSON.stringify({ version: 1, entries: Object.fromEntries(this.map) }));
      this.dirty = false;
    } catch {
      /* best-effort persistence */
    }
  }
}
