/**
 * Tests for {@link definePlugin} and {@link PluginManager} — registration,
 * activation/deactivation lifecycle (sync + async), idempotence, error handling,
 * and that an activated plugin can actually drive the {@link PluginApi}.
 */

import { describe, it, expect, vi } from 'vitest';
import { parse } from '@bibdesk/bibtex';
import { createPluginApi, type PluginApi } from './plugin-api.js';
import { definePlugin, PluginManager } from './plugin-manager.js';
import type { Plugin } from './types.js';

function makeApi(): PluginApi {
  return createPluginApi(parse('@article{a, Title = {T}, Year = {2000}}\n'));
}

describe('definePlugin', () => {
  it('returns the manifest unchanged for a valid plugin', () => {
    const p = definePlugin({ name: 'x', version: '1.0.0', activate() {} });
    expect(p.name).toBe('x');
    expect(typeof p.activate).toBe('function');
  });

  it('throws on a missing name or missing activate', () => {
    expect(() => definePlugin({ name: '', version: '1', activate() {} })).toThrow(
      /name/,
    );
    expect(() =>
      definePlugin({ name: 'y', version: '1' } as unknown as Plugin),
    ).toThrow(/activate/);
  });
});

describe('PluginManager — registration', () => {
  it('registers, lists, and reports registration state', () => {
    const m = new PluginManager(makeApi());
    expect(m.isRegistered('p')).toBe(false);
    m.register({ name: 'p', version: '1', activate() {} });
    expect(m.isRegistered('p')).toBe(true);
    expect(m.names()).toEqual(['p']);
  });

  it('rejects duplicate registration', () => {
    const m = new PluginManager(makeApi());
    m.register({ name: 'p', version: '1', activate() {} });
    expect(() => m.register({ name: 'p', version: '2', activate() {} })).toThrow(
      /already registered/,
    );
  });

  it('unregister deactivates first and removes the plugin', () => {
    const m = new PluginManager(makeApi());
    const deactivate = vi.fn();
    m.register({ name: 'p', version: '1', activate() {}, deactivate });
    m.activate('p');
    m.unregister('p');
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(m.isRegistered('p')).toBe(false);
    // unregistering an unknown plugin is a no-op
    expect(() => m.unregister('ghost')).not.toThrow();
  });
});

describe('PluginManager — activation lifecycle', () => {
  it('activates a plugin once with the api and tracks active state', () => {
    const api = makeApi();
    const m = new PluginManager(api);
    const activate = vi.fn();
    m.register({ name: 'p', version: '1', activate });
    expect(m.isActive('p')).toBe(false);
    m.activate('p');
    expect(m.isActive('p')).toBe(true);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith(api);
    // re-activating is a no-op
    m.activate('p');
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('deactivates an active plugin and is idempotent', () => {
    const m = new PluginManager(makeApi());
    const deactivate = vi.fn();
    m.register({ name: 'p', version: '1', activate() {}, deactivate });
    m.activate('p');
    m.deactivate('p');
    expect(m.isActive('p')).toBe(false);
    expect(deactivate).toHaveBeenCalledTimes(1);
    // deactivating again is a no-op
    m.deactivate('p');
    expect(deactivate).toHaveBeenCalledTimes(1);
    // deactivating unknown is a no-op
    expect(() => m.deactivate('ghost')).not.toThrow();
  });

  it('throws when activating an unregistered plugin', () => {
    const m = new PluginManager(makeApi());
    expect(() => m.activate('nope')).toThrow(/not registered/);
  });

  it('rolls back active state if activate() throws', () => {
    const m = new PluginManager(makeApi());
    m.register({
      name: 'boom',
      version: '1',
      activate() {
        throw new Error('kaboom');
      },
    });
    expect(() => m.activate('boom')).toThrow(/kaboom/);
    expect(m.isActive('boom')).toBe(false);
  });

  it('supports async activate/deactivate', async () => {
    const m = new PluginManager(makeApi());
    const order: string[] = [];
    m.register({
      name: 'p',
      version: '1',
      async activate() {
        order.push('activate');
      },
      async deactivate() {
        order.push('deactivate');
      },
    });
    await m.activate('p');
    await m.deactivate('p');
    expect(order).toEqual(['activate', 'deactivate']);
  });

  it('activateAll / deactivateAll fan out over the registry', async () => {
    const m = new PluginManager(makeApi());
    const a1 = vi.fn();
    const a2 = vi.fn();
    m.register({ name: 'one', version: '1', activate: a1 });
    m.register({ name: 'two', version: '1', activate: a2 });
    await m.activateAll();
    expect(a1).toHaveBeenCalledTimes(1);
    expect(a2).toHaveBeenCalledTimes(1);
    expect(m.isActive('one') && m.isActive('two')).toBe(true);
    await m.deactivateAll();
    expect(m.isActive('one') || m.isActive('two')).toBe(false);
  });
});

describe('PluginManager — end-to-end with the API', () => {
  it('an activated plugin can mutate the library through the api', () => {
    const api = makeApi();
    const m = new PluginManager(api);
    const plugin = definePlugin({
      name: 'stamp-notes',
      version: '1.0.0',
      description: 'Adds a Note to every entry on activation.',
      activate(a) {
        for (const e of a.entries()) {
          a.setField(e.id, 'Note', 'reviewed');
        }
      },
    });
    m.register(plugin);
    m.activate('stamp-notes');
    expect(api.getByCiteKey('a')!.field('Note')).toBe('reviewed');
    expect(api.toBibTeX()).toContain('note = {reviewed}');
  });

  it('a plugin can subscribe to change events and tear down on deactivate', () => {
    const api = makeApi();
    const m = new PluginManager(api);
    const seen: string[] = [];
    let off: (() => void) | undefined;
    m.register({
      name: 'watcher',
      version: '1',
      activate(a) {
        off = a.onChange((e) => seen.push(e.kind));
      },
      deactivate() {
        off?.();
      },
    });
    m.activate('watcher');
    api.addEntry({ type: 'misc', fields: { Title: 'New' } });
    expect(seen).toEqual(['addEntry']);
    m.deactivate('watcher');
    api.addEntry({ type: 'misc', fields: { Title: 'Another' } });
    expect(seen).toEqual(['addEntry']); // no new events after teardown
  });
});
