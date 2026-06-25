/**
 * JavaScript scripting host — runs user-authored scripts against the open library
 * with an ergonomic, synchronous `bibliofile` API. The powerful, cross-platform
 * successor to the macOS-only AppleScript interface (`scripting.ts`).
 *
 * Scripts run in a `node:vm` context in the MAIN process (where `DocumentStore`
 * lives), so the API is synchronous and has the app's full capabilities. Every
 * mutation routes through `DocumentStore` — so undo, FTS reindex, crossref
 * cascades, and the Annote/Abstract codecs all keep working — and a whole run is
 * ONE undo step (`store.runInUndoGroup`). The API object graph mirrors the
 * `@bibdesk/plugins-sdk` PluginApi/Entry naming and the AppleScript object model.
 *
 * TRUST MODEL: `node:vm` is scope isolation, NOT a security sandbox — a determined
 * malicious script can escape to full Node/OS. That's acceptable here because
 * scripts are user-authored and explicitly invoked (the same trust level as
 * AppleScript or a shell command). We expose only a curated global (no
 * `require`/`process`/`module`/timers) to prevent ACCIDENTS, not attacks.
 *
 * This module is electron-free and unit-testable with a real `DocumentStore`.
 */

import { createContext, Script } from 'node:vm';
import { detexify } from '@bibdesk/tex';
import type { ExportFormat } from '@bibdesk/shared';
import type { DocumentStore } from './document-service.js';
import { cslBibliography, cslCitation } from './csl-format.js';

/** Options for CSL-formatted citation output. */
interface CiteOptions {
  /** A CSL style id (e.g. 'apa', 'vancouver', an installed style); default = the document's. */
  readonly style?: string;
  /** `'text'` (default) or `'html'`. */
  readonly format?: 'text' | 'html';
}

// --- onChange hooks ---------------------------------------------------------
// Scripts can register `bibliofile.onChange(fn)` handlers that persist past the
// run and fire on later document mutations. To stay bounded + leak-free: a run
// REPLACES the document's hooks (the latest run's hooks win; cleared on close
// too), each hook fires in its own undo group + try/catch, and a re-entrancy
// guard stops a hook's own edits from re-firing hooks. Hooks run with the app's
// trust (no timeout) — a hook must not block; document accordingly.

interface Hook {
  readonly store: DocumentStore;
  readonly documentId: string;
  readonly fn: (change: { documentId: string }) => void;
}
const hookRegistry = new Map<string, Hook[]>();
let firingHooks = false;

/** Drop all onChange hooks for a document (on a new run, or on close). */
export function clearDocumentHooks(documentId: string): void {
  hookRegistry.delete(documentId);
}

/**
 * Fire the onChange hooks registered for `documentId` (called by the electron
 * layer after a non-script mutation). Each hook runs in its own undo group; a
 * throwing hook is isolated; a re-entrancy guard means a hook's own edits don't
 * recursively re-fire hooks.
 */
export function fireDocumentChange(documentId: string): void {
  if (firingHooks) return;
  const hooks = hookRegistry.get(documentId);
  if (!hooks || hooks.length === 0) return;
  firingHooks = true;
  try {
    for (const h of [...hooks]) {
      try {
        h.store.runInUndoGroup(documentId, 'Script hook', () => h.fn({ documentId }));
      } catch {
        /* a throwing hook must not break sibling hooks or the app */
      }
    }
  } finally {
    firingHooks = false;
  }
}

// --- the `bibliofile` API object graph --------------------------------------

/** One entry, addressed by stable item id; reads + writes go through the store. */
class ScriptEntry {
  constructor(
    private readonly store: DocumentStore,
    private readonly documentId: string,
    readonly id: string,
    private readonly caps: ScriptCapabilities = {},
  ) {}

  private item() {
    const it = this.store.itemById(this.documentId, this.id);
    if (!it) throw new Error(`Entry no longer exists (id ${this.id}).`);
    return it;
  }

  get citeKey(): string {
    return this.item().citeKey;
  }
  get type(): string {
    return this.item().type;
  }

