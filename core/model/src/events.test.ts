import { describe, it, expect, vi } from 'vitest';
import { Emitter } from './events.js';

describe('Emitter', () => {
  it('delivers events to subscribers synchronously', () => {
    const e = new Emitter<number>();
    const seen: number[] = [];
    e.subscribe((n) => seen.push(n));
    e.emit(1);
    e.emit(2);
    expect(seen).toEqual([1, 2]);
  });

  it('unsubscribe stops delivery', () => {
    const e = new Emitter<string>();
    const spy = vi.fn();
    const off = e.subscribe(spy);
    e.emit('a');
    off();
    e.emit('b');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('listenerCount and clear work', () => {
    const e = new Emitter<void>();
    e.subscribe(() => {});
    e.subscribe(() => {});
    expect(e.listenerCount).toBe(2);
    e.clear();
    expect(e.listenerCount).toBe(0);
  });

  it('mutating subscribers during dispatch is safe', () => {
    const e = new Emitter<number>();
    const seen: number[] = [];
    e.subscribe((n) => {
      seen.push(n);
      // subscribe a new listener mid-dispatch; should not be called this round
      e.subscribe(() => seen.push(-1));
    });
    e.emit(1);
    expect(seen).toEqual([1]);
    e.emit(2);
    // now the previously-added listener(s) fire too
    expect(seen).toContain(2);
    expect(seen).toContain(-1);
  });
});
