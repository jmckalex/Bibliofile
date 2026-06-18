/**
 * Bibliophile scripting service — exercises the AppleScript object model against
 * a real DocumentStore (application -> documents -> publications -> fields /
 * authors), property reads/writes (undoable), and the JSON `dispatch` transport.
 */
import { describe, it, expect } from 'vitest';
import { DocumentStore } from './document-service.js';
import { ScriptingService, type ElementRef } from './scripting.js';

function setup() {
  const store = new DocumentStore();
  const { documentId } = store.openText(
    '@article{smith2020, Author = {John Smith and Jane Doe}, Title = {Hello World}, Year = {2020}, Keywords = {x, y}}\n' +
      '@book{jones2019, Editor = {Ann Jones}, Title = {A Book}, Year = {2019}}',
    '/tmp/scripting.bib',
  );
  const svc = new ScriptingService(store, 'Bibliophile', '1.2.3');
  const app: ElementRef = { kind: 'application' };
  const doc: ElementRef = { kind: 'document', documentId };
  const pub = (citeKey: string): ElementRef =>
    svc.elements(doc, 'publications').find((r) => svc.getProperty(r, 'cite key') === citeKey)!;
  return { store, documentId, svc, app, doc, pub };
}

describe('ScriptingService — read model', () => {
  it('application has the open documents', () => {
    const { svc, app } = setup();
    expect(svc.count(app, 'documents')).toBe(1);
    expect(svc.getProperty(app, 'name')).toBe('Bibliophile');
    expect(svc.getProperty(app, 'version')).toBe('1.2.3');
    expect(svc.elements(app, 'documents')[0]).toMatchObject({ kind: 'document' });
  });

  it('document properties + publications', () => {
    const { svc, doc } = setup();
    expect(svc.getProperty(doc, 'name')).toBe('scripting.bib');
    expect(svc.getProperty(doc, 'path')).toBe('/tmp/scripting.bib');
    expect(svc.getProperty(doc, 'modified')).toBe(false);
    expect(svc.count(doc, 'publications')).toBe(2);
  });

  it('publication properties', () => {
    const { svc, pub } = setup();
    const p = pub('smith2020');
    expect(svc.getProperty(p, 'cite key')).toBe('smith2020');
    expect(svc.getProperty(p, 'type')).toBe('article');
    expect(svc.getProperty(p, 'title')).toBe('Hello World');
    expect(svc.getProperty(p, 'publication year')).toBe('2020');
    expect(svc.getProperty(p, 'keywords')).toBe('x, y');
  });

  it('authors and editors as elements', () => {
    const { svc, pub } = setup();
    const authors = svc.elements(pub('smith2020'), 'authors');
    expect(authors.length).toBe(2);
    expect(svc.getProperty(authors[0]!, 'first name')).toBe('John');
    expect(svc.getProperty(authors[0]!, 'last name')).toBe('Smith');
    expect(svc.getProperty(authors[1]!, 'last name')).toBe('Doe');
    // the @book keys off its editor
    const editors = svc.elements(pub('jones2019'), 'editors');
    expect(editors.length).toBe(1);
    expect(svc.getProperty(editors[0]!, 'last name')).toBe('Jones');
  });

  it('fields as elements (name / value / inherited)', () => {
    const { svc, pub } = setup();
    const fields = svc.elements(pub('smith2020'), 'fields');
    const title = fields.find((f) => svc.getProperty(f, 'name') === 'Title')!;
    expect(svc.getProperty(title, 'value')).toBe('Hello World');
    expect(svc.getProperty(title, 'inherited')).toBe(false);
  });

  it('rejects unknown properties / elements clearly', () => {
    const { svc, doc, pub } = setup();
    expect(() => svc.getProperty(pub('smith2020'), 'nonsense')).toThrow(/Can't get/);
    expect(() => svc.elements(doc, 'authors')).toThrow(/no author/);
  });
});

describe('ScriptingService — writes (undoable)', () => {
  it('sets the cite key and a field, reflected immediately; undo reverts', () => {
    const { store, documentId, svc, pub } = setup();
    svc.setProperty(pub('smith2020'), 'cite key', 'Smith:2020');
    expect(svc.getProperty(pub('Smith:2020'), 'cite key')).toBe('Smith:2020');

    svc.setProperty(pub('Smith:2020'), 'title', 'New Title');
    expect(svc.getProperty(pub('Smith:2020'), 'title')).toBe('New Title');

    store.undo(documentId); // undo the title
    expect(svc.getProperty(pub('Smith:2020'), 'title')).toBe('Hello World');
    store.undo(documentId); // undo the cite-key rename
    expect(svc.getProperty(pub('smith2020'), 'cite key')).toBe('smith2020');
  });

  it('fires onMutate(documentId) after a write (so the host can refresh windows)', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Title={A}}', '/tmp/m.bib');
    const calls: string[] = [];
    const svc = new ScriptingService(store, 'B', '1', (id) => calls.push(id));
    const p = svc.elements({ kind: 'document', documentId }, 'publications')[0]!;
    svc.setProperty(p, 'cite key', 'Renamed');
    svc.setProperty(p, 'title', 'New');
    expect(calls).toEqual([documentId, documentId]);
  });
});

describe('ScriptingService — JSON dispatch (native transport)', () => {
  it('round-trips a getProperty request', () => {
    const { svc, pub } = setup();
    const ref = pub('smith2020');
    const res = JSON.parse(svc.dispatch(JSON.stringify({ op: 'getProperty', ref, name: 'title' })));
    expect(res).toEqual({ ok: true, value: 'Hello World' });
  });

  it('count via dispatch', () => {
    const { svc, doc } = setup();
    const res = JSON.parse(svc.dispatch(JSON.stringify({ op: 'count', ref: doc, element: 'publications' })));
    expect(res).toEqual({ ok: true, value: 2 });
  });

  it('errors come back as { ok: false } rather than throwing', () => {
    const { svc, pub } = setup();
    const res = JSON.parse(
      svc.dispatch(JSON.stringify({ op: 'getProperty', ref: pub('smith2020'), name: 'bogus' })),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Can't get/);
  });
});