  /** Raw stored value of a field (macro-expanded), '' if absent. */
  field(name: string, inherit = false): string {
    return this.item().stringValueOfField(name, inherit);
  }
  /** Display value: {@link field} run through detexify (Unicode accents). */
  displayField(name: string, inherit = false): string {
    return detexify(this.item().stringValueOfField(name, inherit));
  }
  fieldNames(): string[] {
    return this.item().fieldNames();
  }
  fields(): Record<string, string> {
    const item = this.item();
    const out: Record<string, string> = {};
    for (const name of item.fieldNames()) out[name] = item.stringValueOfField(name, false);
    return out;
  }
  authors(field = 'Author', inherit = false): Array<{ displayName: string; first: string; von: string; last: string; jr: string }> {
    return this.item()
      .peopleForField(field, inherit)
      .map((a) => ({ displayName: a.displayName, first: a.first, von: a.von, last: a.last, jr: a.jr }));
  }
  /** File/URL attachments (reuses the detail-pane classification). */
  attachments(): Array<{ field?: string; kind: string; name: string; url: string }> {
    return this.store
      .getItemDetail({ documentId: this.documentId, itemId: this.id })
      .files.map((f) => ({ field: f.field, kind: f.kind, name: f.displayName, url: f.url }));
  }
  toBibTeX(): string {
    return this.store.exportText(this.documentId, 'bibtex', [this.id]);
  }
  toJSON(): { id: string; citeKey: string; type: string; fields: Record<string, string> } {
    return { id: this.id, citeKey: this.citeKey, type: this.type, fields: this.fields() };
  }

  /** This entry's CSL-JSON object (what the citation engine consumes). */
  cslItem(): Record<string, unknown> {
    return this.store.cslItemFor(this.documentId, this.id);
  }
  /** This entry as a formatted bibliography reference (CSL), in `style`/`format`. */
  citation(opts: CiteOptions = {}): string {
    return cslBibliography([this.cslItem()], opts.style ?? this.caps.defaultCiteStyle ?? 'apa', opts.format ?? 'text');
  }

  // --- mutators (route through DocumentStore → undo/reindex preserved) ---
  setField(name: string, value: string): this {
    this.store.applyEdit({ documentId: this.documentId, command: { kind: 'setField', itemId: this.id, field: name, value: String(value ?? '') } });
    return this;
  }
  removeField(name: string): this {
    this.store.applyEdit({ documentId: this.documentId, command: { kind: 'removeField', itemId: this.id, field: name } });
    return this;
  }
  setType(type: string): this {
    this.store.applyEdit({ documentId: this.documentId, command: { kind: 'setType', itemId: this.id, entryType: type } });
    return this;
  }
  setCiteKey(citeKey: string): this {
    this.store.applyEdit({ documentId: this.documentId, command: { kind: 'setCiteKey', itemId: this.id, citeKey } });
    return this;
  }
  generateCiteKey(): string {
    this.store.applyEdit({ documentId: this.documentId, command: { kind: 'generateCiteKey', itemId: this.id } });
    return this.citeKey;
  }
  attach(absPath: string): this {
    this.store.addAttachments(this.documentId, this.id, [absPath]);
    return this;
  }
  autoFile(): this {
    this.store.autoFile(this.documentId, this.id);
    return this;
  }
  delete(): void {
    this.store.applyEdit({ documentId: this.documentId, command: { kind: 'deleteEntry', itemId: this.id } });
  }
}

/** One open document (the library) — the scripting workhorse. */
class ScriptDocument {
  constructor(
    private readonly store: DocumentStore,
    readonly id: string,
    private readonly caps: ScriptCapabilities = {},
  ) {}

  private wrap(itemId: string): ScriptEntry {
    return new ScriptEntry(this.store, this.id, itemId, this.caps);
  }

  /** CSL-JSON items for the given cite keys (all entries if omitted), unknown keys skipped. */
  private cslItemsFor(citeKeys?: readonly string[]): Record<string, unknown>[] {
    const ids = citeKeys
      ? citeKeys.map((k) => this.store.itemIdForCiteKey(this.id, k)).filter((x): x is string => !!x)
      : this.store.itemsOf(this.id).map((it) => it.id);
    return ids.map((id) => this.store.cslItemFor(this.id, id));
  }

