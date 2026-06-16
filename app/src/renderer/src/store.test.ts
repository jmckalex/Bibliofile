/**
 * Store unit tests — node env, no DOM. Drives {@link createStore} with an
 * in-memory fake BibDeskApi and asserts the data-flow: documentOpened loads
 * groups + rows, selectGroup reloads filtered, selectItem fills detail,
 * setSort flips direction.
 */

import { describe, expect, it } from 'vitest';
import type {
  BibDeskApi,
  GroupNode,
  ItemDetail,
  ListPublicationsRequest,
  OpenedDocument,
  PublicationRow,
  Unsubscribe,
} from '@bibdesk/shared';
import { DEFAULT_SETTINGS } from '@bibdesk/shared';
import { createStore, filterRows, visibleRows } from './store.js';

const DOC: OpenedDocument = {
  documentId: 'doc-1',
  path: '/tmp/test.bib',
  displayName: 'test.bib',
  itemCount: 3,
  warnings: [],
};

const GROUPS: GroupNode[] = [
  { id: 'lib', kind: 'library', name: 'Library', count: 3 },
  { id: 'g1', kind: 'static', name: 'Favourites', count: 2 },
];

const FLAGS = { hasKeywords: false, attachmentCount: 0, read: 0, rating: 0 } as const;
const ALL_ROWS: PublicationRow[] = [
  { id: 'i1', citeKey: 'beta2020', type: 'article', authorsDisplay: 'B. Author', title: 'Beta', year: '2020', ...FLAGS },
  { id: 'i2', citeKey: 'alpha2019', type: 'book', authorsDisplay: 'A. Author', title: 'Alpha', year: '2019', ...FLAGS },
  { id: 'i3', citeKey: 'gamma2021', type: 'article', authorsDisplay: 'C. Author', title: 'Gamma', year: '2021', ...FLAGS },
];

const GROUP_ROWS: Record<string, PublicationRow[]> = {
  g1: [ALL_ROWS[0]!, ALL_ROWS[2]!],
};

const DETAIL: ItemDetail = {
  id: 'i1',
  citeKey: 'beta2020',
  type: 'article',
  fields: [{ name: 'Title', value: 'Beta', rawValue: 'Beta', isInherited: false }],
  files: [],
  previewHtml: '<p>Beta</p>',
  notesRaw: '',
  notesHtml: '',
};

/** Records the requests it receives so tests can assert on them. */
function makeFakeApi() {
  const calls: { listPublications: ListPublicationsRequest[] } = { listPublications: [] };
  const api: BibDeskApi = {
    openDocument: async () => DOC,
    closeDocument: async (r) => ({ documentId: r.documentId }),
    listGroups: async () => ({ groups: GROUPS }),
    listPublications: async (req) => {
      calls.listPublications.push(req);
      // The library group (and an absent groupId) returns the whole library;
      // other groups filter to their members.
      const base =
        req.groupId && req.groupId !== 'lib' ? (GROUP_ROWS[req.groupId] ?? []) : ALL_ROWS;
      const dir = req.sort?.direction ?? 'asc';
      const key = (req.sort?.key ?? 'citeKey') as keyof PublicationRow;
      const sorted = [...base].sort((a, b) =>
        dir === 'asc'
          ? String(a[key]).localeCompare(String(b[key]))
          : String(b[key]).localeCompare(String(a[key])),
      );
      return { rows: sorted, total: sorted.length };
    },
    getItemDetail: async () => DETAIL,
    openExternal: async () => ({ ok: true }),
    applyEdit: async () => ({ dirty: true }),
    listMacros: async () => ({ macros: [] }),
    saveDocument: async (r) => ({ documentId: r.documentId, path: '/tmp/test.bib' }),
    formatCitation: async (r) => ({ styleId: r.styleId, html: '<div>cite</div>' }),
    addAttachment: async () => ({ dirty: true }),
    removeAttachment: async () => ({ dirty: true }),
    searchOnline: async () => ({ results: [] }),
    importOnline: async () => ({ dirty: true }),
    ftsSearch: async () => ({ available: false, ids: [] }),
    getSettings: async () => DEFAULT_SETTINGS,
    updateSettings: async (r) => ({ ...DEFAULT_SETTINGS, ...r.patch }),
    readAttachment: async () => ({ data: null }),
    exportText: async () => ({ text: '' }),
    pasteEntries: async () => ({ dirty: true, addedIds: [], warnings: [] }),
    importFiles: async () => ({ dirty: true, addedIds: [], warnings: [] }),
    findReplace: async () => ({ matches: [], total: 0, applied: false, dirty: false }),
    findDuplicates: async () => ({ groups: [], total: 0 }),
    fieldSuggestions: async () => ({ values: [] }),
    pathForFile: () => '',
    onMenuCommand: (): Unsubscribe => () => {},
    onMenuToggleColumn: (): Unsubscribe => () => {},
    onDocumentOpened: (): Unsubscribe => () => {},
    onDocumentClosed: (): Unsubscribe => () => {},
    onShowPreferences: (): Unsubscribe => () => {},
  };
  return { api, calls };
}

