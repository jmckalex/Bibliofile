/**
 * Bibliophile scripting service — the platform-agnostic "brain" behind the macOS
 * AppleScript dictionary. It maps BibDesk's scripting vocabulary onto the
 * {@link DocumentStore} / `BibItem` model and is PURE (no Electron / Cocoa), so
 * it's fully unit-testable. The native Cocoa-Scripting bridge
 * (`app/native/scripting`) is a thin transport: it serializes each property /
 * element / verb request to JSON and calls {@link ScriptingService.dispatch}.
 *
 * Object model (mirrors `bibdesk/Scripting/BibDesk.sdef`):
 *   application -> documents -> publications -> { fields, authors, editors }
 * Each element is addressed by an opaque {@link ElementRef}; property names are
 * the sdef's human names ("cite key", "publication year", "full name", …).
 */
import { writeFileSync } from 'node:fs';
import type { DocumentStore } from './document-service.js';
import { ANNOTATION_FIELD, readAnnotation } from './annotation.js';
import { FieldNames } from '@bibdesk/model';
import type { ExportFormat, GroupKind } from '@bibdesk/shared';

/** A value that can cross the AppleScript boundary. */
export type ScriptValue = string | number | boolean | null | ElementRef | ScriptValue[];

/** An opaque reference to one scriptable element. */
export type ElementRef =
  | { kind: 'application' }
  | { kind: 'document'; documentId: string }
  | { kind: 'publication'; documentId: string; itemId: string }
  | { kind: 'field'; documentId: string; itemId: string; name: string }
  | { kind: 'author'; documentId: string; itemId: string; field: 'Author' | 'Editor'; index: number }
  | { kind: 'group'; documentId: string; groupId: string };

/** Raised for AppleScript-visible errors (unknown property, bad reference, …). */
export class ScriptingError extends Error {}

/** The JSON request the native bridge sends to {@link ScriptingService.dispatch}. */
export type ScriptRequest =
  | { op: 'elements'; ref: ElementRef; element: string }
  | { op: 'count'; ref: ElementRef; element: string }
  | { op: 'getProperty'; ref: ElementRef; name: string }
  | { op: 'setProperty'; ref: ElementRef; name: string; value: ScriptValue }
  | { op: 'command'; name: string; ref?: ElementRef; params?: Record<string, unknown> };

export type ScriptResponse = { ok: true; value: ScriptValue } | { ok: false; error: string };

/** Writable publication properties → the BibTeX field they map to. */
const PUBLICATION_WRITABLE_FIELDS: Record<string, string> = {
  title: FieldNames.Title,
  abstract: 'Abstract',
  keywords: 'Keywords',
  'publication year': FieldNames.Year,
  'publication month': 'Month',
  rating: 'Rating',
  note: ANNOTATION_FIELD,
};

/** Upper bound when listing a group's publications (no real library is this big). */
const GROUP_LIMIT = 1_000_000;

/** Export formats accepted by the `export` command (mirror {@link ExportFormat}). */
const EXPORT_FORMATS: readonly ExportFormat[] = [
  'bibtex',
  'bibtex-minimal',
  'ris',
  'csv',
  'html',
  'rtf',
];

/**
 * Map a (lowercased, singular) group element class name to a predicate over the
 * store's {@link GroupKind}s, or `null` when the name isn't a group class. The
 * sdef's `field group` covers BibDesk's auto category/author groups; `external
 * file group` covers url-backed groups; `folder group` is this app's folders.
 */
function groupKindFilter(el: string): ((k: GroupKind) => boolean) | null {
  switch (el) {
    case 'group':
      return () => true;
    case 'library group':
      return (k) => k === 'library';
    case 'static group':
      return (k) => k === 'static';
    case 'smart group':
      return (k) => k === 'smart';
    case 'field group':
      return (k) => k === 'category' || k === 'author';
    case 'external file group':
      return (k) => k === 'url';
    case 'script group':
      return (k) => k === 'script';
    case 'folder group':
      return (k) => k === 'folder';
    default:
      return null;
  }
}

export class ScriptingService {
  constructor(
    private readonly store: DocumentStore,
    private readonly appName = 'Bibliophile',
    private readonly appVersion = '0.0.0',
    /** Called with the documentId after a successful mutation, so the host can
     *  notify open windows (the AppleScript path bypasses the IPC broadcast). */
    private readonly onMutate?: (documentId: string) => void,
  ) {}

