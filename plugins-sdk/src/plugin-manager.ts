/**
 * Plugin manifest + registration model.
 *
 * `definePlugin` is a tiny identity helper that gives plugin authors a typed
 * authoring entry point (and a natural place to hang future validation).
 * `PluginManager` is a minimal-but-real registry that activates and deactivates
 * {@link Plugin}s against a single {@link PluginApi}.
 *
 * Lifecycle contract:
 *   - `register(plugin)` adds it to the registry (idempotent name check).
 *   - `activate(name)` calls `plugin.activate(api)` once; re-activating is a
 *     no-op. Activation may be async (returns a promise the caller can await).
 *   - `deactivate(name)` calls `plugin.deactivate?.()` and marks it inactive.
 *   - `activateAll` / `deactivateAll` fan out over the registry.
 *
 * Kept deliberately small: no sandboxing, dependency graph, or hot-reload — those
 * belong to the host app, not this pure SDK.
 */

import type { PluginApi } from './plugin-api.js';
import type { Plugin } from './types.js';

/**
 * Identity helper for declaring a plugin with full type-checking. Returns the
 * manifest unchanged; exists so authoring code reads `export default
 * definePlugin({ … })` and gets IntelliSense + errors on a malformed manifest.
 */
export function definePlugin(plugin: Plugin): Plugin {
  if (!plugin.name || plugin.name.trim() === '') {
    throw new Error('definePlugin: a non-empty `name` is required');
  }
  if (typeof plugin.activate !== 'function') {
    throw new Error(`definePlugin: plugin "${plugin.name}" must define activate()`);
  }
  return plugin;
}

/**
 * The plugin API version this SDK implements. Bump the MAJOR when a breaking
 * change lands in {@link PluginApi}; a plugin declares the majors it supports via
 * `apiVersion`, and one built for a different major is refused at activation
 * rather than left to fail somewhere deep inside a call it doesn't understand.
 */
export const PLUGIN_API_VERSION = 1;

/**
 * Outcome of a fan-out over the registry. Reported rather than thrown: one
 * plugin's failure must not decide the fate of the others, and the host needs to
 * know which ones are actually live.
 */
export interface PluginBatchResult {
  readonly ok: readonly string[];
  readonly failed: readonly { readonly name: string; readonly error: Error }[];
}

/**
 * Run `fn` over every name, isolating each. `Promise.all` aborts the whole
 * fan-out on the first rejection and leaves the batch half-applied with no
 * record of what succeeded (audit rpt-04 SEV-M4).
 */
async function settleEach(
  names: readonly string[],
  fn: (name: string) => void | Promise<void>,
): Promise<PluginBatchResult> {
  const ok: string[] = [];
  const failed: { name: string; error: Error }[] = [];
  await Promise.all(
    names.map(async (name) => {
      try {
        await fn(name);
        ok.push(name);
      } catch (err) {
        failed.push({ name, error: err instanceof Error ? err : new Error(String(err)) });
      }
    }),
  );
  return { ok, failed };
}

/**
 * Refuse a plugin built against an incompatible major API version. A plugin that
 * declares nothing is assumed to target the current one — `apiVersion` was
 * documented as informational and never checked, so requiring it now would
 * reject every plugin already written.
 */
function assertApiCompatible(plugin: Plugin): void {
  const declared = plugin.apiVersion;
  if (declared === undefined) return;
  if (!Number.isInteger(declared) || declared < 1) {
    throw new Error(`Plugin "${plugin.name}" declares an invalid apiVersion: ${String(declared)}`);
  }
  if (declared !== PLUGIN_API_VERSION) {
    throw new Error(
      `Plugin "${plugin.name}" targets plugin API v${declared}, but this host implements v${PLUGIN_API_VERSION}`,
    );
  }
}

/** Internal registry record tracking a plugin's active state. */
interface Registration {
  readonly plugin: Plugin;
  active: boolean;
}

export class PluginManager {
  private readonly registry = new Map<string, Registration>();

  /**
   * @param api the {@link PluginApi} plugins are activated against. Held for the
   *            manager's lifetime so `activate(name)` needs no extra argument.
   */
  constructor(private readonly api: PluginApi) {}

  /**
   * Register a plugin. Throws if a plugin with the same `name` is already
   * registered (re-registration must go through {@link unregister} first).
   */
  register(plugin: Plugin): void {
    if (this.registry.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    this.registry.set(plugin.name, { plugin, active: false });
  }

  /**
   * Deactivate (if active) and remove a plugin from the registry. Returns the
   * deactivation result (a promise if the plugin's `deactivate` is async), or
   * `undefined` if the plugin was not registered.
   */
  unregister(name: string): void | Promise<void> {
    const reg = this.registry.get(name);
    if (!reg) return;
    const result = reg.active ? this.deactivate(name) : undefined;
    this.registry.delete(name);
    return result;
  }

  /** Names of all registered plugins, in registration order. */
  names(): string[] {
    return [...this.registry.keys()];
  }

  /** Is a plugin registered? */
  isRegistered(name: string): boolean {
    return this.registry.has(name);
  }

  /** Is a plugin currently active? `false` for unknown/registered-but-inactive. */
  isActive(name: string): boolean {
    return this.registry.get(name)?.active ?? false;
  }

  /**
   * Activate a registered plugin: calls `activate(api)` exactly once. Re-
   * activating an already-active plugin is a no-op. Throws if `name` is not
   * registered. Returns the activation result (await it for async `activate`).
   */
  activate(name: string): void | Promise<void> {
    const reg = this.requireReg(name);
    if (reg.active) return;
    assertApiCompatible(reg.plugin);
    reg.active = true;
    try {
      const result = reg.plugin.activate(this.api);
      // An ASYNC activate that rejects must roll back too. Rolling back only in
      // this catch (i.e. only for a synchronous throw) left a plugin marked
      // active despite having failed, and unretryable (audit rpt-04 SEV-M4).
      if (result instanceof Promise) {
        return result.catch((err: unknown) => {
          reg.active = false;
          throw err;
        });
      }
      return result;
    } catch (err) {
      // Activation failed synchronously: roll back the active flag so a retry
      // is possible, and rethrow.
      reg.active = false;
      throw err;
    }
  }

  /**
   * Deactivate an active plugin: calls `deactivate?.()` and marks it inactive.
   * No-op for unknown or already-inactive plugins. Returns the teardown result.
   */
  deactivate(name: string): void | Promise<void> {
    const reg = this.registry.get(name);
    if (!reg || !reg.active) return;
    reg.active = false;
    return reg.plugin.deactivate?.();
  }

  /**
   * Activate every registered (inactive) plugin. Returns a promise that resolves
   * once all activations (sync or async) have settled.
   */
  async activateAll(): Promise<PluginBatchResult> {
    return settleEach(this.names(), (n) => this.activate(n));
  }

  /** Deactivate every active plugin. Resolves once all teardowns have settled. */
  async deactivateAll(): Promise<PluginBatchResult> {
    return settleEach(this.names(), (n) => this.deactivate(n));
  }

  private requireReg(name: string): Registration {
    const reg = this.registry.get(name);
    if (!reg) throw new Error(`Plugin "${name}" is not registered`);
    return reg;
  }
}
