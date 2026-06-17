import { describe, it, expect } from 'vitest';
import { DocumentStore } from './document-service.js';
import { dispatchBridge } from './bridge.js';

function open() {
  const store = new DocumentStore();
  const { documentId } = store.openText(
    '@article{a, Author = {A. Smith}, Title = {Widgets}, Year = {2020}}\n@book{b, Title = {Gadgets}}',
    '/tmp/bridge.bib',
  );
  return { store, documentId };
}

describe('dispatchBridge', () => {
  it('ping works without an open document', () => {
    const store = new DocumentStore();
    const res = dispatchBridge(store, null, { method: 'ping', params: {} });
    expect(res.ok).toBe(true);
    expect(res.methods).toContain('list');
  });

  it('errors when no document is open (non-ping)', () => {
    const store = new DocumentStore();
    expect(dispatchBridge(store, null, { method: 'list', params: {} }).ok).toBe(false);
  });

  it('list / get / search / export read the library', () => {
    const { store, documentId } = open();
    const list = dispatchBridge(store, documentId, { method: 'list', params: {} });
    expect((list.entries as unknown[]).length).toBe(2);

    const get = dispatchBridge(store, documentId, { method: 'get', params: { citeKey: 'a' } });
    expect((get.entry as { fields: Record<string, string> }).fields.Title).toBe('Widgets');

    const search = dispatchBridge(store, documentId, { method: 'search', params: { q: 'gadgets' } });
    expect((search.entries as { citeKey: string }[]).map((e) => e.citeKey)).toEqual(['b']);

    const exp = dispatchBridge(store, documentId, { method: 'export', params: { format: 'bibtex' } });
    expect(exp.text).toContain('@article');
  });

  it('add / set mutate and flag mutated', () => {
    const { store, documentId } = open();
    const add = dispatchBridge(store, documentId, {
      method: 'add',
      params: { type: 'article', Title: 'New One', Author: 'B. Jones' },
    });
    expect(add.ok).toBe(true);
    expect(add.mutated).toBe(true);
    expect(dispatchBridge(store, documentId, { method: 'list', params: {} }).entries).toHaveLength(3);

    const set = dispatchBridge(store, documentId, {
      method: 'set',
      params: { citeKey: 'a', field: 'Year', value: '1999' },
    });
    expect(set.mutated).toBe(true);
    const get = dispatchBridge(store, documentId, { method: 'get', params: { citeKey: 'a' } });
    expect((get.entry as { fields: Record<string, string> }).fields.Year).toBe('1999');
  });

  it('rejects an unknown method', () => {
    const { store, documentId } = open();
    expect(dispatchBridge(store, documentId, { method: 'nope', params: {} }).ok).toBe(false);
  });
});
