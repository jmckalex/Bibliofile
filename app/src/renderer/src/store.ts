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
  BibDeskApi,
  EditCommand,
  FindReplaceRequest,
  FindReplaceResult,
  FindDuplicatesResult,
  GroupNode,
  ImportResult,
  ItemDetail,
  MacroDef,
  OnlineResult,
  OpenedDocument,
  PublicationRow,
  Settings,
  SortDirection,
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

export interface SortState {
  readonly key: string;
  readonly direction: SortDirection;
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

  /** Detail pane. */
  selectedItemId?: string;
  detail?: ItemDetail;

  /** Current table sort (default: cite key asc). */
  sort: SortState;

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

  // --- actions ---
  /** Handle a `documentOpened` event: store ids, then load groups + rows. */
  onDocumentOpened: (doc: OpenedDocument) => Promise<void>;
  /** (Re)load the groups sidebar for the active document. */
  loadGroups: () => Promise<void>;
  /** (Re)load publications for the current group + sort (limit -1 = all). */
  loadPublications: () => Promise<void>;
  /** Select a group and reload the filtered publications. */
  selectGroup: (groupId: string) => Promise<void>;
  /** Select a row and load its full detail. */
  selectItem: (itemId: string) => Promise<void>;
  /** Select an entry by cite key (used by notes `[[citeKey]]` cross-references). */
  selectByCiteKey: (citeKey: string) => Promise<void>;
  /** Toggle sort on a column key (asc⇄desc) and reload. */
  setSort: (key: string) => Promise<void>;
  /** Set the live search query; runs a full-text search (falls back to substring). */
  setQuery: (query: string) => Promise<void>;
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
  /** Distinct existing values for a field (editor autocomplete). */
  fieldSuggestions: (field: string) => Promise<readonly string[]>;
  /** Load preferences from main and apply the theme. */
  loadSettings: () => Promise<void>;
  /** Patch preferences, persist via main, and re-apply the theme. */
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  /** Show/hide one table column key (builtin or field name); persists + reloads. */
  toggleColumn: (key: string) => Promise<void>;
}

const DEFAULT_SORT: SortState = { key: 'citeKey', direction: 'asc' };

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
    macros: [],
    dirty: false,
    saving: false,
    loading: false,
    detailLoading: false,

    onDocumentOpened: async (doc) => {
      set({
        documentId: doc.documentId,
        displayName: doc.displayName,
        itemCount: doc.itemCount,
        warnings: doc.warnings.length,
        // reset per-document view state
        selectedGroupId: undefined,
        selectedItemId: undefined,
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

    selectItem: async (itemId) => {
      const { documentId } = get();
      if (!documentId) return;
      set({ selectedItemId: itemId, detailLoading: true });
      try {
        const detail = await api.getItemDetail({ documentId, itemId });
        // ignore stale responses if selection changed mid-flight
        if (get().selectedItemId !== itemId) return;
        set({ detail, detailLoading: false });
      } catch (err) {
        set({ detailLoading: false, error: errorMessage(err) });
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

    setSort: async (key) => {
      const { sort } = get();
      const direction: SortDirection =
        sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc';
      set({ sort: { key, direction } });
      await get().loadPublications();
    },

    setQuery: async (query) => {
      // Show the substring fallback immediately; refine with FTS results when ready.
      set({ query, ftsIds: null });
      const { documentId } = get();
      if (!documentId || !query.trim()) return;
      try {
        const res = await api.ftsSearch({ documentId, query });
        // ignore stale responses if the query changed while awaiting
        if (get().query !== query) return;
        set({ ftsIds: res.available ? [...res.ids] : null });
      } catch {
        set({ ftsIds: null });
      }
    },

    edit: async (command) => {
      const { documentId } = get();
      if (!documentId) return;
      const structural =
        command.kind === 'addEntry' ||
        command.kind === 'duplicateEntry' ||
        command.kind === 'deleteEntry';
      try {
        const res = await api.applyEdit({ documentId, command });
        set({ dirty: res.dirty, error: undefined });
        // structural edits can change category-group ids → re-default to Library
        if (structural) set({ selectedGroupId: undefined });
        await get().loadGroups();
        await get().loadPublications();
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

    saveSettings: async (patch) => {
      try {
        const settings = await api.updateSettings({ patch });
        set({ settings });
        applyTheme(settings.theme);
        // a column change alters which extra fields each row carries → reload
        if (patch.columns) await get().loadPublications();
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