describe('viewer store', () => {
  it('onDocumentOpened loads groups + rows and defaults to the library group', async () => {
    const { api } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);

    const s = store.getState();
    expect(s.documentId).toBe('doc-1');
    expect(s.displayName).toBe('test.bib');
    expect(s.itemCount).toBe(3);
    expect(s.groups).toHaveLength(2);
    expect(s.selectedGroupId).toBe('lib'); // library is default
    expect(s.total).toBe(3);
    expect(s.rows.map((r) => r.citeKey)).toEqual(['alpha2019', 'beta2020', 'gamma2021']);
  });

  it('selectGroup reloads publications with the right groupId', async () => {
    const { api, calls } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);

    await store.getState().selectGroup('g1');
    const s = store.getState();
    expect(s.selectedGroupId).toBe('g1');
    expect(s.rows.map((r) => r.id).sort()).toEqual(['i1', 'i3']);
    expect(s.total).toBe(2);
    // last listPublications request carried groupId 'g1'
    const last = calls.listPublications.at(-1)!;
    expect(last.groupId).toBe('g1');
    expect(last.limit).toBe(-1);
  });

  it('selectItem populates detail', async () => {
    const { api } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);

    await store.getState().selectItem('i1');
    const s = store.getState();
    expect(s.selectedItemId).toBe('i1');
    expect(s.detail?.citeKey).toBe('beta2020');
    expect(s.detailLoading).toBe(false);
  });

  it('setSort flips direction on repeated calls to the same key', async () => {
    const { api, calls } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);

    // default is citeKey asc
    expect(store.getState().sort).toEqual({ key: 'citeKey', direction: 'asc' });

    await store.getState().setSort('citeKey');
    expect(store.getState().sort).toEqual({ key: 'citeKey', direction: 'desc' });
    expect(store.getState().rows.map((r) => r.citeKey)).toEqual([
      'gamma2021',
      'beta2020',
      'alpha2019',
    ]);

    // switching to a new key starts at asc
    await store.getState().setSort('year');
    expect(store.getState().sort).toEqual({ key: 'year', direction: 'asc' });

    const last = calls.listPublications.at(-1)!;
    expect(last.sort).toEqual({ key: 'year', direction: 'asc' });
  });

  it('edit marks dirty + refreshes; save clears dirty', async () => {
    const { api } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);
    expect(store.getState().dirty).toBe(false);

    await store.getState().edit({ kind: 'setField', itemId: 'i1', field: 'Title', value: 'X' });
    expect(store.getState().dirty).toBe(true);

    await store.getState().save();
    expect(store.getState().dirty).toBe(false);
  });

  it('setQuery stores the query (client-side filter, no reload)', async () => {
    const { api, calls } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);
    const before = calls.listPublications.length;

    store.getState().setQuery('gamma');
    expect(store.getState().query).toBe('gamma');
    // filtering is client-side: no extra listPublications round-trip
    expect(calls.listPublications.length).toBe(before);
  });
});

describe('filterRows', () => {
  it('returns all rows for an empty/whitespace query', () => {
    expect(filterRows(ALL_ROWS, '')).toHaveLength(3);
    expect(filterRows(ALL_ROWS, '   ')).toHaveLength(3);
  });

  it('matches case-insensitively across cite key, type, authors, title, year', () => {
    expect(filterRows(ALL_ROWS, 'ALPHA').map((r) => r.id)).toEqual(['i2']);
    expect(filterRows(ALL_ROWS, 'book').map((r) => r.id)).toEqual(['i2']);
    expect(filterRows(ALL_ROWS, 'b. author').map((r) => r.id)).toEqual(['i1']);
    expect(filterRows(ALL_ROWS, '2021').map((r) => r.id)).toEqual(['i3']);
    expect(filterRows(ALL_ROWS, 'zzz')).toHaveLength(0);
  });
});

describe('visibleRows', () => {
  it('returns all rows when the query is empty', () => {
    expect(visibleRows(ALL_ROWS, '', null)).toHaveLength(3);
    expect(visibleRows(ALL_ROWS, '', ['i1'])).toHaveLength(3); // ftsIds ignored w/o query
  });

  it('falls back to substring filter when no FTS ids', () => {
    expect(visibleRows(ALL_ROWS, 'alpha', null).map((r) => r.id)).toEqual(['i2']);
  });

  it('orders by FTS relevance and drops non-matches when ftsIds present', () => {
    const out = visibleRows(ALL_ROWS, 'anything', ['i3', 'i1']);
    expect(out.map((r) => r.id)).toEqual(['i3', 'i1']); // i2 excluded; order = ftsIds
  });
});
