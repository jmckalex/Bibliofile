/**
 * Resolve an entry's journal to a downloaded cover thumbnail. The bundled data
 * (under `resources/journals/`) is: a `covers/index.json` manifest keyed by ISSN-L
 * (`{issnL, name, file, kind}`), plus `philosophy.json` / `top-journals.json`
 * metadata indexes that map a journal's name + every ISSN to its ISSN-L. So we can
 * resolve by the entry's `Issn` (any of its ISSNs) or by `Journal` name.
 *
 * The pure {@link resolveCover} is unit-tested; the loader reads the JSON lazily.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/** A resolved cover: the file under `covers/` + how it was sourced. */
export interface CoverHit {
  readonly file: string;
  /** `og:image` / `twitter:image` are likely real art; `favicon`/`apple-touch-icon` are logos. */
  readonly kind: string;
}

/** The in-memory indexes built from the bundled JSON. */
export interface CoverIndex {
  readonly issnLToCover: Map<string, CoverHit>;
  readonly issnToIssnL: Map<string, string>;
  readonly nameToIssnL: Map<string, string>;
  /** Covers keyed directly by normalized journal name (e.g. Wikipedia-sourced, no ISSN). */
  readonly nameToCover: Map<string, CoverHit>;
}

/** Normalize an ISSN to bare digits/X, uppercase (e.g. `0028-0836` → `00280836`). */
function normIssn(s: string): string {
  return s.replace(/[^0-9xX]/g, '').toUpperCase();
}

/** Normalize a journal name for matching (drop leading "the", fold punctuation). */
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface JournalRecord {
  name?: string;
  issnL?: string | null;
  issn?: string[];
}
interface ManifestEntry {
  issnL?: string | null;
  file?: string;
  kind?: string;
}

/** A name-keyed cover (e.g. fetched from Wikipedia), optionally carrying ISSNs. */
interface NamedCover {
  name?: string;
  file?: string;
  kind?: string;
  issnL?: string | null;
  issn?: string | string[];
}

/**
 * Build the lookup indexes from the ISSN-keyed manifest + metadata records, plus
 * any name-keyed covers (`named`, e.g. `wikipedia-index.json`). Name-keyed covers
 * resolve directly by journal name; if they also carry an ISSN, they register for
 * ISSN lookup too.
 */
export function buildCoverIndex(
  manifest: ManifestEntry[],
  records: JournalRecord[],
  named: NamedCover[] = [],
): CoverIndex {
  const issnLToCover = new Map<string, CoverHit>();
  for (const e of manifest) {
    if (e.issnL && e.file) issnLToCover.set(normIssn(e.issnL), { file: e.file, kind: e.kind ?? 'unknown' });
  }
  const issnToIssnL = new Map<string, string>();
  const nameToIssnL = new Map<string, string>();
  for (const r of records) {
    if (!r.issnL) continue;
    const il = normIssn(r.issnL);
    issnToIssnL.set(il, il);
    for (const issn of r.issn ?? []) issnToIssnL.set(normIssn(issn), il);
    if (r.name) nameToIssnL.set(normName(r.name), il);
  }
  const nameToCover = new Map<string, CoverHit>();
  for (const e of named) {
    if (!e.name || !e.file) continue;
    const hit: CoverHit = { file: e.file, kind: e.kind ?? 'wikipedia' };
    nameToCover.set(normName(e.name), hit);
    // Register any ISSN so ISSN-based lookups find it too.
    const issns = Array.isArray(e.issn) ? e.issn : e.issn ? [e.issn] : [];
    const il = e.issnL ? normIssn(e.issnL) : issns[0] ? normIssn(issns[0]) : undefined;
    if (il) {
      if (!issnLToCover.has(il)) issnLToCover.set(il, hit);
      issnToIssnL.set(il, il);
      for (const s of issns) issnToIssnL.set(normIssn(s), il);
    }
  }
  return { issnLToCover, issnToIssnL, nameToIssnL, nameToCover };
}

/** Resolve a cover from an entry's ISSN and/or journal name; null if none. */
export function resolveCover(idx: CoverIndex, issn: string, journalName: string): CoverHit | null {
  if (issn) {
    const il = idx.issnToIssnL.get(normIssn(issn)) ?? normIssn(issn);
    const hit = idx.issnLToCover.get(il);
    if (hit) return hit;
  }
  if (journalName) {
    const n = normName(journalName);
    // A direct name-keyed cover (e.g. Wikipedia) — covers journals with no ISSN match.
    const direct = idx.nameToCover.get(n);
    if (direct) return direct;
    const il = idx.nameToIssnL.get(n);
    if (il) {
      const hit = idx.issnLToCover.get(il);
      if (hit) return hit;
    }
  }
  return null;
}

// --- loading ----------------------------------------------------------------

let cached: { dir: string; index: CoverIndex } | undefined;

/** Locate the bundled `resources/journals` directory (dev + packaged layouts). */
export function findJournalsDir(appPath: string): string | undefined {
  return [
    resolve(appPath, 'resources', 'journals'),
    resolve(appPath, '..', 'resources', 'journals'),
    resolve(appPath, '..', 'app', 'resources', 'journals'),
  ].find((c) => existsSync(join(c, 'covers', 'index.json')));
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Load (and cache) the cover index from the journals dir, or null if absent. */
export function loadCoverIndex(appPath: string): { dir: string; index: CoverIndex } | null {
  if (cached) return cached;
  const dir = findJournalsDir(appPath);
  if (!dir) return null;
  const manifest = readJson<ManifestEntry[]>(join(dir, 'covers', 'index.json'), []);
  const records = [
    ...readJson<JournalRecord[]>(join(dir, 'philosophy.json'), []),
    ...readJson<JournalRecord[]>(join(dir, 'top-journals.json'), []),
  ];
  // Name-keyed covers fetched from Wikipedia (optional; written by the cover agent).
  const named = readJson<NamedCover[]>(join(dir, 'covers', 'wikipedia-index.json'), []);
  cached = { dir, index: buildCoverIndex(manifest, records, named) };
  return cached;
}

/** Absolute path of a cover file (guards against path traversal). */
export function coverFilePath(dir: string, file: string): string {
  return join(dir, 'covers', basename(file));
}
