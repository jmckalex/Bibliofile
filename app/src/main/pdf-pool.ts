/**
 * A small pool of worker threads that extract PDF text off the main process, so
 * indexing a library's attachments never freezes the UI and several PDFs run in
 * parallel across cores. Workers are spawned lazily (up to {@link size}) and
 * kept for the session; {@link destroy} terminates them (call on app quit).
 *
 * `extract()` always resolves (empty string on worker error/crash) — a failed
 * extraction must never wedge the queue or reject a caller.
 */

import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';

interface Slot {
  worker: Worker;
  /** The id of the task this worker is currently running, or null when idle. */
  current: number | null;
}

interface QueueItem {
  path: string;
  resolve: (text: string) => void;
}

export class PdfPool {
  private readonly workerPath: string;
  private readonly size: number;
  private slots: Slot[] = [];
  private queue: QueueItem[] = [];
  private pending = new Map<number, (text: string) => void>();
  private nextId = 1;
  private destroyed = false;

  /** @param size max concurrent workers (defaults to cores−1, capped at 4). */
  constructor(workerPath: string, size = Math.max(1, Math.min(4, cpus().length - 1))) {
    this.workerPath = workerPath;
    this.size = size;
  }

  /** Extract text from one PDF; resolves '' on any failure. */
  extract(path: string): Promise<string> {
    if (this.destroyed) return Promise.resolve('');
    return new Promise<string>((resolve) => {
      this.queue.push({ path, resolve });
      this.pump();
    });
  }

  /** Assign queued work to idle workers, spawning up to `size` workers on demand. */
  private pump(): void {
    if (this.destroyed) return;
    while (this.slots.length < this.size && this.queue.length > 0) {
      this.spawn();
    }
    for (const slot of this.slots) {
      if (slot.current !== null) continue;
      const task = this.queue.shift();
      if (!task) break;
      const id = this.nextId++;
      slot.current = id;
      this.pending.set(id, task.resolve);
      slot.worker.postMessage({ id, path: task.path });
    }
  }

  private spawn(): void {
    const worker = new Worker(this.workerPath);
    const slot: Slot = { worker, current: null };
    worker.on('message', (msg: { id: number; text: string }) => {
      this.settle(msg.id, msg.text);
      if (slot.current === msg.id) slot.current = null;
      this.pump();
    });
    // A crashed/exited worker must not strand its in-flight task or the queue.
    const fail = (): void => {
      if (slot.current !== null) {
        this.settle(slot.current, '');
        slot.current = null;
      }
      this.slots = this.slots.filter((s) => s !== slot);
      this.pump(); // a fresh worker will be spawned if work remains
    };
    worker.on('error', fail);
    worker.on('exit', () => {
      if (slot.current !== null || this.slots.includes(slot)) fail();
    });
    this.slots.push(slot);
  }

  private settle(id: number, text: string): void {
    const resolve = this.pending.get(id);
    if (resolve) {
      this.pending.delete(id);
      resolve(text);
    }
  }

  /** Terminate all workers and drain the queue (resolving the rest as ''). */
  async destroy(): Promise<void> {
    this.destroyed = true;
    for (const item of this.queue) item.resolve('');
    this.queue = [];
    for (const [, resolve] of this.pending) resolve('');
    this.pending.clear();
    const slots = this.slots;
    this.slots = [];
    await Promise.all(slots.map((s) => s.worker.terminate()));
  }
}
