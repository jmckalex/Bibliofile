/**
 * App shell — three-pane CSS grid (groups | publications | detail) with a
 * header (document name + counts) and a status-bar footer.
 *
 * Lifecycle: main auto-opens a .bib at startup and pushes `documentOpened`. We
 * register onDocumentOpened on mount, hand the doc to the store (which loads
 * groups + publications), and clean up the subscription on unmount.
 */

import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFilePdf } from '@fortawesome/free-solid-svg-icons';
import type { MenuCommand } from '@bibdesk/shared';
import { formatCiteCommand } from '@bibdesk/shared';
import { getStore, useStore, visibleRows } from './store.js';
import { GroupsSidebar } from './GroupsSidebar.js';
import { PublicationsTable } from './PublicationsTable.js';
import { ViewPane } from './ViewPane.js';
import { Welcome } from './Welcome.js';
import { MacroEditor } from './MacroEditor.js';
import { OnlineSearch } from './OnlineSearch.js';
import { Preferences } from './Preferences.js';
import { FindReplace } from './FindReplace.js';
import { FindDuplicates } from './FindDuplicates.js';
import { BrokenLinks } from './BrokenLinks.js';
import { Assistant } from './Assistant.js';
import { BatchBar } from './BatchBar.js';

function ThemeToggle() {
  const theme = useStore((s) => s.settings.theme);
  const save = useStore((s) => s.saveSettings);
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return (
    <button
      type="button"
      className="bd-theme-toggle"
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label="Toggle colour theme"
      onClick={() => void save({ theme: isDark ? 'light' : 'dark' })}
    >
      {isDark ? '☀' : '☾'}
    </button>
  );
}

function SearchBox() {
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const fullText = useStore((s) => s.settings.fullTextSearch);
  const setFullTextSearch = useStore((s) => s.setFullTextSearch);
  const hasDoc = useStore((s) => s.documentId !== undefined);
  if (!hasDoc) return null;
  return (
    <div className="bd-search">
      <button
        type="button"
        className={'bd-search__pdf' + (fullText ? ' bd-search__pdf--on' : '')}
        aria-pressed={fullText}
        aria-label="Search PDF contents (full-text)"
        title={
          fullText
            ? 'Full-text search ON — also matching PDF contents. Click to search fields only.'
            : 'Full-text search OFF — matching fields only. Click to also search PDF contents.'
        }
        onClick={() => void setFullTextSearch(!fullText)}
      >
        <FontAwesomeIcon icon={faFilePdf} />
      </button>
      <input
        className="bd-search__input"
        type="search"
        placeholder={fullText ? 'Search (incl. PDF text)…' : 'Filter publications…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Filter publications"
        spellCheck={false}
      />
    </div>
  );
}

function Header() {
  const displayName = useStore((s) => s.displayName);
  const itemCount = useStore((s) => s.itemCount);
  const warnings = useStore((s) => s.warnings);

  return (
    <header className="bd-header">
      <span className="bd-header__title">{displayName ?? 'BibDesk'}</span>
      {displayName && (
        <span className="bd-header__count">
          {itemCount} {itemCount === 1 ? 'publication' : 'publications'}
        </span>
      )}
      <span className="bd-header__spacer" />
      {warnings > 0 && (
        <span className="bd-header__warn">
          ⚠ {warnings} parse {warnings === 1 ? 'warning' : 'warnings'}
        </span>
      )}
      <SearchBox />
      <ThemeToggle />
    </header>
  );
}

function Footer() {
  const total = useStore((s) => s.total);
  const rows = useStore((s) => s.rows);
  const query = useStore((s) => s.query);
  const ftsIds = useStore((s) => s.ftsIds);
  const selectedGroupId = useStore((s) => s.selectedGroupId);
  const groups = useStore((s) => s.groups);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);

  const groupName = groups.find((g) => g.id === selectedGroupId)?.name;
  const filtered = query.trim() ? visibleRows(rows, query, ftsIds).length : total;
  const countLabel =
    filtered === total
      ? `${total} ${total === 1 ? 'row' : 'rows'}`
      : `${filtered} of ${total} rows`;

  return (
    <footer className="bd-footer">
      <span>
        {groupName ? `${groupName}: ` : ''}
        {countLabel}
      </span>
      {loading && <span>Loading…</span>}
      {error && <span className="bd-footer__error">Error: {error}</span>}
    </footer>
  );
}

