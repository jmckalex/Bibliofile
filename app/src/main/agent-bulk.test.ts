/**
 * Bulk assistant operations: regenerate cite keys / set a field across many
 * entries in ONE call + ONE undo step (so the agent doesn't need 1000 round
 * trips to act on a whole library).
 */
import { describe, it, expect } from 'vitest';
import { DocumentStore } from './document-service.js';

const keysOf = (store: DocumentStore, documentId: string): string[] =>
  store
    .listPublications({ documentId, offset: 0, limit: -1 })
    .rows.map((r) => r.citeKey)
    .sort();

describe('agentRegenerateCiteKeys', () => {
  it('renames every entry from the format (unique across the batch), one undo step', () => {
    const store = new DocumentStore();
    store.setEditConfig({ citeKeyFormat: '%a1:%Y%u0' }); // the app's default format
    const { documentId } = store.openText(
      '@article{a, Author = {John Smith}, Year = {2020}, Title = {A}}\n' +
        '@article{b, Author = {John Smith}, Year = {2020}, Title = {B}}',
      '/tmp/bulk.bib',
    );
    const res = store.agentRegenerateCiteKeys(documentId);
    expect(res.count).toBe(2);
    // %a1:%Y%u0 → Smith:2020, with the collision disambiguated to Smith:2020a
    expect(keysOf(store, documentId)).toEqual(['Smith:2020', 'Smith:2020a']);

    // A single undo restores BOTH keys (one snapshot for the whole batch).
    expect(store.undoState(documentId).canUndo).toBe(true);
    store.undo(documentId);
    expect(keysOf(store, documentId)).toEqual(['a', 'b']);
  });

  it('can target a subset by cite key', () => {
    const store = new DocumentStore();
    store.setEditConfig({ citeKeyFormat: '%a1:%Y%u0' });
    const { documentId } = store.openText(
      '@article{keep, Author = {Ann Jones}, Year = {2019}, Title = {K}}\n' +
        '@article{rename, Author = {Bob Lee}, Year = {2021}, Title = {R}}',
      '/tmp/bulk2.bib',
    );
    const res = store.agentRegenerateCiteKeys(documentId, ['rename']);
    expect(res.count).toBe(1);
    const keys = keysOf(store, documentId);
    expect(keys).toContain('keep'); // untouched
    expect(keys).toContain('Lee:2021');
  });
});

describe('agentBatchSetField', () => {
  it('sets a field on every entry in one undo step', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Title={A}}\n@book{b, Title={B}}', '/tmp/bf.bib');
    const res = store.agentBatchSetField(documentId, 'Keywords', 'todo');
    expect(res.count).toBe(2);
    for (const r of store.listPublications({ documentId, offset: 0, limit: -1 }).rows) {
      const d = store.getItemDetail({ documentId, itemId: r.id });
      expect(d.fields.find((f) => f.name.toLowerCase() === 'keywords')?.rawValue).toBe('todo');
    }
    store.undo(documentId);
    const first = store.listPublications({ documentId, offset: 0, limit: -1 }).rows[0]!;
    const d = store.getItemDetail({ documentId, itemId: first.id });
    expect(d.fields.find((f) => f.name.toLowerCase() === 'keywords')).toBeUndefined();
  });

  it('an empty value clears the field; a subset can be targeted', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(
      '@article{a, Title={A}, Note={old}}\n@book{b, Title={B}, Note={old}}',
      '/tmp/bf2.bib',
    );
    expect(store.agentBatchSetField(documentId, 'Note', '', ['a']).count).toBe(1);
    const rows = store.listPublications({ documentId, offset: 0, limit: -1 }).rows;
    const noteOf = (k: string): string | undefined => {
      const id = rows.find((r) => r.citeKey === k)!.id;
      return store.getItemDetail({ documentId, itemId: id }).fields.find((f) => f.name === 'Note')?.rawValue;
    };
    expect(noteOf('a')).toBeUndefined(); // cleared
    expect(noteOf('b')).toBe('old'); // untouched
  });
});