  /** Single JSON entry point for the native bridge. Never throws — errors are
   *  returned as `{ ok: false }` so the bridge can map them to Apple Events. */
  dispatch(requestJson: string): string {
    let res: ScriptResponse;
    try {
      const req = JSON.parse(requestJson) as ScriptRequest;
      switch (req.op) {
        case 'elements':
          res = { ok: true, value: this.elements(req.ref, req.element) };
          break;
        case 'count':
          res = { ok: true, value: this.count(req.ref, req.element) };
          break;
        case 'getProperty':
          res = { ok: true, value: this.getProperty(req.ref, req.name) };
          break;
        case 'setProperty':
          this.setProperty(req.ref, req.name, req.value);
          res = { ok: true, value: null };
          break;
        case 'command':
          res = { ok: true, value: this.command(req.name, req.ref, req.params ?? {}) };
          break;
        default:
          res = { ok: false, error: `Unknown op` };
      }
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return JSON.stringify(res);
  }

  // --- elements --------------------------------------------------------------

  /** The child elements of `ref` of the given singular class (e.g. 'publication'). */
  elements(ref: ElementRef, element: string): ElementRef[] {
    const el = element.toLowerCase().replace(/s$/, '');
    if (ref.kind === 'application' && el === 'document') {
      return this.store.documentIds().map((documentId) => ({ kind: 'document', documentId }));
    }
    if (ref.kind === 'document' && el === 'publication') {
      const { documentId } = ref;
      return this.store.itemsOf(documentId).map((it) => ({ kind: 'publication', documentId, itemId: it.id }));
    }
    if (ref.kind === 'document') {
      const filter = groupKindFilter(el);
      if (filter) {
        const { documentId } = ref;
        return this.store
          .listGroups({ documentId })
          .groups.filter((g) => filter(g.kind))
          .map((g) => ({ kind: 'group', documentId, groupId: g.id }));
      }
    }
    if (ref.kind === 'group' && el === 'publication') {
      const { documentId, groupId } = ref;
      const rows = this.store.listPublications({ documentId, offset: 0, limit: GROUP_LIMIT, groupId }).rows;
      return rows.map((r) => ({ kind: 'publication', documentId, itemId: r.id }));
    }
    if (ref.kind === 'publication' && el === 'field') {
      const item = this.item(ref);
      return item.fieldNames().map((name) => ({ kind: 'field', ...ids(ref), name }));
    }
    if (ref.kind === 'publication' && (el === 'author' || el === 'editor')) {
      const field = el === 'author' ? 'Author' : 'Editor';
      const item = this.item(ref);
      return item
        .peopleForField(field)
        .map((_, index) => ({ kind: 'author', ...ids(ref), field, index }) as ElementRef);
    }
    throw new ScriptingError(`${ref.kind} has no ${element}`);
  }

  count(ref: ElementRef, element: string): number {
    return this.elements(ref, element).length;
  }

  // --- properties ------------------------------------------------------------

  getProperty(ref: ElementRef, name: string): ScriptValue {
    const prop = name.toLowerCase();
    switch (ref.kind) {
      case 'application':
        if (prop === 'name') return this.appName;
        if (prop === 'version') return this.appVersion;
        break;
      case 'document': {
        const doc = this.store.summarize(ref.documentId);
        if (prop === 'name') return doc.displayName;
        if (prop === 'path') return doc.path || null;
        if (prop === 'file') return doc.path || null;
        if (prop === 'modified') return this.store.isDirty(ref.documentId);
        break;
      }
      case 'publication':
        return this.pubProperty(ref, prop);
      case 'field': {
        const item = this.item(ref);
        if (prop === 'name') return ref.name;
        if (prop === 'value') return item.stringValueOfField(ref.name, false);
        if (prop === 'inherited') return item.isFieldInherited(ref.name);
        break;
      }
      case 'author': {
        const a = this.author(ref);
        if (prop === 'name') return a.normalizedName;
        if (prop === 'full name') return a.name;
        if (prop === 'first name') return a.first;
        if (prop === 'last name') return a.last;
        if (prop === 'von name part') return a.von;
        if (prop === 'jr part') return a.jr;
        break;
      }
      case 'group': {
        const g = this.groupNode(ref);
        if (prop === 'name') return g.name;
        if (prop === 'id') return g.id;
        break;
      }
    }
    throw new ScriptingError(`Can't get ${name} of ${ref.kind}`);
  }

  setProperty(ref: ElementRef, name: string, value: ScriptValue): void {
    const prop = name.toLowerCase();
    const text = value == null ? '' : String(value);
    let documentId: string;

    if (ref.kind === 'publication') {
      documentId = ref.documentId;
      const { itemId } = ref;
      if (prop === 'cite key') {
        this.store.applyEdit({ documentId, command: { kind: 'setCiteKey', itemId, citeKey: text } });
      } else if (prop === 'type') {
        this.store.applyEdit({ documentId, command: { kind: 'setType', itemId, entryType: text } });
      } else {
        const field = PUBLICATION_WRITABLE_FIELDS[prop];
        if (!field) throw new ScriptingError(`Can't set ${name} of publication`);
        this.store.applyEdit({ documentId, command: { kind: 'setField', itemId, field, value: text } });
      }
    } else if (ref.kind === 'field') {
      documentId = ref.documentId;
      this.store.applyEdit({
        documentId,
        command: { kind: 'setField', itemId: ref.itemId, field: ref.name, value: text },
      });
    } else {
      throw new ScriptingError(`Can't set ${name} of ${ref.kind}`);
    }

    // The AppleScript path mutates the main-process model directly, so tell the
    // host to refresh open windows (the IPC edit path does this automatically).
    this.onMutate?.(documentId);
  }

  // --- publication property map ----------------------------------------------

  private pubProperty(ref: Extract<ElementRef, { kind: 'publication' }>, prop: string): ScriptValue {
    const item = this.item(ref);
    const field = (name: string): string => item.stringValueOfField(name, true);
    switch (prop) {
      case 'id':
        return item.id;
      case 'cite key':
        return item.citeKey;
      case 'type':
        return item.type;
      case 'title':
        return field(FieldNames.Title);
      case 'abstract':
        return field('Abstract');
      case 'keywords':
        return field('Keywords');
      case 'publication year':
        return field(FieldNames.Year);
      case 'publication month':
        return field('Month');
      case 'added date':
        return field('Date-Added') || null;
      case 'modified date':
        return field('Date-Modified') || null;
      case 'local file':
        return field('Local-Url');
      case 'url':
        return field('Url');
      case 'rating':
        return item.ratingValueOfField('Rating');
      case 'note':
        return readAnnotation(item);
    }
    throw new ScriptingError(`Can't get ${prop} of publication`);
  }

  // --- ref resolution --------------------------------------------------------

  private item(ref: { documentId: string; itemId: string }) {
    const item = this.store.itemById(ref.documentId, ref.itemId);
    if (!item) throw new ScriptingError(`No such publication`);
    return item;
  }

  private author(ref: Extract<ElementRef, { kind: 'author' }>) {
    const people = this.item(ref).peopleForField(ref.field);
    const a = people[ref.index];
    if (!a) throw new ScriptingError(`No such ${ref.field.toLowerCase()}`);
    return a;
  }

  private groupNode(ref: Extract<ElementRef, { kind: 'group' }>) {
    const g = this.store.listGroups({ documentId: ref.documentId }).groups.find((x) => x.id === ref.groupId);
    if (!g) throw new ScriptingError(`No such group`);
    return g;
  }

  // --- commands (make / delete / save / search / export …) -------------------

  /**
   * Dispatch a verb. `ref` is the command's target object (the document to save,
   * the publication to delete, the container to `make` into); `params` are the
   * named arguments (`with properties`, `for`, `as`, `to`, `in`). Verbs that
   * mutate fire {@link onMutate} so open windows refresh.
   */
  command(name: string, ref: ElementRef | undefined, params: Record<string, unknown>): ScriptValue {
    switch (name.toLowerCase()) {
      case 'make':
        return this.cmdMake(ref, params);
      case 'delete':
        return this.cmdDelete(ref);
      case 'duplicate':
        return this.cmdDuplicate(ref);
      case 'generate cite key':
        return this.cmdGenerateCiteKey(ref);
      case 'save':
        return this.cmdSave(ref, params);
      case 'search':
        return this.cmdSearch(ref, params);
      case 'export':
        return this.cmdExport(ref, params);
    }
    throw new ScriptingError(`Unknown command "${name}"`);
  }

  /**
   * `make new publication [at <document>] [with properties {type:…, title:…}]`.
   * Returns the new publication's {@link ElementRef} (the native KVC `make` path
   * wraps it into the object Cocoa inserts + builds the result specifier from).
   */
  private cmdMake(ref: ElementRef | undefined, params: Record<string, unknown>): ElementRef {
    const documentId = this.documentIdOf(ref);
    const props = asRecord(params.withProperties ?? params.properties);
    const type = props.type != null ? String(props.type) : 'misc';
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(props)) {
      const key = k.toLowerCase();
      if (key === 'type' || key === 'cite key') continue;
      const field = PUBLICATION_WRITABLE_FIELDS[key];
      if (field) fields[field] = v == null ? '' : String(v);
    }
    const itemId = this.store.importEntry(documentId, type, fields).affectedItemId;
    if (!itemId) throw new ScriptingError(`Could not create publication`);
    if (props['cite key'] != null) {
      this.store.applyEdit({
        documentId,
        command: { kind: 'setCiteKey', itemId, citeKey: String(props['cite key']) },
      });
    }
    this.onMutate?.(documentId);
    return { kind: 'publication', documentId, itemId };
  }

