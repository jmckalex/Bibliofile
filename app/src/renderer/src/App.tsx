/**
 * App shell — three-pane CSS grid (groups | publications | detail) with a
 * header (document name + counts) and a status-bar footer.
 *
 * Lifecycle: main auto-opens a .bib at startup and pushes `documentOpened`. We
 * register onDocumentOpened on mount, hand the doc to the store (which loads
 * groups + publications), and clean up the subscription on unmount.
 */

import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import type { MenuCommand } from '@bibdesk/shared';
import { formatCiteCommand } from '@bibdesk/shared';
import { getStore, useStore, visibleRows } from './store.js';
import { useT } from './i18n.js';
import { Icon } from './icons.js';
import { GroupsSidebar } from './GroupsSidebar.js';
import { PublicationsTable } from './PublicationsTable.js';
import { Splitter, RightPane, BottomPanel } from './Panels.js';
import { Welcome } from './Welcome.js';
import { MacroEditor } from './MacroEditor.js';
import { OnlineSearch } from './OnlineSearch.js';
import { Preferences } from './Preferences.js';
import { FindReplace } from './FindReplace.js';
import { FindDuplicates } from './FindDuplicates.js';
import { BrokenLinks } from './BrokenLinks.js';
import { JournalCoverScan } from './JournalCoverScan.js';
import { BatchBar } from './BatchBar.js';

function ThemeToggle() {
  const t = useT();
  const theme = useStore((s) => s.settings.theme);
  const save = useStore((s) => s.saveSettings);
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return (
    <button
      type="button"
      className="bd-theme-toggle"
      title={isDark ? t('theme.switchLight') : t('theme.switchDark')}
      aria-label={t('theme.toggle')}
      onClick={() => void save({ theme: isDark ? 'light' : 'dark' })}
    >
      <Icon name={isDark ? 'themeLight' : 'themeDark'} />
    </button>
  );
}

