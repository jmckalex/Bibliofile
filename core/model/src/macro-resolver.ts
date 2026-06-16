/**
 * Macro (`@string`) resolution — the TypeScript port of BibDesk's
 * `BDSKMacroResolver` / `BDSKGlobalMacroResolver`.
 *
 * Responsibilities:
 *   - Store macro name -> {@link FieldValue} definitions with **case-insensitive
 *     keys** (BibDesk uses a case-insensitive `NSMapTable`).
 *   - Provide **3-tier resolution** with more-specific tiers overriding less:
 *     `document` (most specific) overrides `file` (`@string` in the file)
 *     overrides `global` built-ins (month abbreviations `jan`..`dec`).
 *   - Expose a **modification counter** that bumps on every change, and emit
 *     **change events** (add/remove/change/rename/set) so caches and the UI can
 *     invalidate (replaces `BDSKMacroDefinitionChangedNotification`).
 *   - Provide a **topologically ordered** enumeration so a serializer writes
 *     macros after the macros they depend on, and **detect cycles**.
 */

import { Emitter, type Listener, type Unsubscribe } from './events.js';
import {
  type FieldValue,
  type MacroLookup,
  expandComplexValue,
  isComplex,
} from './complex-value.js';

/** Which scope a resolver layer represents. */
export type MacroTier = 'global' | 'file' | 'document';

/** Kind of macro change, mirroring BibDesk's `BDSKMacroResolver*Type`. */
export type MacroChangeType = 'add' | 'remove' | 'change' | 'rename' | 'set';

/**
 * Payload emitted on a macro change. Carries enough for caches/UI/undo to react
 * (mirrors BibDesk's notification userInfo).
 */
export interface MacroChangeEvent {
  readonly type: MacroChangeType;
  /** The resolver that changed. */
  readonly resolver: MacroResolver;
  /** Affected macro name (for add/remove/change). */
  readonly macro?: string;
  /** Old name (for rename). */
  readonly oldMacro?: string;
  /** New name (for rename). */
  readonly newMacro?: string;
  /** Previous definition (for change/remove/rename), if any. */
  readonly oldValue?: FieldValue;
  /** New definition (for add/change/rename), if any. */
  readonly newValue?: FieldValue;
}

/**
 * Build the 12 built-in month macros (`jan`..`dec`).
 *
 * BibDesk maps the abbreviations to the locale's *full* standalone month names
 * via `NSDateFormatter standaloneMonthSymbols` (so `jan` expands to "January"
 * in an English locale). We reproduce that with the cross-platform
 * `Intl.DateTimeFormat`, falling back to hard-coded English names if `Intl`
 * month formatting is unavailable.
 */
export function buildMonthMacros(
  locale: string = 'en-US',
): Record<string, string> {
  const abbrevs = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ];
  const names = monthNames(locale);
  const out: Record<string, string> = {};
  for (let i = 0; i < 12; i++) {
    out[abbrevs[i]!] = names[i]!;
  }
  return out;
}

const ENGLISH_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function monthNames(locale: string): string[] {
  try {
    const fmt = new Intl.DateTimeFormat(locale, {
      month: 'long',
      timeZone: 'UTC',
    });
    const out: string[] = [];
    for (let m = 0; m < 12; m++) {
      // Use the 15th to avoid any timezone roll-over.
      out.push(fmt.format(new Date(Date.UTC(2001, m, 15))));
    }
    // Sanity check: 12 distinct, non-empty names.
    if (out.every((n) => n.length > 0)) return out;
  } catch {
    /* fall through */
  }
  return [...ENGLISH_MONTHS];
}

/**
 * A single resolver tier. Stores its own definitions and points (optionally) at
 * a less-specific `parent` tier for fallthrough resolution.
 *
 * A typical document setup:
 *   global (built-in months)  <- file (@string)  <- document (user macros)
 * where lookups walk document -> file -> global, and the most specific
 * definition wins.
 */
