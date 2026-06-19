/**
 * Resolve an entry's journal to a downloaded cover thumbnail. The bundled data
 * (under `resources/journals/`) is: a `covers/index.json` manifest keyed by ISSN-L
 * (`{issnL, name, file, kind}`), plus `philosophy.json` / `top-journals.json`
 * metadata indexes that map a journal's name + every ISSN to its ISSN-L. So we can
 * resolve by the entry's `Issn` (any of its ISSNs) or by `Journal` name.
 *
 * The pure {@link resolveCover} is unit-tested; the loader reads the JSON lazily.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/** A resolved cover: the file under `covers/` + how it was sourced. */
export interface CoverHit {
  readonly file: string;
  /** `og:image` / `twitter:image` are likely real art; `favicon`/`apple-touch-icon` are logos. */
  readonly kind: string;
  /** True if `file` lives in the writable userData store, not the read-only bundle. */
  readonly userFile?: boolean;
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

/** A name-keyed cover (e.g. fetched from Wikipedia / user-added), optionally carrying ISSNs. */
interface NamedCover {
  name?: string;
  file?: string;
  kind?: string;
  issnL?: string | null;
  issn?: string | string[];
  sourceUrl?: string;
  wikiTitle?: string;
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

/**
 * Merge user-added / downloaded covers (from the writable userData store) into an
 * existing index, OVERRIDING any bundled cover for the same name/ISSN (the user's
 * choice wins). Each merged hit is flagged `userFile` so its bytes are read from
 * the userData dir rather than the bundle.
 */
function mergeUserCovers(index: CoverIndex, userCovers: NamedCover[]): void {
  for (const e of userCovers) {
    if (!e.name || !e.file) continue;
    const hit: CoverHit = { file: e.file, kind: e.kind ?? 'user', userFile: true };
    index.nameToCover.set(normName(e.name), hit);
    const issns = Array.isArray(e.issn) ? e.issn : e.issn ? [e.issn] : [];
    const il = e.issnL ? normIssn(e.issnL) : issns[0] ? normIssn(issns[0]) : undefined;
    if (il) {
      index.issnLToCover.set(il, hit);
      index.issnToIssnL.set(il, il);
      for (const s of issns) index.issnToIssnL.set(normIssn(s), il);
    }
  }
}

// --- loading ----------------------------------------------------------------

let cached: { dir: string; userDir?: string; index: CoverIndex } | undefined;

/** Drop the cached index so the next {@link loadCoverIndex} re-reads from disk
 *  (call after writing a user cover). */
export function invalidateCoverIndex(): void {
  cached = undefined;
}

/** The writable per-user covers directory (under Electron's userData). */
export function userCoversDir(userDataPath: string): string {
  return join(userDataPath, 'journal-covers');
}

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

/**
 * Load (and cache) the cover index. Reads the bundled covers, then merges the
 * writable userData covers on top (so user-added / downloaded covers win).
 * Returns null only if there is neither a bundle dir nor a userData dir.
 */
export function loadCoverIndex(
  appPath: string,
  userDataPath?: string,
): { dir: string; userDir?: string; index: CoverIndex } | null {
  if (cached) return cached;
  const dir = findJournalsDir(appPath);
  const manifest = dir ? readJson<ManifestEntry[]>(join(dir, 'covers', 'index.json'), []) : [];
  const records = dir
    ? [
        ...readJson<JournalRecord[]>(join(dir, 'philosophy.json'), []),
        ...readJson<JournalRecord[]>(join(dir, 'top-journals.json'), []),
      ]
    : [];
  // Name-keyed covers fetched from Wikipedia (optional; bundled).
  const named = dir ? readJson<NamedCover[]>(join(dir, 'covers', 'wikipedia-index.json'), []) : [];
  const index = buildCoverIndex(manifest, records, named);

  let userDir: string | undefined;
  if (userDataPath) {
    userDir = userCoversDir(userDataPath);
    mergeUserCovers(index, readJson<NamedCover[]>(join(userDir, 'index.json'), []));
  }
  if (!dir && !userDir) return null;
  cached = { dir: dir ?? '', userDir, index };
  return cached;
}

/** Absolute path of a bundled cover file (guards against path traversal). */
export function coverFilePath(dir: string, file: string): string {
  return join(dir, 'covers', basename(file));
}

/** Absolute path of a user-store cover file (guards against path traversal). */
export function userCoverFilePath(userDir: string, file: string): string {
  return join(userDir, basename(file));
}

/** Resolve a hit to its absolute file path, choosing the bundle vs userData dir. */
export function coverPathOf(loaded: { dir: string; userDir?: string }, hit: CoverHit): string | null {
  if (hit.userFile) return loaded.userDir ? userCoverFilePath(loaded.userDir, hit.file) : null;
  return loaded.dir ? coverFilePath(loaded.dir, hit.file) : null;
}

/** Slug a journal name into a safe filename stem. */
function slugifyJournal(name: string): string {
  return normName(name).replace(/\s+/g, '-').slice(0, 60) || 'journal';
}

/** Inputs to {@link saveUserCover}. */
export interface SaveUserCoverInput {
  readonly userDir: string;
  readonly name: string;
  readonly issnL?: string | null;
  readonly issns?: readonly string[];
  /** File extension without the dot (e.g. `jpg`, `png`). */
  readonly ext: string;
  readonly bytes: Uint8Array;
  /** `user` for a dropped image, `wikipedia` for a downloaded one. */
  readonly kind: string;
  readonly sourceUrl?: string;
  readonly wikiTitle?: string;
}

/**
 * Write a user-added / downloaded cover into the userData store and upsert its
 * `index.json` entry (keyed by normalized journal name — one cover per journal).
 * Caller should {@link invalidateCoverIndex} afterwards. Returns the filename.
 */
export function saveUserCover(input: SaveUserCoverInput): string {
  mkdirSync(input.userDir, { recursive: true });
  const ext = (input.ext || 'jpg').replace(/^\./, '').toLowerCase();
  const file = `${slugifyJournal(input.name)}-${input.kind}.${ext}`;
  writeFileSync(userCoverFilePath(input.userDir, file), input.bytes);

  const idxPath = join(input.userDir, 'index.json');
  const key = normName(input.name);
  const covers = readJson<NamedCover[]>(idxPath, []).filter(
    (c) => (c.name ? normName(c.name) : '') !== key,
  );
  covers.push({
    name: input.name,
    file,
    kind: input.kind,
    ...(input.issnL ? { issnL: input.issnL } : {}),
    ...(input.issns && input.issns.length ? { issn: [...input.issns] } : {}),
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.wikiTitle ? { wikiTitle: input.wikiTitle } : {}),
  });
  writeFileSync(idxPath, JSON.stringify(covers, null, 2));
  return file;
}
