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

  /**
   * Synchronously deliver `event` to every current listener.
   *
   * A listener that throws is isolated: the remaining listeners still receive
   * the event and the exception does not escape into the mutation that emitted
   * it. Without this one bad subscriber — a plugin's `onChange`, say — aborts an
   * edit halfway through and takes unrelated listeners down with it
   * (audit rpt-04 SEV-M4).
   */
  emit(event: E): void {
    // Snapshot so a listener that (un)subscribes during dispatch doesn't
    // mutate the set we're iterating.
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (err) {
        // Report and carry on: emit() is called from inside model mutations,
        // which must stay consistent regardless of who is listening.
        console.error('[events] listener threw; continuing', err);
      }
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