function Toolbar({ onOpenMacros, onOpenOnline }: { onOpenMacros: () => void; onOpenOnline: () => void }) {
  const edit = useStore((s) => s.edit);
  const save = useStore((s) => s.save);
  const selectedItemId = useStore((s) => s.selectedItemId);
  const dirty = useStore((s) => s.dirty);
  const saving = useStore((s) => s.saving);
  const defaultType = useStore((s) => s.settings.defaultEntryType);
  const hasDoc = useStore((s) => s.documentId !== undefined);
  if (!hasDoc) return null;
  return (
    <div className="bd-toolbar">
      <button type="button" className="bd-btn" onClick={() => void edit({ kind: 'addEntry', entryType: defaultType })}>
        ＋ New
      </button>
      <button
        type="button"
        className="bd-btn"
        disabled={!selectedItemId}
        onClick={() => selectedItemId && void edit({ kind: 'duplicateEntry', itemId: selectedItemId })}
      >
        ⧉ Duplicate
      </button>
      <button
        type="button"
        className="bd-btn"
        disabled={!selectedItemId}
        onClick={() => selectedItemId && void edit({ kind: 'deleteEntry', itemId: selectedItemId })}
      >
        🗑 Delete
      </button>
      <span className="bd-toolbar__spacer" />
      <button type="button" className="bd-btn" onClick={onOpenOnline}>
        🌐 Online…
      </button>
      <button type="button" className="bd-btn" onClick={onOpenMacros}>
        @string…
      </button>
      <button
        type="button"
        className="bd-btn bd-btn--primary"
        disabled={!dirty || saving}
        onClick={() => void save()}
      >
        {saving ? 'Saving…' : dirty ? 'Save •' : 'Saved'}
      </button>
    </div>
  );
}

/** Strip HTML to plain text for clipboard (citation copy). */
function htmlToText(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent ?? '').replace(/\s+\n/g, '\n').trim();
}

/** The cite key of the current selection, from loaded detail or the row list. */
function selectedCiteKey(): string | undefined {
  const s = getStore().getState();
  if (s.detail?.id === s.selectedItemId) return s.detail?.citeKey;
  return s.rows.find((r) => r.id === s.selectedItemId)?.citeKey;
}

/** Modal openers passed from the App component. */
interface ModalSetters {
  setMacrosOpen: (v: boolean) => void;
  setOnlineOpen: (v: boolean) => void;
  setPrefsOpen: (v: boolean) => void;
  setFindReplaceOpen: (v: boolean) => void;
  setDuplicatesOpen: (v: boolean) => void;
  setBrokenLinksOpen: (v: boolean) => void;
  setAssistantOpen: (v: boolean) => void;
}

/**
 * Dispatch a native-menu command onto store actions / UI state. Reads the latest
 * store snapshot via {@link useStore.getState} so it never closes over stale
 * selection. Selection-scoped commands no-op gracefully when nothing is selected.
 */
