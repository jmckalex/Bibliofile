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
  LayoutSettings,
  SortSpec,
  EntryTypeInfo,
  TemplateExportScope,
  CitationStyle,
} from '@bibdesk/shared';
import { DEFAULT_SETTINGS, BUILTIN_COLUMNS, CITATION_STYLES } from '@bibdesk/shared';

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

/** The LaTeX-preview artifact + status shown in the bottom panel's preview pane. */
export interface TexPreviewState {
  /** True while the TeX toolchain is running. */
  readonly loading: boolean;
  /** Which artifact came back (undefined before the first render). */
  readonly kind?: 'svg' | 'pdf';
  /** Inline SVG strings (one per page) when `kind === 'svg'`. */
  readonly svgs?: readonly string[];
  /** Raw PDF bytes when `kind === 'pdf'` (rendered with PDF.js in the pane). */
  readonly pdfBytes?: Uint8Array;
  /** A readable failure message (no TeX, or a compile error). */
  readonly error?: string;
}

/** The rendered multi-select panels (2+ rows selected), built in main on demand. */
export interface MultiPanelView {
  /** Total number of selected items (the list itself may be capped). */
  readonly count: number;
  /** Multi-select details-pane HTML. */
  readonly detailsHtml?: string;
  /** Multi-select bottom-pane HTML. */
  readonly bottomHtml?: string;
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
  /**
   * Selected folder, if any. Mutually exclusive with `selectedGroupId`: a folder
   * is a container (it filters nothing), but selecting one makes it the target
   * that new groups/folders are created inside.
   */
  selectedFolderId?: string;

  /** Detail pane: the primary (last-clicked) item. */
  selectedItemId?: string;
  detail?: ItemDetail;
  /** Multi-selection (always includes selectedItemId); drives batch operations. */
  selectedIds: string[];
  /** Fixed anchor a shift-extension (keyboard or click) grows from; set on plain select. */
  selectionAnchor?: string;

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
  /** Latest LaTeX-preview artifact + status for the bottom panel's preview pane. */
  texPreviewState: TexPreviewState;
  /** Rendered multi-select panels, present while 2+ rows are selected. */
  multiPanel?: MultiPanelView;

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
  /** Select a folder (a container): highlight it and make it the create target. */
  selectFolder: (folderId: string) => Promise<void>;
  /** Select a row and load its full detail (replaces any multi-selection). */
  selectItem: (itemId: string) => Promise<void>;
  /** Load one item's detail into the pane WITHOUT touching the multi-selection. */
  loadDetail: (itemId: string) => Promise<void>;
  /** Cmd/Ctrl-click: toggle one row in/out of the multi-selection. */
  toggleSelect: (itemId: string) => void;
  /** Shift-click: extend the selection from the primary to this row (visible order). */
  rangeSelectTo: (itemId: string, orderedIds: readonly string[]) => void;
  /** Shift+Arrow/Home/End/Page: extend from the fixed anchor to this row (keyboard). */
  extendSelectionTo: (itemId: string, orderedIds: readonly string[]) => void;
  /** Cmd/Ctrl+A: select every row in the given visible order. */
  selectAll: (orderedIds: readonly string[]) => void;
  /** Apply a batch operation to the current multi-selection; reload. */
  batchEdit: (op: BatchOp) => Promise<void>;
  /**
   * Delete the current selection (Delete key / context menu): a single
   * undo-grouped batch delete for 2+ rows, or a plain delete for one.
   */
  deleteSelection: () => Promise<void>;
  /** Select an entry by cite key (used by notes `[[citeKey]]` cross-references). */
  selectByCiteKey: (citeKey: string) => Promise<void>;
  /** Pick a `.aux` file (main opens the dialog) and select the publications it cites. */
  selectFromAux: () => Promise<void>;
  /** Export a folder's group→PDF directory tree (main picks the destination). */
  exportFolderTree: (folderId: string) => Promise<void>;
  /** Select every publication missing a required field for its type. */
  selectIncomplete: () => Promise<void>;
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
  /** Set/clear the color label on the current selection (null/0 clears). */
  setColor: (colorIndex: number | null) => Promise<void>;
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
  /** Bundled + user-installed CSL styles (for the Preferences picker). */
  citationStyles: readonly CitationStyle[];
  /** Load preferences from main and apply the theme. */
  loadSettings: () => Promise<void>;
  /** Load the known entry types (standard + custom) from main. */
  loadEntryTypes: () => Promise<void>;
  /** Load the available CSL styles (bundled + installed) from main. */
  loadCitationStyles: () => Promise<void>;
  /** Pick + install a `.csl` file, then select it as the default style. */
  installCitationStyle: () => Promise<void>;
  /** Remove a user-installed CSL style by id. */
  removeCitationStyle: (id: string) => Promise<void>;
  /**
   * Render a LaTeX/BibTeX preview of the current selection (SVG) or the whole
   * library (PDF) into `texPreviewState`. Driven by the preview pane, which calls
   * this on open and (debounced) whenever the selection changes.
   */
  texPreview: () => Promise<void>;
  /**
   * (Re)build the multi-select panels for the current 2+ row selection into
   * `multiPanel`. Triggered (debounced) on selection change and after a batch edit.
   */
  loadMultiPanel: () => Promise<void>;
  /** Patch preferences, persist via main, and re-apply the theme. */
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  /**
   * Update the panel layout. Applies locally immediately (for live splitter
   * dragging) and, when `persist` (default true), writes it to settings — without
   * the heavy reloads `saveSettings` does. Pass `persist: false` per drag move and
   * `true` once on release.
   */
  setLayout: (patch: Partial<LayoutSettings>, persist?: boolean) => void;
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
  /** Export a named template at a scope (whole library, the shown rows, or the selection). */
  exportTemplate: (templateName: string, scope: TemplateExportScope) => Promise<void>;
  /** Send one message to the Claude assistant; reloads the table if it mutated. */
  agentSend: (message: string) => Promise<AgentRunResponse>;
}

