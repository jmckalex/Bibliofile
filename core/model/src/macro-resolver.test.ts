import { describe, it, expect, vi } from 'vitest';
import { MacroResolver, buildMonthMacros, type MacroChangeEvent } from './macro-resolver.js';
import { complexValue, macroNode, stringNode } from './complex-value.js';

describe('buildMonthMacros', () => {
  it('produces 12 abbreviations mapping to full month names (en-US)', () => {
    const m = buildMonthMacros('en-US');
    expect(Object.keys(m)).toHaveLength(12);
    expect(m['jan']).toBe('January');
    expect(m['dec']).toBe('December');
    expect(m['jun']).toBe('June');
  });
});

describe('MacroResolver — basic define/resolve', () => {
  it('defines and resolves a simple macro', () => {
    const r = new MacroResolver('document');
    r.define('pub', 'My Publisher');
    expect(r.resolve('pub')).toBe('My Publisher');
    expect(r.isDefined('pub')).toBe(true);
  });

  it('macro keys are case-insensitive', () => {
    const r = new MacroResolver('document');
    r.define('Pub', 'X');
    expect(r.resolve('pub')).toBe('X');
    expect(r.resolve('PUB')).toBe('X');
    expect(r.isDefinedLocally('pUb')).toBe(true);
  });

  it('undefine removes a macro', () => {
    const r = new MacroResolver('document');
    r.define('a', 'b');
    r.undefine('A');
    expect(r.isDefined('a')).toBe(false);
  });

  it('rename preserves the definition', () => {
    const r = new MacroResolver('document');
    r.define('old', 'val');
    r.rename('old', 'new');
    expect(r.isDefined('old')).toBe(false);
    expect(r.resolve('new')).toBe('val');
  });

  it('rename to an existing name throws', () => {
    const r = new MacroResolver('document');
    r.define('a', '1');
    r.define('b', '2');
    expect(() => r.rename('a', 'b')).toThrow();
  });
});

describe('MacroResolver — 3-tier resolution & override', () => {
  it('document overrides file overrides global', () => {
    const doc = MacroResolver.createStandardStack('en-US');
    const file = doc.parent!;
    const global = file.parent!;
    expect(global.tier).toBe('global');

    // global has months
    expect(doc.resolve('jan')).toBe('January');

    // file overrides global
    file.define('jan', 'FileJan');
    expect(doc.resolve('jan')).toBe('FileJan');

    // document overrides file
    doc.define('jan', 'DocJan');
    expect(doc.resolve('jan')).toBe('DocJan');

    // file-only macro is visible from document
    file.define('series', 'LNCS');
    expect(doc.resolve('series')).toBe('LNCS');
  });

  it('definitionOf walks parent tiers', () => {
    const doc = MacroResolver.createStandardStack();
    expect(doc.definitionOf('feb')).toBeDefined();
    expect(doc.definitionOf('nonexistent')).toBeUndefined();
  });
});

describe('MacroResolver — nested macros & expansion', () => {
  it('expands a macro defined in terms of another (same tier)', () => {
    const r = new MacroResolver('document');
    r.define('first', 'Hello');
    r.define('greet', complexValue([macroNode('first'), stringNode(' World')]));
    expect(r.resolve('greet')).toBe('Hello World');
  });

  it('expand() resolves an arbitrary complex value', () => {
    const r = MacroResolver.createStandardStack('en-US');
    const v = complexValue([macroNode('jan'), stringNode('/'), macroNode('feb')]);
    expect(r.expand(v)).toBe('January/February');
  });
});

describe('MacroResolver — cycle detection', () => {
  it('throws when defining would create a direct cycle', () => {
    const r = new MacroResolver('document');
    r.define('a', complexValue([macroNode('b')]));
    expect(() => r.define('b', complexValue([macroNode('a')]))).toThrow();
  });

  it('throws on self-reference', () => {
    const r = new MacroResolver('document');
    expect(() => r.define('a', complexValue([macroNode('a')]))).toThrow();
  });

  it('allows a non-cyclic chain', () => {
    const r = new MacroResolver('document');
    r.define('a', 'leaf');
    expect(() => r.define('b', complexValue([macroNode('a')]))).not.toThrow();
    expect(() => r.define('c', complexValue([macroNode('b')]))).not.toThrow();
  });
});

describe('MacroResolver — modification counter & events', () => {
  it('bumps modification on each change', () => {
    const r = new MacroResolver('document');
    const m0 = r.modification;
    r.define('a', '1');
    const m1 = r.modification;
    expect(m1).toBeGreaterThan(m0);
    r.define('a', '2');
    expect(r.modification).toBeGreaterThan(m1);
    r.undefine('a');
    expect(r.modification).toBeGreaterThan(m1 + 1);
  });

  it('emits add/change/remove/rename events with payload', () => {
    const r = new MacroResolver('document');
    const events: MacroChangeEvent[] = [];
    r.subscribe((e) => events.push(e));

    r.define('a', '1');
    r.define('a', '2');
    r.rename('a', 'b');
    r.undefine('b');

    expect(events.map((e) => e.type)).toEqual([
      'add',
      'change',
      'rename',
      'remove',
    ]);
    expect(events[0]!.macro).toBe('a');
    expect(events[0]!.newValue).toBe('1');
    expect(events[1]!.oldValue).toBe('1');
    expect(events[1]!.newValue).toBe('2');
    expect(events[2]!.oldMacro).toBe('a');
    expect(events[2]!.newMacro).toBe('b');
    expect(events[3]!.macro).toBe('b');
  });

  it('setAll emits a single set event', () => {
    const r = new MacroResolver('file');
    const spy = vi.fn();
    r.subscribe(spy);
    r.setAll([
      ['x', '1'],
      ['y', '2'],
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].type).toBe('set');
    expect(r.resolve('x')).toBe('1');
  });
});

describe('MacroResolver — topological ordering for serialization', () => {
  it('orders dependencies before dependents', () => {
    const r = new MacroResolver('document');
    // define out of order: greet depends on first
    r.define('greet', complexValue([macroNode('first'), stringNode('!')]));
    r.define('first', 'Hi');
    const ordered = r.orderedLocalDefinitions().map((d) => d.name);
    expect(ordered.indexOf('first')).toBeLessThan(ordered.indexOf('greet'));
  });

  it('ties break alphabetically among independent macros', () => {
    const r = new MacroResolver('document');
    r.define('zeta', '1');
    r.define('alpha', '2');
    const ordered = r.orderedLocalDefinitions().map((d) => d.name);
    expect(ordered).toEqual(['alpha', 'zeta']);
  });
});