export class MacroResolver implements MacroLookup {
  /** Lowercased-name -> { displayName, value }. */
  private readonly defs = new Map<string, { name: string; value: FieldValue }>();
  private readonly emitter = new Emitter<MacroChangeEvent>();
  private _modification = 0;
  /** Less-specific tier consulted when this tier lacks a definition. */
  readonly parent: MacroResolver | undefined;
  readonly tier: MacroTier;

  constructor(tier: MacroTier = 'document', parent?: MacroResolver) {
    this.tier = tier;
    this.parent = parent;
  }

  /**
   * Build the standard 3-tier stack: a `global` resolver pre-loaded with month
   * built-ins, a `file` resolver, and a `document` resolver (returned). Walk
   * `.parent` to reach the lower tiers.
   */
  static createStandardStack(locale?: string): MacroResolver {
    const global = new MacroResolver('global');
    const months = buildMonthMacros(locale);
    for (const [name, value] of Object.entries(months)) {
      global.defineSilently(name, value);
    }
    const file = new MacroResolver('file', global);
    const document = new MacroResolver('document', file);
    return document;
  }

  /** Monotonically increasing counter; bumps on any change in this tier. */
  get modification(): number {
    return this._modification;
  }

  /** Subscribe to change events on this tier. */
  subscribe(listener: Listener<MacroChangeEvent>): Unsubscribe {
    return this.emitter.subscribe(listener);
  }

  // --- definition (mutation) -------------------------------------------------

  /**
   * Define or replace a macro. Emits `add` (new) or `change` (replacement) and
   * bumps the modification counter. Throws if defining the macro would create a
   * dependency cycle within this tier's reachable definitions.
   */
  define(name: string, value: FieldValue): void {
    const key = name.toLowerCase();
    if (this.wouldCycle(key, value)) {
      throw new Error(`Defining macro "${name}" would create a cycle`);
    }
    const existing = this.defs.get(key);
    this.defs.set(key, { name, value });
    this.bump();
    this.emitter.emit({
      type: existing ? 'change' : 'add',
      resolver: this,
      macro: name,
      oldValue: existing?.value,
      newValue: value,
    });
  }

  /** Define without emitting or bumping (used to seed built-ins). */
  private defineSilently(name: string, value: FieldValue): void {
    this.defs.set(name.toLowerCase(), { name, value });
  }

  /** Remove a macro. No-op (no event) if it is not defined in this tier. */
  undefine(name: string): void {
    const key = name.toLowerCase();
    const existing = this.defs.get(key);
    if (!existing) return;
    this.defs.delete(key);
    this.bump();
    this.emitter.emit({
      type: 'remove',
      resolver: this,
      macro: existing.name,
      oldValue: existing.value,
    });
  }

  /**
   * Rename a macro (preserving its definition). Throws if `oldName` is not
   * defined or `newName` already exists. Emits `rename`.
   */
  rename(oldName: string, newName: string): void {
    const oldKey = oldName.toLowerCase();
    const newKey = newName.toLowerCase();
    const existing = this.defs.get(oldKey);
    if (!existing) throw new Error(`Macro "${oldName}" is not defined`);
    if (oldKey !== newKey && this.defs.has(newKey)) {
      throw new Error(`Macro "${newName}" already exists`);
    }
    this.defs.delete(oldKey);
    this.defs.set(newKey, { name: newName, value: existing.value });
    this.bump();
    this.emitter.emit({
      type: 'rename',
      resolver: this,
      oldMacro: oldName,
      newMacro: newName,
      oldValue: existing.value,
      newValue: existing.value,
    });
  }

  /**
   * Replace ALL definitions in this tier wholesale (e.g. when loading a file's
   * `@string`s). Emits a single `set` event.
   */
  setAll(entries: Iterable<readonly [string, FieldValue]>): void {
    this.defs.clear();
    for (const [name, value] of entries) {
      this.defs.set(name.toLowerCase(), { name, value });
    }
    this.bump();
    this.emitter.emit({ type: 'set', resolver: this });
  }

  // --- resolution (read) -----------------------------------------------------

