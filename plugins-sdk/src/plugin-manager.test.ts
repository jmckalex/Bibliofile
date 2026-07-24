/**
 * Tests for {@link definePlugin} and {@link PluginManager} — registration,
 * activation/deactivation lifecycle (sync + async), idempotence, error handling,
 * and that an activated plugin can actually drive the {@link PluginApi}.
 */

import { describe, it, expect, vi } from 'vitest';
import { parse } from '@bibdesk/bibtex';
import { createPluginApi, type PluginApi } from './plugin-api.js';
import { definePlugin, PluginManager, PLUGIN_API_VERSION } from './plugin-manager.js';
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

/** A minimal manifest with an activate() the test controls. */
function plug(name: string, over: Partial<Plugin> = {}): Plugin {
  return definePlugin({ name, version: '1.0.0', activate: () => {}, ...over } as Plugin);
}

describe('plugin isolation and the API version gate (audit rpt-04 SEV-M4)', () => {
  function mgr(): { m: PluginManager; api: PluginApi } {
    const api = createPluginApi(parse('@misc{a, Title = {A}}'));
    return { m: new PluginManager(api), api };
  }

  it('rolls back `active` when an ASYNC activate rejects', async () => {
    const { m } = mgr();
    m.register(plug('flaky', { activate: () => Promise.reject(new Error('nope')) }));
    await expect(m.activate('flaky')).rejects.toThrow('nope');
    // Previously only a SYNCHRONOUS throw rolled back, so a rejected async
    // activate left the plugin marked active — failed, yet unretryable.
    expect(m.isActive('flaky')).toBe(false);
  });

  it('activateAll isolates failures and reports which plugins are live', async () => {
    const { m } = mgr();
    m.register(plug('good1'));
    m.register(plug('bad', { activate: () => Promise.reject(new Error('boom')) }));
    m.register(plug('good2'));

    const res = await m.activateAll();

    // Promise.all would have aborted the fan-out on 'bad' and left the batch
    // half-applied with no record of what succeeded.
    expect([...res.ok].sort()).toEqual(['good1', 'good2']);
    expect(res.failed.map((f) => f.name)).toEqual(['bad']);
    expect(res.failed[0]!.error.message).toBe('boom');
    expect(m.isActive('good1')).toBe(true);
    expect(m.isActive('good2')).toBe(true);
    expect(m.isActive('bad')).toBe(false);
  });

  it('deactivateAll isolates a throwing teardown', async () => {
    const { m } = mgr();
    m.register(plug('ok'));
    m.register(plug('rude', { deactivate: () => { throw new Error('teardown'); } }));
    await m.activateAll();

    const res = await m.deactivateAll();
    expect(res.failed.map((f) => f.name)).toEqual(['rude']);
    expect(m.isActive('ok')).toBe(false); // the good one still tore down
  });

  it('refuses a plugin built against a different major API version', () => {
    const { m } = mgr();
    m.register(plug('future', { apiVersion: PLUGIN_API_VERSION + 1 }));
    expect(() => m.activate('future')).toThrow(/plugin API v/);
    expect(m.isActive('future')).toBe(false);
  });

  it('accepts a matching apiVersion, and one that declares none', () => {
    const { m } = mgr();
    m.register(plug('current', { apiVersion: PLUGIN_API_VERSION }));
    m.register(plug('legacy')); // written before apiVersion existed
    m.activate('current');
    m.activate('legacy');
    expect(m.isActive('current')).toBe(true);
    expect(m.isActive('legacy')).toBe(true);
  });

  it('rejects a nonsense apiVersion rather than coercing it', () => {
    const { m } = mgr();
    m.register(plug('junk', { apiVersion: 0 }));
    expect(() => m.activate('junk')).toThrow(/invalid apiVersion/);
  });

  it('a throwing change listener cannot break the mutation that emitted it', () => {
    const { m, api } = mgr();
    const seen: string[] = [];
    m.register(
      plug('rude', {
        activate: (a: PluginApi) => {
          a.onChange(() => { throw new Error('listener exploded'); });
          a.onChange((e) => seen.push(e.kind));
        },
      }),
    );
    m.activate('rude');

    // The mutation must complete, and the well-behaved listener must still run.
    expect(() => api.addEntry({ type: 'misc', fields: { Title: 'New' } })).not.toThrow();
    expect(seen).toEqual(['addEntry']);
  });
});