  get name(): string {
    return this.store.summarize(this.id).displayName;
  }
  get path(): string {
    return this.store.summarize(this.id).path ?? '';
  }
  get modified(): boolean {
    return this.store.isDirty(this.id);
  }

  // --- query ---
  count(): number {
    return this.store.itemsOf(this.id).length;
  }
  entries(): ScriptEntry[] {
    return this.store.itemsOf(this.id).map((it) => this.wrap(it.id));
  }
  getById(id: string): ScriptEntry | undefined {
    return this.store.itemById(this.id, id) ? this.wrap(id) : undefined;
  }
  getByCiteKey(citeKey: string): ScriptEntry | undefined {
    const id = this.store.itemIdForCiteKey(this.id, citeKey);
    return id ? this.wrap(id) : undefined;
  }
  /** Lookup by cite key first, then by id. */
  get(citeKeyOrId: string): ScriptEntry | undefined {
    return this.getByCiteKey(citeKeyOrId) ?? this.getById(citeKeyOrId);
  }
  find(pred: (e: ScriptEntry) => boolean): ScriptEntry | undefined {
    return this.entries().find(pred);
  }
  filter(pred: (e: ScriptEntry) => boolean): ScriptEntry[] {
    return this.entries().filter(pred);
  }
  /** Case-insensitive substring search across cite key, type, and common fields. */
  search(text: string): ScriptEntry[] {
    const q = String(text ?? '').toLowerCase();
    if (!q) return [];
    const FIELDS = ['Title', 'Author', 'Editor', 'Journal', 'Booktitle', 'Year', 'Keywords', 'Abstract', 'Note'];
    return this.store.itemsOf(this.id).reduce<ScriptEntry[]>((hits, it) => {
      const hay = [it.citeKey, it.type, ...FIELDS.map((f) => detexify(it.stringValueOfField(f, false)))]
        .join(' ')
        .toLowerCase();
      if (hay.includes(q)) hits.push(this.wrap(it.id));
      return hits;
    }, []);
  }
  findDuplicates(): ScriptEntry[][] {
    return this.store.findDuplicates(this.id).groups.map((g) => g.entries.map((e) => this.wrap(e.id)));
  }

  // --- groups / macros ---
  groups(): Array<{ id: string; kind: string; name: string; count: number }> {
    return this.store
      .listGroups({ documentId: this.id })
      .groups.map((g) => ({ id: g.id, kind: g.kind, name: g.name, count: g.count ?? 0 }));
  }
  groupEntries(groupId: string): ScriptEntry[] {
    return this.store
      .listPublications({ documentId: this.id, offset: 0, limit: -1, groupId })
      .rows.map((r) => this.wrap(r.id));
  }
  macros(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of this.store.listMacros({ documentId: this.id }).macros) out[m.name] = m.value;
    return out;
  }
  setMacro(name: string, value: string): void {
    this.store.applyEdit({ documentId: this.id, command: { kind: 'setMacro', name, value: String(value ?? '') } });
  }
  removeMacro(name: string): void {
    this.store.applyEdit({ documentId: this.id, command: { kind: 'removeMacro', name } });
  }

  // --- create / import / export / save ---
  addEntry(data: { type?: string; fields?: Record<string, string>; citeKey?: string }): ScriptEntry {
    const res = this.store.importEntry(this.id, data.type || 'misc', data.fields ?? {});
    const itemId = res.affectedItemId;
    if (!itemId) throw new Error('Could not create the entry.');
    if (data.citeKey) {
      this.store.applyEdit({ documentId: this.id, command: { kind: 'setCiteKey', itemId, citeKey: data.citeKey } });
    }
    return this.wrap(itemId);
  }
  import(bibtexText: string): ScriptEntry[] {
    return this.store.importBibtexText(this.id, bibtexText).addedIds.map((id) => this.wrap(id));
  }
  export(format: ExportFormat, citeKeys?: readonly string[]): string {
    const ids = citeKeys
      ? citeKeys.map((k) => this.store.itemIdForCiteKey(this.id, k)).filter((x): x is string => !!x)
      : undefined;
    return this.store.exportText(this.id, format, ids);
  }
  toBibTeX(): string {
    return this.store.serializeDocument(this.id);
  }
  save(targetPath?: string): void {
    this.store.saveDocument(this.id, targetPath);
  }

  /**
   * A formatted CSL bibliography (reference list) for the given cite keys — or the
   * whole library if omitted — in `style` (default: the document's) / `format`
   * (default `'text'`). This is "citation.js formatted output".
   */
  bibliography(citeKeys?: readonly string[], opts: CiteOptions = {}): string {
    return cslBibliography(this.cslItemsFor(citeKeys), opts.style ?? this.caps.defaultCiteStyle ?? 'apa', opts.format ?? 'text');
  }

  /**
   * An inline citation for the given cite keys — `(Author, Year)`, or `Author
   * (Year)` with `textual: true`. The formatted equivalent of `\citep{…}` /
   * `\citet{…}`. `style`/`format` as above.
   */
  cite(citeKeys: readonly string[], opts: CiteOptions & { textual?: boolean } = {}): string {
    return cslCitation(this.cslItemsFor(citeKeys), opts.style ?? this.caps.defaultCiteStyle ?? 'apa', {
      textual: opts.textual,
      format: opts.format,
    });
  }

  /** Run `fn` as one undo step (a named sub-group within the script run). */
  transaction<T>(label: string, fn: (doc: ScriptDocument) => T): T {
    return this.store.runInUndoGroup(this.id, label || 'Script', () => fn(this));
  }
}