async function dispatchMenuCommand(command: MenuCommand, modals: ModalSetters): Promise<void> {
  const store = getStore().getState();
  const { documentId, selectedItemId } = store;

  switch (command) {
    case 'newPublication':
      await store.edit({ kind: 'addEntry', entryType: store.settings.defaultEntryType });
      return;
    case 'pastePublication': {
      const text = await navigator.clipboard.readText().catch(() => '');
      if (text.trim()) await store.pasteEntries(text);
      return;
    }
    case 'importFile':
      await store.importFromDialog();
      return;
    case 'editEntry':
      if (selectedItemId) store.openEditor(selectedItemId);
      return;
    case 'duplicate':
      if (selectedItemId) await store.edit({ kind: 'duplicateEntry', itemId: selectedItemId });
      return;
    case 'delete':
      if (selectedItemId) await store.edit({ kind: 'deleteEntry', itemId: selectedItemId });
      return;
    case 'generateCiteKey':
      if (selectedItemId) await store.edit({ kind: 'generateCiteKey', itemId: selectedItemId });
      return;
    case 'addAttachment':
      if (selectedItemId) await store.addAttachment(selectedItemId);
      return;
    case 'autoFile':
      if (selectedItemId) await store.autoFile(selectedItemId);
      return;
    case 'online':
      modals.setOnlineOpen(true);
      return;
    case 'editMacros':
      modals.setMacrosOpen(true);
      return;
    case 'save':
      await store.save();
      return;
    case 'print':
      await store.print();
      return;
    case 'exportSelected':
      await store.exportSelection();
      return;
    case 'find': {
      const input = document.querySelector<HTMLInputElement>('.bd-search__input');
      input?.focus();
      input?.select();
      return;
    }
    case 'findReplace':
      modals.setFindReplaceOpen(true);
      return;
    case 'findDuplicates':
      modals.setDuplicatesOpen(true);
      return;
    case 'findBrokenLinks':
      modals.setBrokenLinksOpen(true);
      return;
    case 'assistant':
      modals.setAssistantOpen(true);
      return;
    case 'toggleTheme': {
      const isDark =
        store.settings.theme === 'dark' ||
        (store.settings.theme === 'system' &&
          window.matchMedia?.('(prefers-color-scheme: dark)').matches);
      await store.saveSettings({ theme: isDark ? 'light' : 'dark' });
      return;
    }
    case 'copyCiteKey': {
      const key = selectedCiteKey();
      if (key) await navigator.clipboard.writeText(key);
      return;
    }
    case 'copyCite': {
      const key = selectedCiteKey();
      if (key) await navigator.clipboard.writeText(formatCiteCommand(store.settings.citeCommandTemplate, [key]));
      return;
    }
    case 'copyBibtex': {
      if (!documentId || !selectedItemId || !window.bibdesk) return;
      const res = await window.bibdesk.exportText({
        documentId,
        format: 'bibtex',
        itemIds: [selectedItemId],
      });
      if (res.text) await navigator.clipboard.writeText(res.text);
      return;
    }
    case 'copyCitation': {
      if (!documentId || !selectedItemId || !window.bibdesk) return;
      const res = await window.bibdesk.formatCitation({
        documentId,
        itemId: selectedItemId,
        styleId: store.settings.defaultCiteStyle,
      });
      if (res.html) await navigator.clipboard.writeText(htmlToText(res.html));
      return;
    }
    case 'copyRtf': {
      if (!documentId || !selectedItemId || !window.bibdesk) return;
      await window.bibdesk.copyRtf({
        documentId,
        itemId: selectedItemId,
        styleId: store.settings.defaultCiteStyle,
      });
      return;
    }
  }
}

