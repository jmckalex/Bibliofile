/**
 * Zustand store + factored data-flow logic for the read-only viewer.
 *
 * The data-flow logic is intentionally decoupled from any DOM/React: the store
 * is created by {@link createStore} against a `BibDeskApi` instance, so unit
 * tests can drive it with an in-memory fake api (no Electron, no jsdom). The
 * default export {@link useStore} binds the store to `window.bibdesk` for the
 * live app.
 */

import { createStore as createZustandStore, useStore as useZustandStore } from 'zustand';
import type {
  AgentRunResponse,
  BatchOp,
  BibDeskApi,
  EditCommand,
  GroupCommand,
  GroupConditionsResponse,
  FindReplaceRequest,
  FindReplaceResult,
  FindDuplicatesResult,
  BrokenLink,
  GroupNode,
  ImportResult,
  ItemDetail,
  MacroDef,
  OnlineResult,
  OpenedDocument,
  PublicationRow,
  Settings,
  SortSpec,
  EntryTypeInfo,
} from '@bibdesk/shared';
import { DEFAULT_SETTINGS, BUILTIN_COLUMNS } from '@bibdesk/shared';

/** Apply the chosen theme to the document root (`system` follows the OS). */
export function applyTheme(theme: Settings['theme']): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** The fixed id of the always-present "library" group (selected by default). */
function findDefaultGroupId(groups: readonly GroupNode[]): string | undefined {
  const library = groups.find((g) => g.kind === 'library');
  return library?.id ?? groups[0]?.id;
}

/**
 * Case-insensitive substring filter across a row's display columns. Pure +
 * exported for unit testing. An empty/whitespace query returns all rows.
 */
export function filterRows(
  rows: readonly PublicationRow[],
  query: string,
): PublicationRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) =>
    `${r.citeKey} ${r.type} ${r.authorsDisplay} ${r.title} ${r.year}`
      .toLowerCase()
      .includes(q),
  );
}

/**
 * The rows to display for the current query. With no query → all rows. When
 * full-text results (`ftsIds`) are available, intersect the current rows with
 * them in relevance order (this is how PDF-text / abstract / notes matches
 * surface). Otherwise fall back to the client-side substring {@link filterRows}.
 */
