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
import type { DocumentStore } from './document-service.js';
import { ANNOTATION_FIELD, readAnnotation } from './annotation.js';
import { FieldNames } from '@bibdesk/model';

/** A value that can cross the AppleScript boundary. */
export type ScriptValue = string | number | boolean | null | ElementRef | ScriptValue[];

/** An opaque reference to one scriptable element. */
export type ElementRef =
  | { kind: 'application' }
  | { kind: 'document'; documentId: string }
  | { kind: 'publication'; documentId: string; itemId: string }
  | { kind: 'field'; documentId: string; itemId: string; name: string }
  | { kind: 'author'; documentId: string; itemId: string; field: 'Author' | 'Editor'; index: number };

/** Raised for AppleScript-visible errors (unknown property, bad reference, …). */
export class ScriptingError extends Error {}

/** The JSON request the native bridge sends to {@link ScriptingService.dispatch}. */
export type ScriptRequest =
  | { op: 'elements'; ref: ElementRef; element: string }
  | { op: 'count'; ref: ElementRef; element: string }
  | { op: 'getProperty'; ref: ElementRef; name: string }
  | { op: 'setProperty'; ref: ElementRef; name: string; value: ScriptValue };

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
}

/** Pull the (documentId, itemId) pair out of a publication/field/author ref. */
function ids(ref: { documentId: string; itemId: string }): { documentId: string; itemId: string } {
  return { documentId: ref.documentId, itemId: ref.itemId };
}