  /**
   * The raw definition for `name` in this tier *or any less-specific parent
   * tier* (case-insensitive). This is what {@link MacroLookup} needs for
   * expansion. Returns `undefined` if undefined at every reachable tier.
   */
  definitionOf(name: string): FieldValue | undefined {
    const local = this.defs.get(name.toLowerCase());
    if (local) return local.value;
    return this.parent?.definitionOf(name);
  }

  /** Is `name` defined at this tier or any parent (case-insensitive)? */
  isDefined(name: string): boolean {
    return this.definitionOf(name) !== undefined;
  }

  /** Is `name` defined *in this tier specifically* (ignoring parents)? */
  isDefinedLocally(name: string): boolean {
    return this.defs.has(name.toLowerCase());
  }

  /**
   * Resolve `name` to its fully-expanded display string, or `undefined` if
   * undefined. Resolution honors tier precedence and recursively expands nested
   * macros (cycle-safe).
   */
  resolve(name: string): string | undefined {
    const def = this.definitionOf(name);
    if (def === undefined) return undefined;
    return expandComplexValue(def, this);
  }

  /** Expand an arbitrary {@link FieldValue} against this resolver. */
  expand(value: FieldValue): string {
    return expandComplexValue(value, this);
  }

  // --- enumeration -----------------------------------------------------------

  /**
   * All macro names defined *locally in this tier*, with their original casing.
   */
  localMacroNames(): string[] {
    return [...this.defs.values()].map((d) => d.name);
  }

  /**
   * Local definitions of this tier, **topologically ordered** so that any macro
   * whose definition references another local macro comes *after* its
   * dependencies. Matches `BDSKMacroResolver bibTeXString` ordering, which a
   * serializer needs (BibTeX requires dependencies first). Within independent
   * macros, ties break alphabetically (case-insensitive) for stable output.
   *
   * Cross-tier references (e.g. a document macro using a file macro) are not
   * reordered — only this tier's macros participate, matching BibDesk.
   */
  orderedLocalDefinitions(): { name: string; value: FieldValue }[] {
    const byKey = this.defs;
    const sortedKeys = [...byKey.keys()].sort((a, b) => {
      const na = byKey.get(a)!.name;
      const nb = byKey.get(b)!.name;
      return na.toLowerCase() < nb.toLowerCase()
        ? -1
        : na.toLowerCase() > nb.toLowerCase()
          ? 1
          : 0;
    });
    const ordered: string[] = [];
    const placed = new Set<string>();
    const visiting = new Set<string>();
    const visit = (key: string): void => {
      if (placed.has(key) || visiting.has(key)) return;
      const entry = byKey.get(key);
      if (!entry) return;
      visiting.add(key);
      if (isComplex(entry.value)) {
        for (const node of entry.value.nodes) {
          if (node.type === 'macro') {
            const dep = node.value.toLowerCase();
            if (byKey.has(dep)) visit(dep);
          }
        }
      }
      visiting.delete(key);
      placed.add(key);
      ordered.push(key);
    };
    for (const key of sortedKeys) visit(key);
    return ordered.map((k) => {
      const e = byKey.get(k)!;
      return { name: e.name, value: e.value };
    });
  }

  // --- internals -------------------------------------------------------------

  private bump(): void {
    this._modification += 1;
  }

  /**
   * Detect whether defining `key` := `value` would create a cycle among this
   * tier's local macros (e.g. `a = b`, `b = a`). We walk the dependency graph
   * from `value`'s macro references; if we can reach `key`, it's a cycle.
   */
  private wouldCycle(key: string, value: FieldValue): boolean {
    if (!isComplex(value)) return false;
    const seen = new Set<string>();
    const stack: string[] = [];
    for (const node of value.nodes) {
      if (node.type === 'macro') stack.push(node.value.toLowerCase());
    }
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cur === key) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const def = this.defs.get(cur)?.value;
      if (def && isComplex(def)) {
        for (const node of def.nodes) {
          if (node.type === 'macro') stack.push(node.value.toLowerCase());
        }
      }
    }
    return false;
  }
}