const DEFAULT_SORT: readonly SortSpec[] = [{ key: 'citeKey', direction: 'asc' }];

/**
 * Build a Zustand vanilla store wired to the given api. Exported (rather than a
 * module-level singleton) so tests can inject a fake api.
 */
export function createStore(api: BibDeskApi) {
  // Monotonic token so an in-flight LaTeX render that's been superseded by a
  // newer one (selection changed mid-render) discards its now-stale result.
  let texSeq = 0;
  // Same guard for the multi-select panel build (selection can change mid-flight).
  let multiSeq = 0;
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
    citationStyles: [...CITATION_STYLES],
    macros: [],
    selectedIds: [],
    dirty: false,
    saving: false,
    loading: false,
    detailLoading: false,
    editorMode: false,
    texPreviewState: { loading: false },

    onDocumentOpened: async (doc) => {
      set({
        documentId: doc.documentId,
        displayName: doc.displayName,
        itemCount: doc.itemCount,
        warnings: doc.warnings.length,
        // reset per-document view state
        selectedGroupId: undefined,
        selectedFolderId: undefined,
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
      set({ selectedGroupId: groupId, selectedFolderId: undefined });
      await get().loadPublications();
    },

    selectFolder: async (folderId) => {
      // A folder filters no publications; selecting one clears the group filter
      // (showing the full library) and marks the folder as the create target.
      set({ selectedFolderId: folderId, selectedGroupId: undefined });
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
      set({ selectedIds: [itemId], selectionAnchor: itemId });
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

    extendSelectionTo: (itemId, orderedIds) => {
      // Like rangeSelectTo but anchored on the FIXED selectionAnchor (not the
      // moving primary), so repeated Shift+Arrow grows the range from one end.
      const anchor = get().selectionAnchor ?? get().selectedItemId;
      const a = anchor ? orderedIds.indexOf(anchor) : -1;
      const b = orderedIds.indexOf(itemId);
      if (a === -1 || b === -1) {
        void get().selectItem(itemId);
        return;
      }
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      set({ selectedIds: orderedIds.slice(lo, hi + 1) }); // anchor stays put
      void get().loadDetail(itemId); // active end follows the caret
    },

    selectAll: (orderedIds) => {
      if (orderedIds.length === 0) return;
      const cur = get().selectedItemId;
      const primary = cur && orderedIds.includes(cur) ? cur : orderedIds[0]!;
      set({ selectedIds: [...orderedIds], selectionAnchor: primary });
      if (get().selectedItemId !== primary) void get().loadDetail(primary);
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
          // The batch changed fields/keywords, so the multi-select list is stale
          // (selection is unchanged, so nothing else triggers a rebuild).
          if (get().selectedIds.length >= 2) void get().loadMultiPanel();
        }
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    deleteSelection: async () => {
      const { selectedIds, selectedItemId } = get();
      // 2+ rows → one undo-grouped batch delete; one row → the plain delete path.
      if (selectedIds.length >= 2) {
        await get().batchEdit({ kind: 'delete' });
        return;
      }
      const id = selectedItemId ?? selectedIds[0];
      if (id) await get().edit({ kind: 'deleteEntry', itemId: id });
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

    selectFromAux: async () => {
      const { documentId } = get();
      if (!documentId) return;
      try {
        const res = await api.selectFromAux({ documentId });
        if (res.canceled || res.matchedIds.length === 0) return; // main shows the summary
        // Show the whole library so every cited entry is visible and selected.
        const lib = get().groups.find((g) => g.kind === 'library');
        if (lib && get().selectedGroupId !== lib.id) {
          set({ selectedGroupId: lib.id });
          await get().loadPublications();
        }
        set({ selectedIds: [...res.matchedIds], selectedItemId: res.matchedIds[0] });
        await get().loadDetail(res.matchedIds[0]!);
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    exportFolderTree: async (folderId) => {
      const { documentId } = get();
      if (!documentId) return;
      try {
        await api.exportFolderTree({ documentId, folderId }); // main shows the dest picker + summary
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    selectIncomplete: async () => {
      const { documentId } = get();
      if (!documentId) return;
      try {
        const { itemIds } = await api.selectIncomplete({ documentId });
        if (itemIds.length === 0) return; // main shows the "none" dialog
        const lib = get().groups.find((g) => g.kind === 'library');
        if (lib && get().selectedGroupId !== lib.id) {
          set({ selectedGroupId: lib.id });
          await get().loadPublications();
        }
        set({ selectedIds: [...itemIds], selectedItemId: itemIds[0] });
        await get().loadDetail(itemIds[0]!);
      } catch (err) {
        set({ error: errorMessage(err) });
      }
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
          // A new publication sorts in wherever its cite key falls, so it can be
          // buried out of view. Make it the sole selection (clearing the prior
          // multi-selection) and open its editor so the user lands right on it.
          if (command.kind === 'addEntry' && !editorMode) {
            set({ selectedIds: [res.affectedItemId] });
            get().openEditor(res.affectedItemId);
          }
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

    setColor: async (colorIndex) => {
      const { documentId, selectedIds } = get();
      if (!documentId || selectedIds.length === 0) return;
      try {
        const res = await api.setColor({ documentId, itemIds: selectedIds, colorIndex });
        if (res.count > 0) set({ dirty: true, error: undefined });
        await get().loadPublications();
        const sel = get().selectedItemId;
        if (sel) await get().loadDetail(sel);
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    save: async () => {
      const { documentId, dirty } = get();
      if (!documentId || !dirty) return;
      set({ saving: true, error: undefined });
      try {
        const res = await api.saveDocument({ documentId });
        // Cancelled at the lossy-encoding prompt → nothing written, stay dirty.
        set({ saving: false, dirty: res.cancelled ? get().dirty : false });
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

    loadCitationStyles: async () => {
      try {
        const { styles } = await api.listCitationStyles({});
        set({ citationStyles: styles });
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    installCitationStyle: async () => {
      try {
        const res = await api.installCitationStyle({});
        if (res.error) {
          set({ error: res.error });
          return;
        }
        if (res.style) {
          await get().loadCitationStyles();
          await get().saveSettings({ defaultCiteStyle: res.style.id }); // select the new style
        }
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    removeCitationStyle: async (id) => {
      try {
        await api.removeCitationStyle({ id });
        if (get().settings.defaultCiteStyle === id) await get().saveSettings({ defaultCiteStyle: 'apa' });
        await get().loadCitationStyles();
      } catch (err) {
        set({ error: errorMessage(err) });
      }
    },

    texPreview: async () => {
      const { documentId, selectedIds, rows } = get();
      if (!documentId) return;
      const seq = ++texSeq;

      // Selection scope when rows are selected (typeset just those keys), else the
      // whole library. `\nocite{*}` only works for the library; selection passes keys.
      const keyById = new Map(rows.map((r) => [r.id, r.citeKey]));
      const citeKeys = selectedIds.map((id) => keyById.get(id)).filter((k): k is string => !!k);
      const scope = citeKeys.length > 0 ? 'selection' : 'library';

      set({ texPreviewState: { loading: true } });
      try {
        const res = await api.texPreview({
          documentId,
          scope,
          ...(scope === 'selection' ? { citeKeys } : {}),
        });
        if (seq !== texSeq) return; // a newer render started; drop this stale result
        set({
          texPreviewState: res.ok
            ? { loading: false, kind: res.kind, svgs: res.svgs, pdfBytes: res.pdfBytes }
            : { loading: false, error: res.error ?? 'LaTeX preview failed.' },
        });
      } catch (err) {
        if (seq !== texSeq) return;
        set({ texPreviewState: { loading: false, error: errorMessage(err) } });
      }
    },

    loadMultiPanel: async () => {
      const { documentId, selectedIds } = get();
      if (!documentId || selectedIds.length < 2) return;
      const seq = ++multiSeq;
      try {
        const res = await api.renderMultiPanel({ documentId, itemIds: selectedIds });
        // Drop if superseded, or if the selection dropped back below 2 meanwhile.
        if (seq !== multiSeq || get().selectedIds.length < 2) return;
        set({ multiPanel: { count: res.count, detailsHtml: res.detailsHtml, bottomHtml: res.bottomHtml } });
      } catch (err) {
        if (seq !== multiSeq) return;
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

    setLayout: (patch, persist = true) => {
      const layout = { ...get().settings.layout, ...patch };
      set({ settings: { ...get().settings, layout } }); // live (re-renders the panels)
      // Persist directly (not via saveSettings, whose reloads/re-select are
      // pointless for a layout change). Fire-and-forget; local state is authoritative.
      if (persist) void api.updateSettings({ patch: { layout } });
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
        if (command.kind === 'deleteFolder') set({ selectedFolderId: undefined });
        await get().loadGroups();
        // A create selects the new node (group or folder); selection is mutually
        // exclusive, so each branch clears the other. setMembers (drag-drop add)
        // and re-parenting ops never grab selection.
        if (res.groupId && (command.kind === 'createStatic' || command.kind === 'createSmart')) {
          set({ selectedGroupId: res.groupId, selectedFolderId: undefined });
        }
        if (res.groupId && command.kind === 'createFolder') {
          set({ selectedFolderId: res.groupId, selectedGroupId: undefined });
        }
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

    exportTemplate: async (templateName, scope) => {
      const { documentId, rows, query, ftsIds, selectedIds } = get();
      if (!documentId) return;
      // Resolve the scope to ordered itemIds. 'library' passes none (main renders
      // the whole library). 'shown'/'selected' are taken in the table's display
      // order so the output order is predictable.
      let itemIds: string[] | undefined;
      if (scope !== 'library') {
        const shown = visibleRows(rows, query, ftsIds);
        if (scope === 'selected') {
          const sel = new Set(selectedIds);
          itemIds = shown.filter((r) => sel.has(r.id)).map((r) => r.id);
        } else {
          itemIds = shown.map((r) => r.id);
        }
        if (itemIds.length === 0) {
          set({ error: scope === 'selected' ? 'Select one or more entries to export.' : 'No entries to export.' });
          return;
        }
      }
      try {
        const res = await api.exportTemplate({ documentId, templateName, ...(itemIds ? { itemIds } : {}) });
        if (res.error) set({ error: res.error });
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
