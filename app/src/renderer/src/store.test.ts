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
  Settings,
  Unsubscribe,
} from '@bibdesk/shared';
import { DEFAULT_SETTINGS } from '@bibdesk/shared';
import { createStore, filterRows, visibleRows, citeStyleLabel } from './store.js';

const DOC: OpenedDocument = {
  documentId: 'doc-1',
  path: '/tmp/test.bib',
  displayName: 'test.bib',
  itemCount: 3,
  warnings: [],
  encoding: 'utf8',
};

const GROUPS: GroupNode[] = [
  { id: 'lib', kind: 'library', name: 'Library', count: 3 },
  { id: 'g1', kind: 'static', name: 'Favourites', count: 2 },
];

const FLAGS = { hasKeywords: false, hasAnnotation: false, attachmentCount: 0, read: 0, rating: 0 } as const;
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
  const calls: {
    listPublications: ListPublicationsRequest[];
    openEditor: string[];
    exportTemplate: { templateName: string; itemIds?: readonly string[] }[];
    updateSettings: Partial<Settings>[];
  } = { listPublications: [], openEditor: [], exportTemplate: [], updateSettings: [] };
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
      const specs =
        req.sort && req.sort.length > 0 ? req.sort : [{ key: 'citeKey', direction: 'asc' as const }];
      const sorted = [...base].sort((a, b) => {
        for (const s of specs) {
          const k = s.key as keyof PublicationRow;
          const cmp = String(a[k]).localeCompare(String(b[k]));
          if (cmp !== 0) return s.direction === 'asc' ? cmp : -cmp;
        }
        return 0;
      });
      return { rows: sorted, total: sorted.length };
    },
    getItemDetail: async () => DETAIL,
    renderMultiPanel: async (r) => ({ count: r.itemIds.length }),
    openExternal: async () => ({ ok: true }),
    applyEdit: async (r) =>
      r.command.kind === 'addEntry'
        ? { dirty: true, affectedItemId: 'new-1', detail: DETAIL }
        : { dirty: true },
    batchEdit: async (r) => ({ dirty: true, count: r.itemIds.length }),
    listMacros: async () => ({ macros: [] }),
    saveDocument: async (r) => ({ documentId: r.documentId, path: '/tmp/test.bib' }),
    formatCitation: async (r) => ({ styleId: r.styleId, html: '<div>cite</div>' }),
    copyRtf: async () => ({ ok: true }),
    listCitationStyles: async () => ({ styles: [] }),
    installCitationStyle: async () => ({}),
    removeCitationStyle: async () => ({ ok: true }),
    texPreview: async () => ({ ok: true }),
    journalCover: async () => ({ data: null }),
    setJournalCover: async () => ({ ok: false }),
    scanJournalCovers: async () => ({ proposals: [], missing: 0 }),
    saveJournalCovers: async () => ({ saved: 0 }),
    print: async () => ({ ok: true }),
    exportSelection: async () => ({ ok: true }),
    addAttachment: async () => ({ dirty: true }),
    removeAttachment: async () => ({ dirty: true }),
    autoFile: async () => ({ moved: 0, errors: [], dirty: true, detail: DETAIL }),
    consolidateLinkedFiles: async () => ({ scanned: 0, itemsAffected: 0, moved: 0, dirty: true, errors: [] }),
    chooseFolder: async () => ({ path: null }),
    agentKeyStatus: async () => ({ hasKey: false, encryptionAvailable: true }),
    agentSetKey: async () => ({ hasKey: true, encryptionAvailable: true }),
    agentRun: async () => ({ reply: '', toolLog: [], mutated: false }),
    runScript: async () => ({ output: [], mutated: false }),
    agentReset: async () => ({ ok: true as const }),
    searchOnline: async () => ({ results: [] }),
    importOnline: async () => ({ dirty: true }),
    ftsSearch: async () => ({ available: false, ids: [] }),
    getSettings: async () => DEFAULT_SETTINGS,
    updateSettings: async (r) => {
      calls.updateSettings.push(r.patch);
      return { ...DEFAULT_SETTINGS, ...r.patch };
    },
    listEntryTypes: async () => ({ types: [] }),
    selectFromAux: async () => ({ canceled: true, matchedIds: [], matchedKeys: [], missingKeys: [] }),
    exportFolderTree: async () => ({ canceled: true, copied: 0, errors: [] }),
    setColor: async () => ({ count: 0 }),
    selectIncomplete: async () => ({ itemIds: [] }),
    previewTemplate: async () => ({ text: '' }),
    previewPanel: async () => ({ html: '' }),
    exportTemplate: async (r) => {
      calls.exportTemplate.push({ templateName: r.templateName, itemIds: r.itemIds });
      return { ok: true };
    },
    readAttachment: async () => ({ data: null }),
    exportText: async () => ({ text: '' }),
    pasteEntries: async () => ({ dirty: true, addedIds: [], warnings: [] }),
    importFiles: async () => ({ dirty: true, addedIds: [], warnings: [] }),
    importDialog: async () => ({ dirty: false, addedIds: [], warnings: [] }),
    commitStagedEntry: async () => ({ itemId: 'committed' }),
    discardStagingDoc: async () => ({ ok: true }),
    findReplace: async () => ({ matches: [], total: 0, applied: false, dirty: false }),
    findDuplicates: async () => ({ groups: [], total: 0 }),
    findBrokenLinks: async () => ({ links: [] }),
    findOpenAccessPdf: async () => ({ results: [] }),
    fetchPdfBytes: async () => ({ data: null }),
    attachPdfBytes: async () => ({ ok: true }),
    relocateAttachment: async () => ({ dirty: true }),
    groupEdit: async () => ({ dirty: true, groupId: 'g#0#0' }),
    groupConditions: async () => ({ name: 'Smart', conjunction: 0, conditions: [] }),
    renameAuthor: async () => ({ changed: 0, dirty: false }),
    openEditor: async (r) => {
      calls.openEditor.push(r.itemId);
      return { ok: true as const };
    },
    openAnnotation: async () => ({ ok: true as const }),
    openDialog: async () => ({ ok: true as const }),
    newDocument: async () => ({ ok: true as const }),
    fieldSuggestions: async () => ({ values: [] }),
    pathForFile: () => '',
    onMenuCommand: (): Unsubscribe => () => {},
    onMenuToggleColumn: (): Unsubscribe => () => {},
    onMenuExportTemplate: (): Unsubscribe => () => {},
    onMenuSetColor: (): Unsubscribe => () => {},
    onDocumentOpened: (): Unsubscribe => () => {},
    onDocumentClosed: (): Unsubscribe => () => {},
    onDocumentChanged: (): Unsubscribe => () => {},
    onOaPdfProgress: (): Unsubscribe => () => {},
    onIndexProgress: (): Unsubscribe => () => {},
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

  it('dropping entries onto a group (setMembers) does not switch the selected group', async () => {
    const { api } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);
    expect(store.getState().selectedGroupId).toBe('lib'); // library view

    // Drag-drop add-to-group: the fake groupEdit returns groupId 'g#0#0', but the
    // table must stay on the library — the dropped-on group is not selected.
    await store.getState().groupEdit({ kind: 'setMembers', groupId: 'g1', citeKeys: ['alpha2019'], add: true });
    expect(store.getState().selectedGroupId).toBe('lib');
  });

  it('selectFolder selects the folder, clears the group filter, and shows the library', async () => {
    const { api, calls } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);
    expect(store.getState().selectedGroupId).toBe('lib');

    await store.getState().selectFolder('f1');
    const s = store.getState();
    expect(s.selectedFolderId).toBe('f1');
    expect(s.selectedGroupId).toBeUndefined(); // mutually exclusive with group selection
    // a folder filters nothing: the reload carries no groupId (full library)
    const last = calls.listPublications.at(-1)!;
    expect(last.groupId).toBeUndefined();
    expect(s.rows.map((r) => r.citeKey)).toEqual(['alpha2019', 'beta2020', 'gamma2021']);
  });

  it('selectGroup clears any selected folder (selection is mutually exclusive)', async () => {
    const { api } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);

    await store.getState().selectFolder('f1');
    expect(store.getState().selectedFolderId).toBe('f1');

    await store.getState().selectGroup('g1');
    expect(store.getState().selectedFolderId).toBeUndefined();
    expect(store.getState().selectedGroupId).toBe('g1');
  });

  it('createFolder selects the new folder; createStatic selects the new group', async () => {
    const { api } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);

    // fake groupEdit returns groupId 'g#0#0' for every command
    await store.getState().groupEdit({ kind: 'createFolder', name: 'New Folder' });
    expect(store.getState().selectedFolderId).toBe('g#0#0');
    expect(store.getState().selectedGroupId).toBeUndefined();

    await store.getState().groupEdit({ kind: 'createStatic', name: 'New Group' });
    expect(store.getState().selectedGroupId).toBe('g#0#0');
    expect(store.getState().selectedFolderId).toBeUndefined();
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

  it('selectByCiteKeys selects every cited entry (multi-entry \\cite click)', async () => {
    const { api } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);

    await store.getState().selectByCiteKeys(['beta2020', 'gamma2021']); // → i1, i3
    expect(store.getState().selectedIds.sort()).toEqual(['i1', 'i3']);

    // a single key falls back to the single-select path
    await store.getState().selectByCiteKeys(['alpha2019']); // → i2
    expect(store.getState().selectedIds).toEqual(['i2']);
    expect(store.getState().selectedItemId).toBe('i2');
  });

  it('setSort flips direction on repeated calls to the same key', async () => {
    const { api, calls } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);

    // default is citeKey asc
    expect(store.getState().sort).toEqual([{ key: 'citeKey', direction: 'asc' }]);

    await store.getState().setSort('citeKey');
    expect(store.getState().sort).toEqual([{ key: 'citeKey', direction: 'desc' }]);
    expect(store.getState().rows.map((r) => r.citeKey)).toEqual([
      'gamma2021',
      'beta2020',
      'alpha2019',
    ]);

    // switching to a new key starts at asc
    await store.getState().setSort('year');
    expect(store.getState().sort).toEqual([{ key: 'year', direction: 'asc' }]);

    const last = calls.listPublications.at(-1)!;
    expect(last.sort).toEqual([{ key: 'year', direction: 'asc' }]);
  });

  it('setSort with additive builds a multi-key sort and cycles asc→desc→remove', async () => {
    const { api, calls } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);

    // Primary: type asc. Then shift-click year to add it as a secondary key.
    await store.getState().setSort('type');
    await store.getState().setSort('year', true);
    expect(store.getState().sort).toEqual([
      { key: 'type', direction: 'asc' },
      { key: 'year', direction: 'asc' },
    ]);
    // Secondary key breaks ties: both 'article' rows ordered by year asc, then 'book'.
    expect(store.getState().rows.map((r) => r.citeKey)).toEqual([
      'beta2020',
      'gamma2021',
      'alpha2019',
    ]);

    // Shift-click again flips the secondary key to desc.
    await store.getState().setSort('year', true);
    expect(store.getState().sort).toEqual([
      { key: 'type', direction: 'asc' },
      { key: 'year', direction: 'desc' },
    ]);
    expect(store.getState().rows.map((r) => r.citeKey)).toEqual([
      'gamma2021',
      'beta2020',
      'alpha2019',
    ]);

    // A third shift-click removes it, leaving just the primary key.
    await store.getState().setSort('year', true);
    expect(store.getState().sort).toEqual([{ key: 'type', direction: 'asc' }]);

    const last = calls.listPublications.at(-1)!;
    expect(last.sort).toEqual([{ key: 'type', direction: 'asc' }]);
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

  it('a new publication becomes the sole selection and opens its editor', async () => {
    const { api, calls } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);
    // Pre-existing multi-selection that must NOT linger after the add.
    store.getState().toggleSelect('i2');
    expect(store.getState().selectedIds).toContain('i2');

    await store.getState().edit({ kind: 'addEntry', entryType: 'article' });
    const s = store.getState();
    expect(s.selectedItemId).toBe('new-1'); // primary selection is the new entry
    expect(s.selectedIds).toEqual(['new-1']); // prior selection cleared
    expect(calls.openEditor).toContain('new-1'); // editor opened on it
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

  it('setLayout updates locally always, and persists only when asked', async () => {
    const { api, calls } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);

    // live drag: local update, no persistence round-trip
    store.getState().setLayout({ rightPaneWidth: 500 }, false);
    expect(store.getState().settings.layout.rightPaneWidth).toBe(500);
    expect(calls.updateSettings).toHaveLength(0);

    // commit: persists the full merged layout (carrying the live width)
    store.getState().setLayout({ rightPaneVisible: false });
    expect(store.getState().settings.layout.rightPaneVisible).toBe(false);
    const last = calls.updateSettings.at(-1)!;
    expect(last.layout?.rightPaneWidth).toBe(500);
    expect(last.layout?.rightPaneVisible).toBe(false);
  });

  it('exportTemplate resolves the scope to ordered itemIds', async () => {
    const { api, calls } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC); // display order (citeKey asc): i2, i1, i3

    // Whole library → no itemIds (main renders the whole library).
    await store.getState().exportTemplate('T', 'library');
    expect(calls.exportTemplate.at(-1)!.itemIds).toBeUndefined();

    // Shown → the visible rows in display order.
    await store.getState().exportTemplate('T', 'shown');
    expect(calls.exportTemplate.at(-1)!.itemIds).toEqual(['i2', 'i1', 'i3']);

    // Selected → only the selection, still in display order (not click order).
    store.getState().toggleSelect('i3');
    store.getState().toggleSelect('i1');
    await store.getState().exportTemplate('T', 'selected');
    expect(calls.exportTemplate.at(-1)!.itemIds).toEqual(['i1', 'i3']);
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

describe('citeStyleLabel', () => {
  const styles = [
    { id: 'apa', label: 'APA' },
    { id: 'user-phil-sci', label: 'Phil. Sci.', custom: true },
  ];

  it('resolves a bundled style id to its label', () => {
    expect(citeStyleLabel(styles, 'apa')).toBe('APA');
  });

  it('resolves an installed style id to its .csl title, not the raw id', () => {
    expect(citeStyleLabel(styles, 'user-phil-sci')).toBe('Phil. Sci.');
  });

  it('falls back to the raw id for an unknown / not-yet-loaded style', () => {
    expect(citeStyleLabel(styles, 'user-not-loaded')).toBe('user-not-loaded');
    expect(citeStyleLabel([], 'apa')).toBe('apa');
  });
});

describe('pdf review queue (drop-a-PDF)', () => {
  const batch = (n: number) => ({
    dirty: true,
    addedIds: [] as string[],
    warnings: [] as string[],
    summary: { created: 0, linked: 0, review: n },
    review: {
      stagingDocId: 'stage-1',
      items: Array.from({ length: n }, (_, i) => ({ itemId: `s${i}`, pdf: `/p/${i}.pdf`, name: `${i}.pdf` })),
    },
  });

  it('afterImport opens the review with the staged items', async () => {
    const { api } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);
    await store.getState().afterImport(batch(2));
    const r = store.getState().pdfReview!;
    expect(r.stagingDocId).toBe('stage-1');
    expect(r.items.map((i) => i.itemId)).toEqual(['s0', 's1']);
    expect(r.accepted).toEqual([]);
  });

  it('discardStagedPdf drops one; discarding the last finishes the review', async () => {
    const { api } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);
    await store.getState().afterImport(batch(2));
    store.getState().discardStagedPdf('s0');
    expect(store.getState().pdfReview!.items.map((i) => i.itemId)).toEqual(['s1']);
    store.getState().discardStagedPdf('s1');
    await Promise.resolve();
    expect(store.getState().pdfReview).toBeNull(); // queue empty → review closed
  });

  it('acceptStagedPdf commits the draft and records the created id', async () => {
    const { api } = makeFakeApi();
    const store = createStore(api);
    await store.getState().onDocumentOpened(DOC);
    await store.getState().afterImport(batch(2));
    await store.getState().acceptStagedPdf('s0');
    const r = store.getState().pdfReview!;
    expect(r.items.map((i) => i.itemId)).toEqual(['s1']); // accepted one removed
    expect(r.accepted).toEqual(['committed']); // fake commitStagedEntry returns this id
  });
});