function SearchBox() {
  const t = useT();
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
        aria-label={t('search.pdfToggle')}
        title={fullText ? t('search.pdfOn') : t('search.pdfOff')}
        onClick={() => void setFullTextSearch(!fullText)}
      >
        <Icon name="pdf" />
      </button>
      <input
        className="bd-search__input"
        type="search"
        placeholder={fullText ? t('search.placeholderFull') : t('search.placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={t('search.filter')}
        spellCheck={false}
      />
    </div>
  );
}

function Header() {
  const t = useT();
  const displayName = useStore((s) => s.displayName);
  const itemCount = useStore((s) => s.itemCount);
  const warnings = useStore((s) => s.warnings);
  const dirty = useStore((s) => s.dirty);
  const saving = useStore((s) => s.saving);

  return (
    <header className="bd-header">
      <span className="bd-header__title">
        {displayName ?? 'Bibliofile'}
        {displayName && (saving || dirty) && (
          <span className="bd-header__dirty" title={saving ? t('header.saving') : t('header.unsaved')}>
            {saving ? t('header.savingInline') : ' •'}
          </span>
        )}
      </span>
      {displayName && (
        <span className="bd-header__count">
          {t(itemCount === 1 ? 'header.publication' : 'header.publications', { count: itemCount })}
        </span>
      )}
      <span className="bd-header__spacer" />
      {warnings > 0 && (
        <span className="bd-header__warn">
          <Icon name="warning" /> {t(warnings === 1 ? 'header.parseWarning' : 'header.parseWarnings', { count: warnings })}
        </span>
      )}
      <SearchBox />
      <ThemeToggle />
    </header>
  );
}

function Footer() {
  const t = useT();
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
      ? t(total === 1 ? 'footer.row' : 'footer.rows', { count: total })
      : t('footer.rowsOf', { filtered, total });

  return (
    <footer className="bd-footer">
      <span>
        {groupName ? `${groupName}: ` : ''}
        {countLabel}
      </span>
      {loading && <span>{t('common.loading')}</span>}
      {error && <span className="bd-footer__error">{t('footer.error', { error })}</span>}
    </footer>
  );
}

function Toolbar({ onOpenMacros, onOpenOnline }: { onOpenMacros: () => void; onOpenOnline: () => void }) {
  const t = useT();
  const edit = useStore((s) => s.edit);
  const selectedItemId = useStore((s) => s.selectedItemId);
  const defaultType = useStore((s) => s.settings.defaultEntryType);
  const hasDoc = useStore((s) => s.documentId !== undefined);
  if (!hasDoc) return null;
  return (
    <div className="bd-toolbar">
      <button type="button" className="bd-btn" onClick={() => void edit({ kind: 'addEntry', entryType: defaultType })}>
        <Icon name="plus" /> {t('toolbar.new')}
      </button>
      <button
        type="button"
        className="bd-btn"
        disabled={!selectedItemId}
        onClick={() => selectedItemId && void edit({ kind: 'duplicateEntry', itemId: selectedItemId })}
      >
        <Icon name="duplicate" /> {t('toolbar.duplicate')}
      </button>
      <button
        type="button"
        className="bd-btn"
        disabled={!selectedItemId}
        onClick={() => selectedItemId && void edit({ kind: 'deleteEntry', itemId: selectedItemId })}
      >
        <Icon name="trash" /> {t('toolbar.delete')}
      </button>
      <span className="bd-toolbar__spacer" />
      <button type="button" className="bd-btn" onClick={onOpenOnline}>
        <Icon name="online" /> {t('toolbar.online')}
      </button>
      <button type="button" className="bd-btn" onClick={onOpenMacros}>
        {t('toolbar.macros')}
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
  setCoverScanOpen: (v: boolean) => void;
}

/**
 * Dispatch a native-menu command onto store actions / UI state. Reads the latest
 * store snapshot via {@link useStore.getState} so it never closes over stale
 * selection. Selection-scoped commands no-op gracefully when nothing is selected.
 */
async function dispatchMenuCommand(command: MenuCommand, modals: ModalSetters): Promise<void> {
  const store = getStore().getState();
  const { documentId, selectedItemId, selectedIds } = store;

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
      await store.deleteSelection();
      return;
    case 'generateCiteKey':
      if (selectedItemId) await store.edit({ kind: 'generateCiteKey', itemId: selectedItemId });
      return;
    case 'addAttachment':
      if (selectedItemId) await store.addAttachment(selectedItemId);
      return;
    case 'autoFile': {
      // File the whole selection (not just the focused row); confirm if 2+.
      const ids = selectedIds.length ? selectedIds : selectedItemId ? [selectedItemId] : [];
      if (ids.length) await store.autoFile(ids);
      return;
    }
    case 'consolidate':
      await store.consolidateLinkedFiles();
      return;
    case 'selectFromAux':
      await store.selectFromAux();
      return;
    case 'selectIncomplete':
      await store.selectIncomplete();
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
    case 'scanJournalCovers':
      modals.setCoverScanOpen(true);
      return;
    case 'texPreview':
      // Reveal the preview pane; it renders the current selection on open and
      // auto-refreshes as the selection changes.
      store.setLayout({ bottomPanelVisible: true, bottomPaneContent: 'texPreview' });
      return;
    case 'assistant':
      // Show the assistant in the (now swappable) right pane.
      getStore().getState().setLayout({ rightPaneVisible: true, rightPaneContent: 'assistant' });
      return;
    case 'toggleSidePanel':
      store.setLayout({ rightPaneVisible: !store.settings.layout.rightPaneVisible });
      return;
    case 'toggleBottomPanel':
      store.setLayout({ bottomPanelVisible: !store.settings.layout.bottomPanelVisible });
      return;
    case 'sidePaneDetails':
      store.setLayout({ rightPaneVisible: true, rightPaneContent: 'details' });
      return;
    case 'sidePaneAssistant':
      store.setLayout({ rightPaneVisible: true, rightPaneContent: 'assistant' });
      return;
    case 'bottomPaneAnnotation':
      store.setLayout({ bottomPanelVisible: true, bottomPaneContent: 'annotation' });
      return;
    case 'bottomPaneTexPreview':
      store.setLayout({ bottomPanelVisible: true, bottomPaneContent: 'texPreview' });
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
    case 'copyRis': {
      const ids = store.selectedIds;
      if (!documentId || !ids.length || !window.bibdesk) return;
      const res = await window.bibdesk.exportText({ documentId, format: 'ris', itemIds: ids });
      if (res.text) await navigator.clipboard.writeText(res.text);
      return;
    }
    case 'copyMinimalBibtex': {
      const ids = store.selectedIds;
      if (!documentId || !ids.length || !window.bibdesk) return;
      const res = await window.bibdesk.exportText({ documentId, format: 'bibtex-minimal', itemIds: ids });
      if (res.text) await navigator.clipboard.writeText(res.text);
      return;
    }
    case 'copyBibitem': {
      const ids = store.selectedIds;
      if (!documentId || !ids.length || !window.bibdesk) return;
      const keyById = new Map(store.rows.map((r) => [r.id, r.citeKey]));
      const lines: string[] = [];
      for (const id of ids) {
        const res = await window.bibdesk.formatCitation({
          documentId,
          itemId: id,
          styleId: store.settings.defaultCiteStyle,
        });
        const text = res.html ? htmlToText(res.html) : '';
        lines.push(`\\bibitem{${keyById.get(id) ?? id}} ${text}`.trim());
      }
      await navigator.clipboard.writeText(lines.join('\n'));
      return;
    }
    case 'newWithCrossref': {
      const key = selectedCiteKey();
      if (key) await store.edit({ kind: 'addEntry', entryType: store.settings.defaultEntryType, crossref: key });
      return;
    }
    case 'selectParent': {
      if (!selectedItemId || store.detail?.id !== selectedItemId) return;
      const parentKey = store.detail.fields
        .find((f) => f.name.toLowerCase() === 'crossref')
        ?.rawValue.trim();
      if (parentKey) await store.selectByCiteKey(parentKey);
      return;
    }
  }
}

const BIBTEX_RE = /@\w+\s*\{/;

export function App() {
  const t = useT();
  const onDocumentOpened = useStore((s) => s.onDocumentOpened);
  const loadSettings = useStore((s) => s.loadSettings);
  const loadEntryTypes = useStore((s) => s.loadEntryTypes);
  const loadCitationStyles = useStore((s) => s.loadCitationStyles);
  const hasDoc = useStore((s) => s.documentId !== undefined);
  const [macrosOpen, setMacrosOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [brokenLinksOpen, setBrokenLinksOpen] = useState(false);
  const [coverScanOpen, setCoverScanOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const layout = useStore((s) => s.settings.layout);
  const setLayout = useStore((s) => s.setLayout);

  useEffect(() => {
    void loadSettings();
    void loadEntryTypes();
    void loadCitationStyles();
  }, [loadSettings, loadEntryTypes, loadCitationStyles]);

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

  // Build the multi-select panels (debounced) whenever 2+ rows are selected, so
  // keyboard range-selection doesn't rebuild per step. One place handles it for
  // both panes (the right detail pane and the bottom annotation pane).
  const selectedIds = useStore((s) => s.selectedIds);
  const loadMultiPanel = useStore((s) => s.loadMultiPanel);
  useEffect(() => {
    if (selectedIds.length < 2) return;
    const id = setTimeout(() => void loadMultiPanel(), 150);
    return () => clearTimeout(id);
  }, [selectedIds, loadMultiPanel]);

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
  // File-drop import, SCOPED to the middle library pane (and the welcome screen) —
  // not the whole window — so it never competes with the journal-cover drop
  // target in the right pane. `dropDepth` balances enter/leave across the pane's
  // nested children so the overlay doesn't flicker or stick.
  const dropDepth = useRef(0);
  const onDropEnter = (e: ReactDragEvent): void => {
    e.preventDefault();
    dropDepth.current += 1;
    // Only show the import overlay for external file drags — not for an in-app
    // row drag-out (which carries text/plain cite commands).
    if (e.dataTransfer.types.includes('Files')) setDragging(true);
  };
  const onDropOver = (e: ReactDragEvent): void => e.preventDefault();
  const onDropLeave = (e: ReactDragEvent): void => {
    e.preventDefault();
    if (--dropDepth.current <= 0) {
      dropDepth.current = 0;
      setDragging(false);
    }
  };
  const onDropFiles = (e: ReactDragEvent): void => {
    e.preventDefault();
    dropDepth.current = 0;
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
  const dropHandlers = {
    onDragEnter: onDropEnter,
    onDragOver: onDropOver,
    onDragLeave: onDropLeave,
    onDrop: onDropFiles,
  };

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
        setCoverScanOpen,
      });
    });
    const unsubCols = api.onMenuToggleColumn((key) => void getStore().getState().toggleColumn(key));
    const unsubExportTmpl = api.onMenuExportTemplate((req) =>
      void getStore().getState().exportTemplate(req.templateName, req.scope),
    );
    const unsubSetColor = api.onMenuSetColor((colorIndex) =>
      void getStore().getState().setColor(colorIndex === 0 ? null : colorIndex),
    );
    // Another window mutated a document → refresh, but only if it was OURS
    // (with several libraries open, each window ignores the others' edits).
    const unsubChanged = api.onDocumentChanged((e) => {
      if (e.documentId === getStore().getState().documentId) {
        void getStore().getState().reloadAfterExternalChange();
      }
    });
    return () => {
      unsubOpen();
      unsubPrefs();
      unsubMenu();
      unsubCols();
      unsubExportTmpl();
      unsubSetColor();
      unsubChanged();
    };
  }, [onDocumentOpened]);

  if (!hasDoc) {
    return (
      <div className="bd-app" {...dropHandlers}>
        <Welcome />
        {dragging && (
          <div className="bd-drop-overlay" aria-hidden="true">
            <div className="bd-drop-overlay__msg">{t('welcome.dropHint')}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bd-app">
      <Header />
      <Toolbar onOpenMacros={() => setMacrosOpen(true)} onOpenOnline={() => setOnlineOpen(true)} />
      <div
        className="bd-panes"
        style={{
          gridTemplateColumns: layout.rightPaneVisible
            ? `220px minmax(0, 1fr) 6px ${layout.rightPaneWidth}px`
            : '220px minmax(0, 1fr)',
        }}
      >
        <aside className="bd-pane">
          <GroupsSidebar />
        </aside>
        {/* Middle column: the table, with the bottom panel scoped under it. This
            pane (not the whole window) is the file-import drop target. */}
        <section className="bd-pane bd-center" {...dropHandlers}>
          <div className="bd-center__table">
            <PublicationsTable />
          </div>
          {dragging && (
            <div className="bd-drop-overlay bd-drop-overlay--pane" aria-hidden="true">
              <div className="bd-drop-overlay__msg">{t('app.dropImport')}</div>
            </div>
          )}
          {layout.bottomPanelVisible && (
            <>
              <Splitter
                orientation="horizontal"
                label={t('splitter.bottom')}
                onDrag={(dy) => {
                  const cur = getStore().getState().settings.layout.bottomPanelHeight;
                  setLayout({ bottomPanelHeight: Math.max(80, Math.min(600, cur - dy)) }, false);
                }}
                onCommit={() => setLayout({}, true)}
              />
              <div className="bd-bottom" style={{ height: layout.bottomPanelHeight }}>
                <BottomPanel />
              </div>
            </>
          )}
        </section>
        {layout.rightPaneVisible && (
          <>
            <Splitter
              orientation="vertical"
              label={t('splitter.side')}
              onDrag={(dx) => {
                const cur = getStore().getState().settings.layout.rightPaneWidth;
                setLayout({ rightPaneWidth: Math.max(240, Math.min(800, cur - dx)) }, false);
              }}
              onCommit={() => setLayout({}, true)}
            />
            <RightPane />
          </>
        )}
      </div>
      <Footer />
      <BatchBar />
      {macrosOpen && <MacroEditor onClose={() => setMacrosOpen(false)} />}
      {onlineOpen && <OnlineSearch onClose={() => setOnlineOpen(false)} />}
      {prefsOpen && <Preferences onClose={() => setPrefsOpen(false)} />}
      {findReplaceOpen && <FindReplace onClose={() => setFindReplaceOpen(false)} />}
      {duplicatesOpen && <FindDuplicates onClose={() => setDuplicatesOpen(false)} />}
      {brokenLinksOpen && <BrokenLinks onClose={() => setBrokenLinksOpen(false)} />}
      {coverScanOpen && <JournalCoverScan onClose={() => setCoverScanOpen(false)} />}
    </div>
  );
}