  /** `delete <publication>`. */
  private cmdDelete(ref: ElementRef | undefined): null {
    if (ref?.kind !== 'publication') throw new ScriptingError(`Can only delete a publication`);
    this.store.applyEdit({ documentId: ref.documentId, command: { kind: 'deleteEntry', itemId: ref.itemId } });
    this.onMutate?.(ref.documentId);
    return null;
  }

  /**
   * `duplicate <publication>` → the new publication's {@link ElementRef} (the
   * native KVC clone path wraps it into the object Cocoa inserts + returns).
   */
  private cmdDuplicate(ref: ElementRef | undefined): ElementRef {
    if (ref?.kind !== 'publication') throw new ScriptingError(`Can only duplicate a publication`);
    const itemId = this.store.applyEdit({
      documentId: ref.documentId,
      command: { kind: 'duplicateEntry', itemId: ref.itemId },
    }).affectedItemId;
    if (!itemId) throw new ScriptingError(`Could not duplicate publication`);
    this.onMutate?.(ref.documentId);
    return { kind: 'publication', documentId: ref.documentId, itemId };
  }

  /** `generate cite key <publication>` → the new cite key. */
  private cmdGenerateCiteKey(ref: ElementRef | undefined): string {
    if (ref?.kind !== 'publication') throw new ScriptingError(`generate cite key needs a publication`);
    this.store.applyEdit({ documentId: ref.documentId, command: { kind: 'generateCiteKey', itemId: ref.itemId } });
    this.onMutate?.(ref.documentId);
    return this.item(ref).citeKey;
  }

