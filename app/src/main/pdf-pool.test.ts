import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { PdfPool } from './pdf-pool';

const WORKER = fileURLToPath(new URL('./__fixtures__/echo-worker.mjs', import.meta.url));

let pool: PdfPool | undefined;
afterEach(async () => {
  await pool?.destroy();
  pool = undefined;
});

describe('PdfPool', () => {
  it('extracts via a worker and returns its result', async () => {
    pool = new PdfPool(WORKER, 2);
    expect(await pool.extract('/docs/a.pdf')).toBe('TEXT:/docs/a.pdf');
  });

  it('runs many tasks concurrently and resolves each to its own result', async () => {
    pool = new PdfPool(WORKER, 3);
    const paths = Array.from({ length: 12 }, (_, i) => `/docs/file-${i}.pdf`);
    const results = await Promise.all(paths.map((p) => pool!.extract(p)));
    expect(results).toEqual(paths.map((p) => `TEXT:${p}`));
  });

  it('resolves to "" when a worker crashes, and keeps serving later tasks', async () => {
    pool = new PdfPool(WORKER, 1); // single worker so the crash + respawn is observable
    expect(await pool.extract('__throw__')).toBe('');
    // The pool respawns; subsequent work still succeeds.
    expect(await pool.extract('/docs/after.pdf')).toBe('TEXT:/docs/after.pdf');
  });

  it('resolves outstanding work as "" after destroy()', async () => {
    pool = new PdfPool(WORKER, 2);
    await pool.destroy();
    expect(await pool.extract('/docs/late.pdf')).toBe('');
  });
});
