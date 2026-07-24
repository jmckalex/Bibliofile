/**
 * Worker thread that migrates the legacy `pdf-text-cache.json` blob into the
 * persistent {@link PdfTextIndex}.
 *
 * WHY A WORKER. The legacy cache is a single JSON document holding the extracted
 * text of every PDF in the library — around half a gigabyte for a large one.
 * Parsing it costs several times its size in heap (measured: 489 MB of JSON →
 * ~2.5 GB RSS), and that is precisely the memory behaviour the on-disk index
 * exists to abolish. Doing it here means the main process never allocates any of
 * it and the UI never blocks: the thread opens the database itself, writes the
 * rows, and exits, taking the whole spike with it.
 *
 * This runs at most once per installation — afterwards the blob is renamed aside
 * and the index is maintained incrementally, a file at a time.
 */

import { parentPort, workerData } from 'node:worker_threads';

import { PdfTextIndex } from './pdf-index.js';

/** What the main process sends: where the blob is, and which database to fill. */
export interface MigrateRequest {
  readonly jsonPath: string;
  readonly dbPath: string;
}

/** What it gets back. `ok: false` leaves the blob untouched for a later retry. */
export interface MigrateResult {
  readonly ok: boolean;
  readonly imported: number;
  readonly skipped: number;
  readonly error?: string;
}

const { jsonPath, dbPath } = workerData as MigrateRequest;

let result: MigrateResult;
try {
  const index = new PdfTextIndex(dbPath);
  if (!index.available) {
    result = { ok: false, imported: 0, skipped: 0, error: 'SQLite unavailable in worker' };
  } else {
    const { imported, skipped } = index.importLegacyJson(jsonPath);
    result = { ok: true, imported, skipped };
  }
  index.close();
} catch (err) {
  result = {
    ok: false,
    imported: 0,
    skipped: 0,
    error: err instanceof Error ? err.message : String(err),
  };
}

parentPort?.postMessage(result);
