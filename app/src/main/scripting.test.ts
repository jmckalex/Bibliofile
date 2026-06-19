/**
 * Bibliophile scripting service — exercises the AppleScript object model against
 * a real DocumentStore (application -> documents -> publications -> fields /
 * authors), property reads/writes (undoable), and the JSON `dispatch` transport.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
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

describe('ScriptingService — groups', () => {
  it('the library group contains every publication', () => {
    const { svc, doc } = setup();
    expect(svc.elements(doc, 'groups').length).toBeGreaterThanOrEqual(1);
    const lib = svc.elements(doc, 'library groups');
    expect(lib.length).toBe(1);
    expect(svc.getProperty(lib[0]!, 'name')).toBeTruthy();
    expect(svc.count(lib[0]!, 'publications')).toBe(2);
  });

  it('static groups filter to user static groups and expose their members', () => {
    const { store, documentId, svc, doc } = setup();
    store.groupEdit({
      documentId,
      command: { kind: 'createStatic', name: 'Faves', citeKeys: ['smith2020'] },
    });
    const statics = svc.elements(doc, 'static groups');
    expect(statics.length).toBe(1);
    expect(svc.getProperty(statics[0]!, 'name')).toBe('Faves');
    const members = svc.elements(statics[0]!, 'publications');
    expect(members.length).toBe(1);
    expect(svc.getProperty(members[0]!, 'cite key')).toBe('smith2020');
  });
});

describe('ScriptingService — commands', () => {
  it('make new publication with properties → new entry, returns its ref', () => {
    const { svc, doc } = setup();
    const ref = svc.command('make', doc, {
      withProperties: { type: 'article', title: 'Fresh', 'cite key': 'fresh2021', 'publication year': '2021' },
    }) as ElementRef;
    expect(ref).toMatchObject({ kind: 'publication' });
    expect(svc.getProperty(ref, 'cite key')).toBe('fresh2021');
    expect(svc.getProperty(ref, 'title')).toBe('Fresh');
    expect(svc.getProperty(ref, 'publication year')).toBe('2021');
    expect(svc.count(doc, 'publications')).toBe(3);
  });

  it('delete removes a publication', () => {
    const { svc, doc, pub } = setup();
    svc.command('delete', pub('jones2019'), {});
    expect(svc.count(doc, 'publications')).toBe(1);
  });

  it('duplicate clones a publication (returns the new cite key)', () => {
    const { svc, doc, pub } = setup();
    const key = svc.command('duplicate', pub('smith2020'), {}) as string;
    expect(key).toBeTruthy();
    expect(svc.count(doc, 'publications')).toBe(3);
    const dup = svc.elements(doc, 'publications').find((r) => svc.getProperty(r, 'cite key') === key)!;
    expect(svc.getProperty(dup, 'title')).toBe('Hello World');
  });

  it('search matches across fields (case-insensitive), returning cite keys', () => {
    const { svc, doc } = setup();
    expect(svc.command('search', doc, { for: 'hello' })).toEqual(['smith2020']);
    expect(svc.command('search', doc, { for: 'jones' })).toEqual(['jones2019']);
  });

  it('export returns BibTeX text', () => {
    const { svc, doc } = setup();
    const text = svc.command('export', doc, { as: 'bibtex' }) as string;
    expect(text).toContain('@article');
    expect(text).toContain('smith2020');
  });

  it('export to a file writes it and returns the path', () => {
    const { svc, doc } = setup();
    const out = '/tmp/bibliophile-export-test.bib';
    if (existsSync(out)) rmSync(out);
    const path = svc.command('export', doc, { as: 'bibtex', to: out }) as string;
    expect(path).toBe(out);
    expect(readFileSync(out, 'utf8')).toContain('smith2020');
    rmSync(out);
  });

  it('generate cite key assigns a (non-empty) key', () => {
    const { svc, pub } = setup();
    const key = svc.command('generate cite key', pub('smith2020'), {}) as string;
    expect(key).toBeTruthy();
    expect(svc.getProperty(pub(key), 'cite key')).toBe(key);
  });

  it('unknown command errors', () => {
    const { svc, doc } = setup();
    expect(() => svc.command('frobnicate', doc, {})).toThrow(/Unknown command/);
  });

  it('mutating commands fire onMutate(documentId)', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Title={A}}', '/tmp/cmd.bib');
    const calls: string[] = [];
    const svc = new ScriptingService(store, 'B', '1', (id) => calls.push(id));
    svc.command('make', { kind: 'document', documentId }, { withProperties: { type: 'misc', title: 'New' } });
    expect(calls).toEqual([documentId]);
  });
});

describe('ScriptingService — commands via dispatch', () => {
  it('search round-trips through JSON dispatch', () => {
    const { svc, doc } = setup();
    const res = JSON.parse(
      svc.dispatch(JSON.stringify({ op: 'command', name: 'search', ref: doc, params: { for: 'world' } })),
    );
    expect(res.ok).toBe(true);
    expect(res.value).toHaveLength(1);
  });

  it('make round-trips and returns a publication ref', () => {
    const { svc, doc } = setup();
    const res = JSON.parse(
      svc.dispatch(
        JSON.stringify({
          op: 'command',
          name: 'make',
          ref: doc,
          params: { withProperties: { type: 'article', title: 'Z' } },
        }),
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.value).toMatchObject({ kind: 'publication' });
  });
});
