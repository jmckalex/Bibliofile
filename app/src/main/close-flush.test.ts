/**
 * Closing or quitting must not lose the field being typed in.
 *
 * DetailPane commits a field on blur, and the renderer's `beforeunload` flush runs
 * only after main's `close` handler has already decided whether anything is
 * unsaved. So text typed and then closed or ⌘Q'd was dropped with no prompt, or
 * left out of the prompt's Save. Main now asks every window to flush first.
 *
 * The two halves live in different processes and are tied together only by a
 * name, so this pins them by source inspection (no Electron in unit tests).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const main = read('./index.ts');
const entry = read('../renderer/src/main.tsx');

/** The body of the library window's `win.on('close', …)` handler. */
function closeHandler(): string {
  const start = main.indexOf("win.on('close', (e) => {");
  expect(start).toBeGreaterThan(-1);
  const end = main.indexOf("win.on('closed'", start);
  expect(end).toBeGreaterThan(start);
  return main.slice(start, end);
}

describe('close flushes renderer edits before checking for unsaved changes', () => {
  it('main calls the hook the renderer installs, by the same name', () => {
    const called = /executeJavaScript\(\s*'window\.(\w+)\?\.\(\)'/.exec(main)?.[1];
    expect(called).toBe('bibliofileFlushEdits');
    expect(entry).toMatch(new RegExp(`^window\\.${called} = flushPendingEdits;$`, 'm'));
  });

  it('the close handler flushes before it reads the dirty flag', () => {
    const body = closeHandler();
    const flush = body.indexOf('flushRendererEdits()');
    const dirty = body.indexOf('store.isDirty(');
    expect(flush).toBeGreaterThan(-1);
    expect(dirty).toBeGreaterThan(flush);
  });

  it('after flushing it retries the quit, not just the close, when quitting', () => {
    const body = closeHandler();
    const retry = body.slice(body.indexOf('flushRendererEdits()'), body.indexOf('store.isDirty('));
    expect(retry).toMatch(/if \(quitting\) app\.quit\(\);\s*else win\.close\(\);/);
  });
});