  /** `save <document> [in <file>]`. */
  private cmdSave(ref: ElementRef | undefined, params: Record<string, unknown>): null {
    const documentId = this.documentIdOf(ref);
    const target = params.in != null ? String(params.in) : undefined;
    this.store.saveDocument(documentId, target);
    return null;
  }

  /**
   * `search <document> for <text>` → the cite keys of matching publications (any
   * field, case-insensitive). Commands return text (cite keys), not live object
   * references: re-address with `first publication whose cite key is "…"`.
   */
  private cmdSearch(ref: ElementRef | undefined, params: Record<string, unknown>): string[] {
    const documentId = this.documentIdOf(ref);
    const q = (params.for != null ? String(params.for) : '').toLowerCase();
    if (!q) return [];
    return this.store
      .itemsOf(documentId)
      .filter(
        (it) =>
          it.citeKey.toLowerCase().includes(q) ||
          it.type.toLowerCase().includes(q) ||
          it.fieldNames().some((n) => it.stringValueOfField(n, false).toLowerCase().includes(q)),
      )
      .map((it) => it.citeKey);
  }

  /**
   * `export <document> [as <format>] [for <publications>] [to <file>]`. Returns the
   * exported text, or the written file path when `to` is given.
   */
  private cmdExport(ref: ElementRef | undefined, params: Record<string, unknown>): string {
    const documentId = this.documentIdOf(ref);
    const asFmt = (params.as != null ? String(params.as) : 'bibtex').toLowerCase();
    const format = (EXPORT_FORMATS as readonly string[]).includes(asFmt) ? (asFmt as ExportFormat) : 'bibtex';
    let itemIds: string[] | undefined;
    if (Array.isArray(params.for)) {
      itemIds = params.for
        .filter((r): r is Extract<ElementRef, { kind: 'publication' }> => isElementRef(r) && r.kind === 'publication')
        .map((r) => r.itemId);
    }
    const text = this.store.exportText(documentId, format, itemIds);
    if (params.to != null) {
      const path = String(params.to);
      writeFileSync(path, text, 'utf8');
      return path;
    }
    return text;
  }

  /** The document a command targets: the ref's own document, else the frontmost open one. */
  private documentIdOf(ref: ElementRef | undefined): string {
    if (ref && 'documentId' in ref) return ref.documentId;
    const ids = this.store.documentIds();
    if (ids.length === 0) throw new ScriptingError(`No open document`);
    return ids[0]!;
  }
}

/** Pull the (documentId, itemId) pair out of a publication/field/author ref. */
function ids(ref: { documentId: string; itemId: string }): { documentId: string; itemId: string } {
  return { documentId: ref.documentId, itemId: ref.itemId };
}

/** True for a value shaped like an {@link ElementRef} (has a string `kind`). */
function isElementRef(v: unknown): v is ElementRef {
  return typeof v === 'object' && v !== null && typeof (v as { kind?: unknown }).kind === 'string';
}

/** Coerce a command argument to a plain record (e.g. AppleScript `with properties {…}`). */
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
