import { mkdtempSync, writeFileSync, utimesSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PdfTextCache } from './pdf-cache';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'bd-pdfcache-'));
}

describe('PdfTextCache', () => {
  it('returns cached text for an unchanged file (mtime+size match)', () => {
    const dir = tempDir();
    const pdf = join(dir, 'a.pdf');
    writeFileSync(pdf, 'hello');
    const cache = new PdfTextCache(join(dir, 'cache.json'));
    expect(cache.get(pdf)).toBeUndefined(); // nothing stored yet
    cache.set(pdf, 'extracted text');
    expect(cache.get(pdf)).toBe('extracted text');
  });

  it('misses when the file changes (size differs)', () => {
    const dir = tempDir();
    const pdf = join(dir, 'a.pdf');
    writeFileSync(pdf, 'hello');
    const cache = new PdfTextCache(join(dir, 'cache.json'));
    cache.set(pdf, 'old text');
    writeFileSync(pdf, 'a much longer replacement body'); // size changes
    expect(cache.get(pdf)).toBeUndefined();
  });

  it('misses when only the mtime changes', () => {
    const dir = tempDir();
    const pdf = join(dir, 'a.pdf');
    writeFileSync(pdf, 'hello');
    const cache = new PdfTextCache(join(dir, 'cache.json'));
    cache.set(pdf, 'text');
    const future = new Date(Date.now() + 60_000);
    utimesSync(pdf, future, future); // touch: mtime changes, size identical
    expect(cache.get(pdf)).toBeUndefined();
  });

  it('misses for a file that no longer exists', () => {
    const dir = tempDir();
    const cache = new PdfTextCache(join(dir, 'cache.json'));
    expect(cache.get(join(dir, 'gone.pdf'))).toBeUndefined();
  });

  it('persists across instances via flush + reload', () => {
    const dir = tempDir();
    const pdf = join(dir, 'a.pdf');
    const cacheFile = join(dir, 'cache.json');
    writeFileSync(pdf, 'hello');
    const c1 = new PdfTextCache(cacheFile);
    c1.set(pdf, 'persisted body');
    c1.flush();
    const c2 = new PdfTextCache(cacheFile);
    expect(c2.get(pdf)).toBe('persisted body');
  });

  it('flush is a no-op when nothing changed', () => {
    const dir = tempDir();
    const cacheFile = join(dir, 'cache.json');
    const cache = new PdfTextCache(cacheFile);
    cache.flush(); // dirty=false → must not create the file
    expect(() => readFileSync(cacheFile)).toThrow();
  });

  it('starts empty when the cache file is corrupt', () => {
    const dir = tempDir();
    const cacheFile = join(dir, 'cache.json');
    writeFileSync(cacheFile, '{ not valid json');
    const pdf = join(dir, 'a.pdf');
    writeFileSync(pdf, 'hello');
    const cache = new PdfTextCache(cacheFile); // must not throw
    expect(cache.get(pdf)).toBeUndefined();
  });
});
