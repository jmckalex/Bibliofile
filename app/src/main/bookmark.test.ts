/**
 * Tests for macOS bookmark generation and its use in `bdsk-file-N` plists.
 *
 * The addon is Node-API, so a single build works under both Node and Electron —
 * these skip only when it hasn't been built at all (`pnpm build:bookmark`), not
 * because of an ABI mismatch the way the better-sqlite3 tests do. Everything
 * degrades to `relativePath`-only when unavailable, and that degradation is
 * asserted below so a missing addon can never become a crash.
 */
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  bookmarkFor,
  bookmarksAvailable,
  copyFilePreservingAttributes,
  resolveBookmark,
} from './bookmark.js';
import { decodeBdskFile, encodeBdskFile } from '@bibdesk/bibtex';

const HAVE = bookmarksAvailable();

/** macOS canonicalises /var → /private/var, so compare resolved paths loosely. */
function samePath(a: string | undefined, b: string): boolean {
  if (!a) return false;
  return a === b || a === `/private${b}` || `/private${a}` === b;
}

describe('bookmark addon', () => {
  it('never throws when unavailable — callers just get relativePath-only', () => {
    // Whatever the platform, these must be total functions.
    expect(() => bookmarkFor('/definitely/not/here.pdf')).not.toThrow();
    expect(() => resolveBookmark(Buffer.from('rubbish'))).not.toThrow();
    expect(bookmarkFor('/definitely/not/here.pdf')).toBeUndefined();
  });

  it.runIf(HAVE)('creates a bookmark that resolves back to the same file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-bm-'));
    const pdf = join(dir, 'paper.pdf');
    writeFileSync(pdf, '%PDF-1.4');

    const data = bookmarkFor(pdf)!;
    expect(data).toBeInstanceOf(Buffer);
    // BibDesk's blobs start with the same 'book' magic — same Foundation call.
    expect(data.subarray(0, 4).toString()).toBe('book');
    expect(samePath(resolveBookmark(data), pdf)).toBe(true);
  });

  it.runIf(HAVE)('follows a RENAME — the whole reason BibDesk stores one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-bm-move-'));
    const pdf = join(dir, 'before.pdf');
    writeFileSync(pdf, '%PDF-1.4');
    const data = bookmarkFor(pdf)!;

    const moved = join(dir, 'after.pdf');
    renameSync(pdf, moved);

    // relativePath alone would now be dead; the bookmark still finds the file.
    expect(samePath(resolveBookmark(data), moved)).toBe(true);
  });

  it.runIf(HAVE)('returns undefined for a file that does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-bm-missing-'));
    expect(bookmarkFor(join(dir, 'nope.pdf'))).toBeUndefined();
  });

  it.runIf(HAVE)('returns undefined for a corrupt bookmark rather than throwing', () => {
    expect(resolveBookmark(Buffer.from('not a bookmark at all'))).toBeUndefined();
    expect(resolveBookmark(Buffer.alloc(0))).toBeUndefined();
  });

  it.runIf(HAVE)('copyFilePreservingAttributes carries extended attributes across', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-bm-xattr-'));
    const src = join(dir, 'tagged.pdf');
    const dst = join(dir, 'copy.pdf');
    writeFileSync(src, '%PDF-1.4 tagged');
    // A Finder-comment-shaped attribute: exactly what a plain byte copy drops.
    execFileSync('/usr/bin/xattr', ['-w', 'com.apple.metadata:kMDItemFinderComment', 'hello', src]);

    copyFilePreservingAttributes(src, dst);

    expect(readFileSync(dst, 'utf8')).toBe('%PDF-1.4 tagged');
    const attrs = execFileSync('/usr/bin/xattr', [dst]).toString();
    expect(attrs).toContain('com.apple.metadata:kMDItemFinderComment');
    expect(
      execFileSync('/usr/bin/xattr', ['-p', 'com.apple.metadata:kMDItemFinderComment', dst])
        .toString()
        .trim(),
    ).toBe('hello');
  });

  it.runIf(HAVE)('copyFilePreservingAttributes refuses to overwrite an existing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-bm-excl-'));
    const src = join(dir, 'a.pdf');
    const dst = join(dir, 'b.pdf');
    writeFileSync(src, 'NEW');
    writeFileSync(dst, 'MUST SURVIVE');

    expect(() => copyFilePreservingAttributes(src, dst)).toThrow();
    expect(readFileSync(dst, 'utf8')).toBe('MUST SURVIVE');
  });

  it.runIf(HAVE)('survives the bdsk-file plist encode/decode round-trip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-bm-plist-'));
    const pdf = join(dir, 'paper.pdf');
    writeFileSync(pdf, '%PDF-1.4');

    // Exactly the shape written into a .bib: relativePath first, then bookmark.
    const plist = { relativePath: 'paper.pdf', bookmark: bookmarkFor(pdf)! };
    const b64 = encodeBdskFile(plist);
    const back = decodeBdskFile(b64) as { relativePath: string; bookmark: Buffer };

    expect(Object.keys(back)).toEqual(['relativePath', 'bookmark']);
    expect(back.relativePath).toBe('paper.pdf');
    // The blob must come back byte-identical, and still resolve to the file.
    expect(Buffer.from(back.bookmark).equals(plist.bookmark)).toBe(true);
    expect(samePath(resolveBookmark(Buffer.from(back.bookmark)), pdf)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});