/**
 * Host-mediated I/O exposed to scripts (`bibliofile.io` / `bibliofile.fetch`),
 * injected by the electron layer (so the host stays pure + testable). Anything
 * absent throws when used.
 */
export interface ScriptCapabilities {
  readText?(path: string): string;
  writeText?(path: string, text: string): void;
  exists?(path: string): boolean;
  fetch?(
    url: string,
    opts?: { method?: string; headers?: Record<string, string>; body?: string },
  ): { status: number; headers: Record<string, string>; text: string };
  /** The document's default CSL style id (used when a citation call omits `style`). */
  defaultCiteStyle?: string;
  /** Available CSL style ids (bundled + installed), for `bibliofile.citationStyles()`. */
  citationStyles?(): string[];
}

/** The `bibliofile` global. */
class ScriptApp {
  constructor(
    private readonly store: DocumentStore,
    private readonly defaultDocumentId: string,
    readonly version: string,
    private readonly caps: ScriptCapabilities = {},
  ) {}
  readonly name = 'Bibliofile';
  get activeDocument(): ScriptDocument {
    return new ScriptDocument(this.store, this.defaultDocumentId, this.caps);
  }
  documents(): ScriptDocument[] {
    return this.store.openDocumentIds().map((id) => new ScriptDocument(this.store, id, this.caps));
  }
  document(documentId: string): ScriptDocument {
    return new ScriptDocument(this.store, documentId, this.caps);
  }

  /** Available CSL style ids (bundled + installed) for citation calls. */
  citationStyles(): string[] {
    return this.caps.citationStyles ? this.caps.citationStyles() : [];
  }

  /** Host-mediated file I/O; throws if a capability wasn't provided. */
  get io(): { readText(p: string): string; writeText(p: string, t: string): void; exists(p: string): boolean } {
    const caps = this.caps;
    const need = <T>(fn: T | undefined, name: string): T => {
      if (!fn) throw new Error(`bibliofile.io.${name} is not available in this context.`);
      return fn;
    };
    return Object.freeze({
      readText: (p: string) => need(caps.readText, 'readText')(p),
      writeText: (p: string, t: string) => need(caps.writeText, 'writeText')(p, String(t ?? '')),
      exists: (p: string) => need(caps.exists, 'exists')(p),
    });
  }

  /** Synchronous HTTP request (host-mediated, network-gated); throws if unavailable. */
  fetch(
    url: string,
    opts?: { method?: string; headers?: Record<string, string>; body?: string },
  ): { status: number; headers: Record<string, string>; text: string } {
    if (!this.caps.fetch) throw new Error('bibliofile.fetch is not available in this context.');
    return this.caps.fetch(url, opts);
  }

