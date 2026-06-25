/**
 * Synchronous HTTP for the scripting host's `bibliofile.fetch`.
 *
 * The script API is synchronous (it runs in a `node:vm` and blocks), so we can't
 * `await`. We run the async `fetch` on a worker thread and block the main thread
 * on `Atomics.wait` until it finishes. Crucially the result is passed back through
 * a `SharedArrayBuffer` (NOT `postMessage`): `Atomics.wait` parks the main thread,
 * so its event loop can't run message callbacks — but a SharedArrayBuffer write +
 * `Atomics.notify` wakes it directly. The worker JSON-encodes `{status,headers,
 * text}` into the buffer; a per-call timeout bounds a hung request.
 *
 * Main-process only (uses worker_threads). User-invoked, so blocking is acceptable.
 */

import { Worker } from 'node:worker_threads';

/** Max response size we can carry back through the shared buffer (8 MiB). */
const CAP = 8 * 1024 * 1024;

export interface SyncFetchOptions {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export interface SyncFetchResult {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly text: string;
}

const WORKER = `
const { workerData } = require('worker_threads');
const { sab, url, opts, cap } = workerData;
const ctrl = new Int32Array(sab, 0, 2);   // [done, byteLength]
const bytes = new Uint8Array(sab, 8);
function finish(obj) {
  let out = new TextEncoder().encode(JSON.stringify(obj));
  if (out.length > cap) out = new TextEncoder().encode(JSON.stringify({ ok: false, error: 'response too large (> ' + cap + ' bytes)' }));
  bytes.set(out);
  Atomics.store(ctrl, 1, out.length);
  Atomics.store(ctrl, 0, 1);
  Atomics.notify(ctrl, 0);
}
(async () => {
  try {
    const res = await fetch(url, { method: opts.method, headers: opts.headers, body: opts.body });
    const text = await res.text();
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    finish({ ok: true, status: res.status, headers, text });
  } catch (e) {
    finish({ ok: false, error: String((e && e.message) || e) });
  }
})();
`;

/** Perform a blocking HTTP request. Throws on network error or timeout. */
export function syncFetch(url: string, opts: SyncFetchOptions = {}, timeoutMs = 8000): SyncFetchResult {
  const sab = new SharedArrayBuffer(8 + CAP);
  const ctrl = new Int32Array(sab, 0, 2);
  const bytes = new Uint8Array(sab, 8);
  const worker = new Worker(WORKER, {
    eval: true,
    workerData: { sab, url, opts: { method: opts.method, headers: opts.headers, body: opts.body }, cap: CAP },
  });
  try {
    const waited = Atomics.wait(ctrl, 0, 0, timeoutMs);
    if (waited === 'timed-out' || Atomics.load(ctrl, 0) !== 1) {
      throw new Error(`fetch timed out after ${timeoutMs}ms: ${url}`);
    }
    const len = Atomics.load(ctrl, 1);
    const msg = JSON.parse(new TextDecoder().decode(bytes.subarray(0, len))) as
      | { ok: true; status: number; headers: Record<string, string>; text: string }
      | { ok: false; error: string };
    if (!msg.ok) throw new Error(`fetch failed: ${msg.error}`);
    return { status: msg.status, headers: msg.headers, text: msg.text };
  } finally {
    void worker.terminate();
  }
}