export function visibleRows(
  rows: readonly PublicationRow[],
  query: string,
  ftsIds: readonly string[] | null,
): PublicationRow[] {
  if (!query.trim()) return [...rows];
  if (ftsIds) {
    const order = new Map(ftsIds.map((id, i) => [id, i]));
    return rows.filter((r) => order.has(r.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }
  return filterRows(rows, query);
}

export interface ViewerState {
  /** Active document, set once `documentOpened` fires. */
  documentId?: string;
  displayName?: string;
  itemCount: number;
  warnings: number;

  /** Publications table data (all rows; client-side virtualized). */
  rows: PublicationRow[];
  total: number;

  /** Groups sidebar data (flat; tree built in the component). */
  groups: GroupNode[];
  selectedGroupId?: string;

  /** Detail pane: the primary (last-clicked) item. */
  selectedItemId?: string;
  detail?: ItemDetail;
  /** Multi-selection (always includes selectedItemId); drives batch operations. */
  selectedIds: string[];

  /** Current table sort keys in priority order (default: cite key asc). */
  sort: readonly SortSpec[];

  /** Live search query. */
  query: string;
  /** Full-text (FTS5) result ids in relevance order, or null to use the substring filter. */
  ftsIds: string[] | null;

  /** Application preferences. */
  settings: Settings;
  /** Document-level `@string` macros (for the macro editor). */
  macros: MacroDef[];
  /** True when there are unsaved edits. */
  dirty: boolean;
  /** True while a save is in flight. */
  saving: boolean;

  loading: boolean;
  detailLoading: boolean;
  error?: string;
  /** True in the standalone editor window: skip table/group reloads on edits. */
  editorMode: boolean;

  // --- actions ---
  /** Handle a `documentOpened` event: store ids, then load groups + rows. */
  onDocumentOpened: (doc: OpenedDocument) => Promise<void>;
  /** Initialise the standalone editor window for one item (no table/sidebar). */
  initEditor: (documentId: string, itemId: string) => Promise<void>;
  /** Another window changed the document: reload sidebar + rows + current detail. */
  reloadAfterExternalChange: () => Promise<void>;
  /** Open the standalone editor window for an item (BibDesk-style separate editor). */
  openEditor: (itemId: string) => void;
  /** (Re)load the groups sidebar for the active document. */
  loadGroups: () => Promise<void>;
  /** (Re)load publications for the current group + sort (limit -1 = all). */
  loadPublications: () => Promise<void>;
  /** Select a group and reload the filtered publications. */
  selectGroup: (groupId: string) => Promise<void>;
  /** Select a row and load its full detail (replaces any multi-selection). */
  selectItem: (itemId: string) => Promise<void>;
  /** Load one item's detail into the pane WITHOUT touching the multi-selection. */
  loadDetail: (itemId: string) => Promise<void>;
  /** Cmd/Ctrl-click: toggle one row in/out of the multi-selection. */
  toggleSelect: (itemId: string) => void;
  /** Shift-click: extend the selection from the primary to this row (visible order). */
  rangeSelectTo: (itemId: string, orderedIds: readonly string[]) => void;
  /** Apply a batch operation to the current multi-selection; reload. */
  batchEdit: (op: BatchOp) => Promise<void>;
  /** Select an entry by cite key (used by notes `[[citeKey]]` cross-references). */
  selectByCiteKey: (citeKey: string) => Promise<void>;
  /**
   * Sort by a column header. Plain click sorts by that column alone (toggling
   * direction when it is already the sole key); `additive` (shift-click) cycles
   * the column within the multi-key sort: add ascending → descending → remove.
   */
  setSort: (key: string, additive?: boolean) => Promise<void>;
  /** Set the live search query; runs a full-text search (falls back to substring). */
  setQuery: (query: string) => Promise<void>;
  /** Toggle whether the filter box also searches PDF body text; re-runs the query. */
  setFullTextSearch: (on: boolean) => Promise<void>;
  /** Apply one edit command, then refresh the affected views + dirty state. */
  edit: (command: EditCommand) => Promise<void>;
  /** Save the document to disk (explicit save + backup). */
  save: () => Promise<void>;
  /** (Re)load the document's `@string` macros. */
  loadMacros: () => Promise<void>;
  /** Attach file(s) to an item (opens a picker in main); refresh detail + dirty. */
  addAttachment: (itemId: string) => Promise<void>;
  /** Remove one managed attachment (`Bdsk-File-N`) from an item. */
  removeAttachment: (itemId: string, field: string) => Promise<void>;
  /** AutoFile an item's attachments into the Papers folder; refresh detail. */
  autoFile: (itemId: string) => Promise<void>;
  /** Consolidate linked files for the current selection (2+ rows) or the whole library. */
  consolidateLinkedFiles: () => Promise<void>;
  /** Import an online search result as a new entry; refresh + select it. */
  importOnline: (result: OnlineResult) => Promise<void>;
  /** Paste BibTeX text as new entries; refresh + select the first added. */
  pasteEntries: (text: string) => Promise<void>;
  /** Import dropped file paths (.bib merge / file→entry); refresh + select. */
  importFiles: (paths: readonly string[]) => Promise<void>;
  /** Open a file picker (in main) and import the chosen files; refresh + select. */
  importFromDialog: () => Promise<void>;
  /** Internal: refresh groups/rows + select the first added item after an import. */
  afterImport: (res: ImportResult) => Promise<void>;
  /** Find/replace over field values (scoped to the current group); refresh on apply. */
  findReplace: (opts: Omit<FindReplaceRequest, 'documentId' | 'groupId'>) => Promise<FindReplaceResult>;
  /** Scan the document for duplicate entries. */
  findDuplicates: () => Promise<FindDuplicatesResult>;
  /** Scan the document for attachments whose file is missing on disk. */
  findBrokenLinks: () => Promise<BrokenLink[]>;
  /** Repair a broken managed attachment by picking a replacement file (opens a dialog). */
  relocateAttachment: (itemId: string, field: string) => Promise<void>;
  /** Distinct existing values for a field (editor autocomplete). */
  fieldSuggestions: (field: string) => Promise<readonly string[]>;
  /** Known entry types (standard + custom) for the type dropdowns and editor. */
  entryTypes: readonly EntryTypeInfo[];
  /** Load preferences from main and apply the theme. */
  loadSettings: () => Promise<void>;
  /** Load the known entry types (standard + custom) from main. */
  loadEntryTypes: () => Promise<void>;
  /** Patch preferences, persist via main, and re-apply the theme. */
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  /** Show/hide one table column key (builtin or field name); persists + reloads. */
  toggleColumn: (key: string) => Promise<void>;
  /** Apply a group command (create/rename/delete/membership); reloads the sidebar. */
  groupEdit: (command: GroupCommand) => Promise<string | undefined>;
  /** Read a smart group's name/conjunction/conditions (to pre-fill the editor). */
  groupConditions: (groupId: string) => Promise<GroupConditionsResponse | undefined>;
  /** Rename (and merge) an author across all entries; reloads the table + sidebar. */
  renameAuthor: (oldName: string, newName: string) => Promise<void>;
  /** Print the current selection (if >1) or the whole current view as a bibliography. */
  print: () => Promise<void>;
  /** Export the current selection (multi, else the single selected entry) to a BibTeX file. */
  exportSelection: () => Promise<void>;
  /** Send one message to the Claude assistant; reloads the table if it mutated. */
  agentSend: (message: string) => Promise<AgentRunResponse>;
}

const DEFAULT_SORT: readonly SortSpec[] = [{ key: 'citeKey', direction: 'asc' }];

/**
 * Build a Zustand vanilla store wired to the given api. Exported (rather than a
 * module-level singleton) so tests can inject a fake api.
 */
export function createStore(api: BibDeskApi) {
  return createZustandStore<ViewerState>((set, get) => ({
    itemCount: 0,
    warnings: 0,
    rows: [],
    total: 0,
    groups: [],
    sort: DEFAULT_SORT,
    query: '',
    ftsIds: null,
    settings: DEFAULT_SETTINGS,
    entryTypes: [],
    macros: [],
    selectedIds: [],
    dirty: false,
    saving: false,
    loading: false,
    detailLoading: false,
    editorMode: false,

    onDocumentOpened: async (doc) => {
      set({
        documentId: doc.documentId,
        displayName: doc.displayName,
        itemCount: doc.itemCount,
        warnings: doc.warnings.length,
        // reset per-document view state
        selectedGroupId: undefined,
        selectedItemId: undefined,
        selectedIds: [],
        detail: undefined,
        rows: [],
        total: 0,
        groups: [],
        sort: DEFAULT_SORT,
        query: '',
        ftsIds: null,
        macros: [],
        // honor dirty (set when main re-opens the doc after undo/redo or Save As)
        dirty: doc.dirty ?? false,
        error: undefined,
      });
      await get().loadGroups();
      await get().loadPublications();
      await get().loadMacros();
    },

    initEditor: async (documentId, itemId) => {
      set({ editorMode: true, documentId, error: undefined });
      await get().loadSettings();
      set({ selectedItemId: itemId, selectedIds: [itemId] });
      await get().loadDetail(itemId);
    },

    openEditor: (itemId) => {
      const { documentId } = get();
      if (documentId && itemId) void api.openEditor({ documentId, itemId });
    },

    reloadAfterExternalChange: async () => {
      const { documentId, editorMode, selectedItemId } = get();
      if (!documentId) return;
      if (editorMode) {
        // Editor window: just refresh the item being edited.
        if (selectedItemId) await get().loadDetail(selectedItemId);
        return;
      }
      // Main window: refresh sidebar counts, the table, and the open view.
      await get().loadGroups();
      await get().loadPublications();
      set({ dirty: true });
      if (selectedItemId) await get().loadDetail(selectedItemId);
    },

    loadGroups: async () => {
      const { documentId } = get();
      if (!documentId) return;
      try {
        const { groups } = await api.listGroups({ documentId });
        const next = [...groups];
        set((s) => ({
          groups: next,
          // default to the library group if nothing is selected yet
          selectedGroupId: s.selectedGroupId ?? findDefaultGroupId(next),
        }));
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    loadPublications: async () => {
      const { documentId, selectedGroupId, sort, settings } = get();
      if (!documentId) return;
      set({ loading: true, error: undefined });
      try {
        const extraFields = settings.columns.filter(
          (c) => !(BUILTIN_COLUMNS as readonly string[]).includes(c),
        );
        const res = await api.listPublications({
          documentId,
          offset: 0,
          limit: -1,
          sort,
          ...(selectedGroupId ? { groupId: selectedGroupId } : {}),
          ...(extraFields.length ? { extraFields } : {}),
        });
        set({ rows: [...res.rows], total: res.total, loading: false });
      } catch (err) {
        set({ loading: false, error: errorMessage(err) });
      }
    },

    selectGroup: async (groupId) => {
      set({ selectedGroupId: groupId });
      await get().loadPublications();
    },

    loadDetail: async (itemId) => {
      const { documentId } = get();
      if (!documentId) return;
      set({ selectedItemId: itemId, detailLoading: true });
      try {
        const detail = await api.getItemDetail({ documentId, itemId });
        if (get().selectedItemId !== itemId) return; // ignore stale responses
        set({ detail, detailLoading: false });
      } catch (err) {
        set({ detailLoading: false, error: errorMessage(err) });
      }
    },

    selectItem: async (itemId) => {
      set({ selectedIds: [itemId] });
      await get().loadDetail(itemId);
    },

    toggleSelect: (itemId) => {
      const cur = get().selectedIds;
      const next = cur.includes(itemId) ? cur.filter((id) => id !== itemId) : [...cur, itemId];
      set({ selectedIds: next }); // synchronous — no race with the async detail load
      const primary = next.includes(itemId) ? itemId : next[next.length - 1];
      if (primary) void get().loadDetail(primary);
      else set({ selectedItemId: undefined, detail: undefined });
    },

    rangeSelectTo: (itemId, orderedIds) => {
      const anchor = get().selectedItemId ?? get().selectedIds[0];
      const a = anchor ? orderedIds.indexOf(anchor) : -1;
      const b = orderedIds.indexOf(itemId);
      if (a === -1 || b === -1) {
        void get().selectItem(itemId);
        return;
      }
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      set({ selectedIds: orderedIds.slice(lo, hi + 1) });
      void get().loadDetail(itemId);
    },

    batchEdit: async (op) => {
      const { documentId, selectedIds } = get();
      if (!documentId || selectedIds.length === 0) return;
      try {
        await api.batchEdit({ documentId, itemIds: selectedIds, op });
        set({ dirty: true });
        await get().loadGroups();
        await get().loadPublications();
        if (op.kind === 'delete') {
          set({ selectedItemId: undefined, selectedIds: [], detail: undefined });
        } else {
          const sel = get().selectedItemId;
          // loadDetail refreshes the pane without disturbing the multi-selection.
          if (sel) await get().loadDetail(sel);
        }
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    selectByCiteKey: async (citeKey) => {
      const lc = citeKey.toLowerCase();
      let row = get().rows.find((r) => r.citeKey.toLowerCase() === lc);
      if (!row) {
        // not in the current group view → switch to the full library, then retry
        const lib = get().groups.find((g) => g.kind === 'library');
        set({ selectedGroupId: lib?.id });
        await get().loadPublications();
        row = get().rows.find((r) => r.citeKey.toLowerCase() === lc);
      }
      if (row) await get().selectItem(row.id);
    },

    setSort: async (key, additive = false) => {
      const { sort } = get();
      let next: SortSpec[];
      if (additive) {
        // Shift-click cycles this column within the multi-key sort:
        // absent → ascending → descending → removed.
        const existing = sort.find((s) => s.key === key);
        if (!existing) {
          next = [...sort, { key, direction: 'asc' }];
        } else if (existing.direction === 'asc') {
          next = sort.map((s): SortSpec => (s.key === key ? { key, direction: 'desc' } : s));
        } else {
          next = sort.filter((s) => s.key !== key);
        }
        if (next.length === 0) next = [...DEFAULT_SORT];
      } else {
        // Plain click sorts by this column alone, flipping direction when it is
        // already the sole sort key.
        const sole = sort.length === 1 && sort[0]!.key === key;
        next = [{ key, direction: sole && sort[0]!.direction === 'asc' ? 'desc' : 'asc' }];
      }
      set({ sort: next });
      await get().loadPublications();
    },

    setQuery: async (query) => {
      // Show the substring fallback immediately; refine with FTS results when ready.
      set({ query, ftsIds: null });
      const { documentId, settings } = get();
      if (!documentId || !query.trim()) return;
      try {
        const res = await api.ftsSearch({ documentId, query, includePdf: settings.fullTextSearch });
        // ignore stale responses if the query changed while awaiting
        if (get().query !== query) return;
        set({ ftsIds: res.available ? [...res.ids] : null });
      } catch {
        set({ ftsIds: null });
      }
    },

    setFullTextSearch: async (on) => {
      await get().saveSettings({ fullTextSearch: on });
      // Re-run the active query under the new scope so results update immediately.
      const { query } = get();
      if (query.trim()) await get().setQuery(query);
    },

    edit: async (command) => {
      const { documentId, editorMode } = get();
      if (!documentId) return;
      const structural =
        command.kind === 'addEntry' ||
        command.kind === 'duplicateEntry' ||
        command.kind === 'deleteEntry' ||
        command.kind === 'mergeEntries';
      try {
        const res = await api.applyEdit({ documentId, command });
        set({ dirty: res.dirty, error: undefined });
        // The standalone editor has no table/sidebar to refresh; the main window
        // gets a documentChanged broadcast instead. Skip the heavy reloads here.
        if (!editorMode) {
          // structural edits can change category-group ids → re-default to Library
          if (structural) set({ selectedGroupId: undefined });
          await get().loadGroups();
          await get().loadPublications();
        }
        if (res.affectedItemId) {
          set({ selectedItemId: res.affectedItemId, detail: res.detail });
        } else if (command.kind === 'deleteEntry') {
          set({ selectedItemId: undefined, detail: undefined });
        }
        if (command.kind === 'setMacro' || command.kind === 'removeMacro') {
          await get().loadMacros();
        }
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    save: async () => {
      const { documentId, dirty } = get();
      if (!documentId || !dirty) return;
      set({ saving: true, error: undefined });
      try {
        await api.saveDocument({ documentId });
        set({ dirty: false, saving: false });
      } catch (err) {
        set({ saving: false, error: errorMessage(err) });
      }
    },

    loadMacros: async () => {
      const { documentId } = get();
      if (!documentId) return;
      try {
        const { macros } = await api.listMacros({ documentId });
        set({ macros: [...macros] });
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    addAttachment: async (itemId) => {
      const { documentId } = get();
      if (!documentId) return;
      try {
        const res = await api.addAttachment({ documentId, itemId });
        set({ dirty: res.dirty });
        if (res.detail) set({ selectedItemId: itemId, detail: res.detail });
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    removeAttachment: async (itemId, field) => {
      const { documentId } = get();
      if (!documentId) return;
      try {
        const res = await api.removeAttachment({ documentId, itemId, field });
        set({ dirty: res.dirty });
        if (res.detail) set({ detail: res.detail });
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    autoFile: async (itemId) => {
      const { documentId } = get();
      if (!documentId) return;
      try {
        const res = await api.autoFile({ documentId, itemId });
        set({ dirty: res.dirty, detail: res.detail });
        if (res.errors.length) set({ error: res.errors.join('; ') });
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    consolidateLinkedFiles: async () => {
      const { documentId, selectedIds, selectedItemId } = get();
      if (!documentId) return;
      try {
        // Confirm + summary dialogs (incl. any per-file errors) are shown by main.
        const itemIds = selectedIds.length >= 2 ? selectedIds : undefined;
        const res = await api.consolidateLinkedFiles({
          documentId,
          ...(itemIds ? { itemIds } : {}),
        });
        if (res.moved > 0) {
          set({ dirty: res.dirty });
          await get().loadPublications();
          if (selectedItemId) await get().loadDetail(selectedItemId);
        }
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    findBrokenLinks: async () => {
      const { documentId } = get();
      if (!documentId) return [];
      try {
        const res = await api.findBrokenLinks({ documentId });
        return [...res.links];
      } catch (err) {
        set({ error: errorMessage(err) });
        return [];
      }
    },

    relocateAttachment: async (itemId, field) => {
      const { documentId } = get();
      if (!documentId) return;
      try {
        const res = await api.relocateAttachment({ documentId, itemId, field });
        set({ dirty: res.dirty });
        // If the relocated item is the one on screen, refresh its detail pane.
        if (res.detail && get().selectedItemId === itemId) set({ detail: res.detail });
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    importOnline: async (result) => {
      const { documentId } = get();
      if (!documentId) return;
      try {
        const res = await api.importOnline({ documentId, result });
        set({ dirty: res.dirty, selectedGroupId: undefined });
        await get().loadGroups();
        await get().loadPublications();
        if (res.affectedItemId) set({ selectedItemId: res.affectedItemId, detail: res.detail });
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    pasteEntries: async (text) => {
      const { documentId } = get();
      if (!documentId || !text.trim()) return;
      try {
        const res = await api.pasteEntries({ documentId, text });
        await get().afterImport(res);
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    importFiles: async (paths) => {
      const { documentId } = get();
      if (!documentId || paths.length === 0) return;
      try {
        const res = await api.importFiles({ documentId, paths });
        await get().afterImport(res);
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    importFromDialog: async () => {
      const { documentId } = get();
      if (!documentId) return;
      try {
        const res = await api.importDialog({ documentId });
        if (res.addedIds.length || res.warnings.length) await get().afterImport(res);
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    afterImport: async (res) => {
      set({ dirty: res.dirty, selectedGroupId: undefined });
      await get().loadGroups();
      await get().loadPublications();
      // Cleared group => the table now lists the whole library; sync the header.
      set({ itemCount: get().total });
      const first = res.addedIds[0];
      if (first) await get().selectItem(first);
      if (res.warnings.length) set({ error: res.warnings.join('; ') });
    },

    findReplace: async (opts) => {
      const { documentId, selectedGroupId } = get();
      if (!documentId) return { matches: [], total: 0, applied: false, dirty: false };
      const res = await api.findReplace({
        documentId,
        ...(selectedGroupId ? { groupId: selectedGroupId } : {}),
        ...opts,
      });
      if (res.applied && res.total > 0) {
        set({ dirty: res.dirty });
        await get().loadPublications();
        const sel = get().selectedItemId;
        if (sel) await get().selectItem(sel); // refresh the detail pane
      }
      return res;
    },

    findDuplicates: async () => {
      const { documentId } = get();
      if (!documentId) return { groups: [], total: 0 };
      try {
        return await api.findDuplicates({ documentId });
      } catch (err) {
        set({ error: errorMessage(err) });
        return { groups: [], total: 0 };
      }
    },

    fieldSuggestions: async (field) => {
      const { documentId } = get();
      if (!documentId || !field) return [];
      try {
        const res = await api.fieldSuggestions({ documentId, field });
        return res.values;
      } catch {
        return [];
      }
    },

    loadSettings: async () => {
      try {
        const settings = await api.getSettings({});
        set({ settings });
        applyTheme(settings.theme);
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    loadEntryTypes: async () => {
      try {
        const { types } = await api.listEntryTypes();
        set({ entryTypes: types });
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    saveSettings: async (patch) => {
      try {
        const settings = await api.updateSettings({ patch });
        set({ settings });
        applyTheme(settings.theme);
        // a column change alters which extra fields each row carries → reload
        if (patch.columns) await get().loadPublications();
        // editing custom entry types changes the type list/field sets → reload
        if (patch.customTypes) await get().loadEntryTypes();
        // re-fetch the open detail so a changed default citation style etc. shows
        const { selectedItemId } = get();
        if (selectedItemId) await get().selectItem(selectedItemId);
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    toggleColumn: async (key) => {
      const cols = get().settings.columns;
      const next = cols.includes(key) ? cols.filter((c) => c !== key) : [...cols, key];
      await get().saveSettings({ columns: next });
    },

    groupEdit: async (command) => {
      const { documentId } = get();
      if (!documentId) return undefined;
      try {
        const res = await api.groupEdit({ documentId, command });
        set({ dirty: res.dirty });
        if (command.kind === 'delete') set({ selectedGroupId: undefined });
        await get().loadGroups();
        // Selecting the affected group is right for create/rename/edit, but a
        // drag-drop "add to group" (setMembers) must NOT switch the table to the
        // target group — keep whatever view is currently selected.
        if (res.groupId && command.kind !== 'setMembers') set({ selectedGroupId: res.groupId });
        await get().loadPublications();
        return res.groupId;
      } catch (err) {
        set({ error: errorMessage(err) });
        return undefined;
      }
    },

    groupConditions: async (groupId) => {
      const { documentId } = get();
      if (!documentId) return undefined;
      try {
        return await api.groupConditions({ documentId, groupId });
      } catch (err) {
        set({ error: errorMessage(err) });
        return undefined;
      }
    },

    renameAuthor: async (oldName, newName) => {
      const { documentId } = get();
      if (!documentId) return;
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) return;
      try {
        const res = await api.renameAuthor({ documentId, oldName, newName: trimmed });
        if (res.changed > 0) {
          set({ dirty: res.dirty });
          await get().loadGroups();
          await get().loadPublications();
          const sel = get().selectedItemId;
          if (sel) await get().loadDetail(sel);
        }
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    print: async () => {
      const { documentId, selectedIds, rows, groups, selectedGroupId, displayName, settings } = get();
      if (!documentId) return;
      // The multi-selection if any, else every row in the current view (group).
      const itemIds = selectedIds.length > 1 ? selectedIds : rows.map((r) => r.id);
      if (!itemIds.length) return;
      const group = groups.find((g) => g.id === selectedGroupId);
      const docName = (displayName ?? 'Bibliography').replace(/\.bib$/i, '');
      const title = group && group.kind !== 'library' ? `${docName} — ${group.name}` : docName;
      try {
        const res = await api.print({ documentId, itemIds, styleId: settings.defaultCiteStyle, title });
        if (!res.ok && res.error) set({ error: res.error });
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    exportSelection: async () => {
      const { documentId, selectedIds, selectedItemId } = get();
      if (!documentId) return;
      const itemIds = selectedIds.length ? selectedIds : selectedItemId ? [selectedItemId] : [];
      if (!itemIds.length) {
        set({ error: 'Select one or more entries to export.' });
        return;
      }
      try {
        const res = await api.exportSelection({ documentId, itemIds });
        if (!res.ok && res.error) set({ error: res.error });
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    agentSend: async (message) => {
      const { documentId } = get();
      if (!documentId) return { reply: '', toolLog: [], mutated: false, error: 'No document open.' };
      const res = await api.agentRun({ documentId, message });
      if (res.mutated) {
        set({ dirty: true });
        await get().loadGroups();
        await get().loadPublications();
        const sel = get().selectedItemId;
        if (sel) await get().selectItem(sel);
      }
      return res;
    },
  }));
}

export type ViewerStore = ReturnType<typeof createStore>;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Lazily-created singleton store bound to the live `window.bibdesk` bridge.
 * Created on first access so the module is importable in non-DOM test contexts
 * without touching `window`.
 */
let liveStore: ViewerStore | undefined;

export function getStore(): ViewerStore {
  if (!liveStore) {
    const api = (globalThis as { window?: Window }).window?.bibdesk;
    if (!api) {
      throw new Error('window.bibdesk bridge is not available');
    }
    liveStore = createStore(api);
  }
  return liveStore;
}

/** React hook selecting from the live store. */
export function useStore<T>(selector: (state: ViewerState) => T): T {
  return useZustandStore(getStore(), selector);
}
