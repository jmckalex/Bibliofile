/**
 * macOS bookmark data for `bdsk-file-N` attachment plists.
 *
 * BibDesk stores every linked file as a plist with a portable `relativePath`
 * AND a macOS `bookmark` blob (`BDSKLinkedFile.m:330`). The bookmark tracks the
 * file by identity rather than by name, so BibDesk can still find an attachment
 * that has been renamed or moved out from under its relative path. Writing only
 * `relativePath` — which is all this app could do before — produced attachments
 * that BibDesk reads fine (it tries `relativePath` FIRST, `BDSKLinkedFile.m:612`)
 * but that silently lose that recovery ability, and files roughly a third the
 * size of BibDesk's own.
 *
 * Node has no API for this, so it comes from a tiny Foundation addon
 * (`app/native/bookmark`) that makes exactly the same call BibDesk does.
 *
 * DEGRADES QUIETLY. On non-macOS, or when the addon hasn't been built, every
 * function here returns undefined and callers write the portable
 * `relativePath`-only plist as before — a smaller file that still resolves,
 * never a broken one.
 */

import { createRequire } from 'node:module';
import { constants as fsConstants, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface BookmarkAddon {
  /** Bookmark bytes for an existing file, or null if it can't be bookmarked. */
  create(path: string): Buffer | null;
  /** Where a bookmark currently points, following renames/moves. */
  resolve(data: Buffer): string | null;
  /** copyfile(3) preserving xattrs/ACLs/forks. Null on success, else a message. */
  copyFile(src: string, dst: string): string | null;
}

/** `undefined` = not tried yet, `null` = unavailable on this platform/build. */
let cached: BookmarkAddon | null | undefined;

/** Candidate locations for the built addon (dev tree, bundled main, packaged). */
function candidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const rel = 'native/bookmark/build/Release/bibliophile_bookmark.node';
  return [
    join(here, '../..', rel), // app/src/main/… and app/out/main/… both → app/
    join(here, '..', rel),
    join(process.resourcesPath ?? '', 'bibliophile_bookmark.node'), // packaged
  ];
}

function load(): BookmarkAddon | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (process.platform !== 'darwin') return cached;
  try {
    const found = candidates().find((p) => existsSync(p));
    if (!found) return cached;
    cached = createRequire(import.meta.url)(found) as BookmarkAddon;
  } catch {
    cached = null; // a broken/ABI-mismatched addon must not break saving
  }
  return cached;
}

/** Whether BibDesk-compatible bookmarks can be written in this runtime. */
export function bookmarksAvailable(): boolean {
  return load() !== null;
}

/**
 * Bookmark bytes for `absPath`, or undefined when unavailable or the file can't
 * be bookmarked (it must exist — a bookmark is a handle to a real file).
 */
export function bookmarkFor(absPath: string): Buffer | undefined {
  const addon = load();
  if (!addon) return undefined;
  try {
    return addon.create(absPath) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Where a bookmark points now. Exposed so the round-trip can be tested for real. */
export function resolveBookmark(data: Buffer): string | undefined {
  const addon = load();
  if (!addon) return undefined;
  try {
    return addon.resolve(data) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Copy `src` to `dst`, preserving extended attributes — Finder tags and
 * comments, quarantine flags — plus ACLs and resource forks. `copyFileSync`
 * carries only the bytes, so a PDF filed under a Finder tag loses it on the way
 * into a clone or the Papers folder.
 *
 * Never overwrites: both the native path (COPYFILE_EXCL) and the portable
 * fallback (COPYFILE_EXCL via node) fail if `dst` already exists, which is what
 * callers rely on to keep a copy from landing on someone else's file.
 *
 * Falls back to a plain byte copy off macOS or without the addon — the file is
 * always copied; only the extra metadata is best-effort.
 */
export function copyFilePreservingAttributes(src: string, dst: string): void {
  const addon = load();
  if (addon) {
    const err = addon.copyFile(src, dst);
    if (err === null) return;
    throw new Error(`${err} (copying ${src})`);
  }
  copyFileSync(src, dst, fsConstants.COPYFILE_EXCL);
}

/** Reset the cached handle. Tests only. */
export function __resetBookmarkAddon(): void {
  cached = undefined;
}
