/**
 * A tiny, pure-TypeScript synchronous event emitter / observer.
 *
 * This deliberately replaces BibDesk's Cocoa `NSNotificationCenter` +
 * `BDSKBibItemChangedNotification` / `BDSKMacroDefinitionChangedNotification`
 * and KVO, without depending on `node:events` (forbidden — the model must be
 * platform-agnostic). Listeners are invoked synchronously in subscription
 * order; this matches Cocoa's synchronous posting semantics and keeps the
 * (future) undo stack deterministic.
 */

/** A function invoked with an event payload. */
export type Listener<E> = (event: E) => void;

/** Unsubscribe handle returned by {@link Emitter.subscribe}. */
export type Unsubscribe = () => void;

/**
 * Minimal synchronous multicast emitter. Generic over the payload type so each
 * subsystem (item changes, macro changes) gets a strongly-typed channel.
 */
export class Emitter<E> {
  private listeners: Set<Listener<E>> = new Set();

  /** Register `listener`; returns a function that removes it. */
  subscribe(listener: Listener<E>): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Remove a previously-subscribed listener (no-op if not present). */
  unsubscribe(listener: Listener<E>): void {
    this.listeners.delete(listener);
  }

  /** Synchronously deliver `event` to every current listener. */
  emit(event: E): void {
    // Snapshot so a listener that (un)subscribes during dispatch doesn't
    // mutate the set we're iterating.
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  /** Number of currently-registered listeners (mostly for tests). */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Drop all listeners. */
  clear(): void {
    this.listeners.clear();
  }
}