  /**
   * Register a handler that fires after later mutations of the active document.
   * Stays active until you run another script (which replaces it) or close the
   * document. Returns an unsubscribe function. Keep handlers quick — they run on
   * the main thread with no timeout.
   */
  onChange(fn: (change: { documentId: string }) => void): () => void {
    const id = this.defaultDocumentId;
    const hook: Hook = { store: this.store, documentId: id, fn };
    const list = hookRegistry.get(id) ?? [];
    list.push(hook);
    hookRegistry.set(id, list);
    return () => {
      const cur = hookRegistry.get(id);
      if (cur) hookRegistry.set(id, cur.filter((h) => h !== hook));
    };
  }
}

// --- the runner --------------------------------------------------------------

export interface RunScriptOptions {
  /** Wall-clock limit for the (synchronous) run; default 5000ms. */
  readonly timeoutMs?: number;
  /** App version exposed as `bibliofile.version`. */
  readonly version?: string;
  /** Filename used in stack traces / error line mapping. */
  readonly filename?: string;
  /** Host-mediated I/O (`bibliofile.io` / `bibliofile.fetch`); absent ⇒ unavailable. */
  readonly capabilities?: ScriptCapabilities;
}

export interface RunScriptResult {
  /** Captured console.* lines, in order. */
  readonly output: string[];
  /** The script's return value, made structured-clone-safe (entries → toJSON). */
  readonly result?: unknown;
  /** A runtime/syntax error, with the user-source line when known. */
  readonly error?: { message: string; line?: number; column?: number };
  /** Whether the run changed the document (drives cross-window refresh). */
  readonly mutated: boolean;
}

/** Format one console argument for the output pane (cycle-safe). */
function formatArg(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof ScriptEntry) return JSON.stringify(v.toJSON());
  try {
    return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  } catch {
    return String(v);
  }
}

/** Convert a return value to something the IPC layer can structured-clone. */
function cloneSafe(v: unknown): unknown {
  if (v instanceof ScriptEntry) return v.toJSON();
  if (Array.isArray(v)) return v.map(cloneSafe);
  if (v === null || typeof v !== 'object') return v;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
}

/** Pull `line`/`column` for `filename` out of an error stack. */
function errorLocation(stack: string | undefined, filename: string): { line?: number; column?: number } {
  if (!stack) return {};
  const m = stack.match(new RegExp(`${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):(\\d+)`));
  return m ? { line: Number(m[1]), column: Number(m[2]) } : {};
}

/**
 * Run `code` against `documentId`'s library and return its output, result, and
 * any error. The whole run is one undo step. The script body is wrapped in a
 * strict IIFE so `return` works and top-level declarations don't leak; a
 * `lineOffset` keeps reported error lines aligned with the user's source.
 */
export function runScript(
  store: DocumentStore,
  documentId: string,
  code: string,
  opts: RunScriptOptions = {},
): RunScriptResult {
  const filename = opts.filename ?? 'script.js';
  // A run replaces the document's onChange hooks (latest run wins; bounded).
  clearDocumentHooks(documentId);
  const output: string[] = [];
  const log = (...args: unknown[]): void => void output.push(args.map(formatArg).join(' '));
  const sandbox: Record<string, unknown> = Object.create(null);
  sandbox.bibliofile = new ScriptApp(store, documentId, opts.version ?? '', opts.capabilities ?? {});
  sandbox.console = Object.freeze({ log, info: log, warn: log, error: log });
  // Safe intrinsics only — no require/process/module/global/timers.
  Object.assign(sandbox, { JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, Map, Set, Symbol, parseInt, parseFloat, isNaN, isFinite });
  const ctx = createContext(sandbox, { name: 'bibliofile-script' });

  const before = store.serializeDocument(documentId);
  let result: unknown;
  let error: RunScriptResult['error'];
  try {
    // line 1 is the wrapper; lineOffset:-1 maps wrapped line 2 → user line 1.
    const script = new Script(`(function(){'use strict';\n${code}\n})()`, { filename, lineOffset: -1 });
    result = store.runInUndoGroup(documentId, 'Run Script', () =>
      script.runInContext(ctx, { timeout: opts.timeoutMs ?? 5000 }),
    );
  } catch (e) {
    const err = e as Error;
    error = { message: err.message, ...errorLocation(err.stack, filename) };
  }
  const mutated = store.serializeDocument(documentId) !== before;
  return { output, result: error ? undefined : cloneSafe(result), error, mutated };
}