const BIBTEX_RE = /@\w+\s*\{/;

export function App() {
  const onDocumentOpened = useStore((s) => s.onDocumentOpened);
  const loadSettings = useStore((s) => s.loadSettings);
  const hasDoc = useStore((s) => s.documentId !== undefined);
  const [macrosOpen, setMacrosOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [brokenLinksOpen, setBrokenLinksOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Autosave: a short debounce after the document becomes dirty (opt-in).
  const dirty = useStore((s) => s.dirty);
  const autosave = useStore((s) => s.settings.autosave);
  const saving = useStore((s) => s.saving);
  const save = useStore((s) => s.save);
  useEffect(() => {
    if (!dirty || !autosave || saving) return;
    const t = setTimeout(() => void save(), 1500);
    return () => clearTimeout(t);
  }, [dirty, autosave, saving, save]);

  // Paste BibTeX into the library (e.g. from Google Scholar). Editable fields
  // keep their normal paste; a bare paste of `@type{…}` text imports entries.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const text = e.clipboardData?.getData('text') ?? '';
      if (BIBTEX_RE.test(text)) {
        e.preventDefault();
        void getStore().getState().pasteEntries(text);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // Drag-and-drop import: drop `.bib` files (merge) or PDFs/others (entry+attach)
  // onto the window; a dragged BibTeX text snippet imports too.
  useEffect(() => {
    let depth = 0;
    const onDragEnter = (e: DragEvent): void => {
      e.preventDefault();
      depth++;
      // Only show the import overlay for external file drags — not for an
      // in-app row drag-out (which carries text/plain cite commands).
      if (e.dataTransfer?.types.includes('Files')) setDragging(true);
    };
    const onDragOver = (e: DragEvent): void => e.preventDefault();
    const onDragLeave = (e: DragEvent): void => {
      e.preventDefault();
      if (--depth <= 0) setDragging(false);
    };
    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const dt = e.dataTransfer;
      const api = window.bibdesk;
      if (!dt || !api) return;
      const paths = Array.from(dt.files)
        .map((f) => api.pathForFile(f))
        .filter(Boolean);
      if (paths.length) {
        const st = getStore().getState();
        if (st.documentId) {
          void st.importFiles(paths);
        } else {
          // No library open yet → a dropped .bib opens it (welcome screen).
          const bib = paths.find((p) => /\.bib$/i.test(p));
          if (bib) void api.openDocument(bib);
        }
        return;
      }
      const text = dt.getData('text');
      if (BIBTEX_RE.test(text)) void getStore().getState().pasteEntries(text);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  useEffect(() => {
    const api = window.bibdesk;
    if (!api) return;
    const unsubOpen = api.onDocumentOpened((doc) => {
      void onDocumentOpened(doc);
    });
    const unsubPrefs = api.onShowPreferences(() => setPrefsOpen(true));
    const unsubMenu = api.onMenuCommand((command) => {
      void dispatchMenuCommand(command, {
        setMacrosOpen,
        setOnlineOpen,
        setPrefsOpen,
        setFindReplaceOpen,
        setDuplicatesOpen,
        setBrokenLinksOpen,
        setAssistantOpen,
      });
    });
    const unsubCols = api.onMenuToggleColumn((key) => void getStore().getState().toggleColumn(key));
    // An editor window (or another window) mutated the document → refresh.
    const unsubChanged = api.onDocumentChanged(() => void getStore().getState().reloadAfterExternalChange());
    return () => {
      unsubOpen();
      unsubPrefs();
      unsubMenu();
      unsubCols();
      unsubChanged();
    };
  }, [onDocumentOpened]);

  if (!hasDoc) {
    return (
      <div className="bd-app">
        <Welcome />
        {dragging && (
          <div className="bd-drop-overlay" aria-hidden="true">
            <div className="bd-drop-overlay__msg">Drop a .bib file to open</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bd-app">
      <Header />
      <Toolbar onOpenMacros={() => setMacrosOpen(true)} onOpenOnline={() => setOnlineOpen(true)} />
      <div className="bd-panes">
        <aside className="bd-pane">
          <GroupsSidebar />
        </aside>
        <section className="bd-pane">
          <PublicationsTable />
        </section>
        <section className="bd-pane bd-pane--detail">
          <ViewPane />
        </section>
      </div>
      <Footer />
      <BatchBar />
      {macrosOpen && <MacroEditor onClose={() => setMacrosOpen(false)} />}
      {onlineOpen && <OnlineSearch onClose={() => setOnlineOpen(false)} />}
      {prefsOpen && <Preferences onClose={() => setPrefsOpen(false)} />}
      {findReplaceOpen && <FindReplace onClose={() => setFindReplaceOpen(false)} />}
      {duplicatesOpen && <FindDuplicates onClose={() => setDuplicatesOpen(false)} />}
      {brokenLinksOpen && <BrokenLinks onClose={() => setBrokenLinksOpen(false)} />}
      {assistantOpen && <Assistant onClose={() => setAssistantOpen(false)} />}
      {dragging && hasDoc && (
        <div className="bd-drop-overlay" aria-hidden="true">
          <div className="bd-drop-overlay__msg">Drop .bib or files to import</div>
        </div>
      )}
    </div>
  );
}
