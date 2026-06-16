/**
 * App shell — three-pane CSS grid (groups | publications | detail) with a
 * header (document name + counts) and a status-bar footer.
 *
 * Lifecycle: main auto-opens a .bib at startup and pushes `documentOpened`. We
 * register onDocumentOpened on mount, hand the doc to the store (which loads
 * groups + publications), and clean up the subscription on unmount.
 */

import { useEffect, useState } from 'react';
import { filterRows, useStore } from './store.js';
import { GroupsSidebar } from './GroupsSidebar.js';
import { PublicationsTable } from './PublicationsTable.js';
import { DetailPane } from './DetailPane.js';
import { MacroEditor } from './MacroEditor.js';
import { OnlineSearch } from './OnlineSearch.js';

type Theme = 'light' | 'dark';

function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem('bd-theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* ignore */
  }
  return 'light';
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('bd-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return (
    <button
      type="button"
      className="bd-theme-toggle"
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label="Toggle colour theme"
      onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}

function SearchBox() {
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const hasDoc = useStore((s) => s.documentId !== undefined);
  if (!hasDoc) return null;
  return (
    <div className="bd-search">
      <input
        className="bd-search__input"
        type="search"
        placeholder="Filter publications…"
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
  const selectedGroupId = useStore((s) => s.selectedGroupId);
  const groups = useStore((s) => s.groups);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);

  const groupName = groups.find((g) => g.id === selectedGroupId)?.name;
  const filtered = query.trim() ? filterRows(rows, query).length : total;
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
  const hasDoc = useStore((s) => s.documentId !== undefined);
  if (!hasDoc) return null;
  return (
    <div className="bd-toolbar">
      <button type="button" className="bd-btn" onClick={() => void edit({ kind: 'addEntry', entryType: 'article' })}>
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

export function App() {
  const onDocumentOpened = useStore((s) => s.onDocumentOpened);
  const save = useStore((s) => s.save);
  const [macrosOpen, setMacrosOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);

  useEffect(() => {
    const api = window.bibdesk;
    if (!api) return;
    const unsub = api.onDocumentOpened((doc) => {
      void onDocumentOpened(doc);
    });
    return unsub;
  }, [onDocumentOpened]);

  // Cmd/Ctrl+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

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
          <DetailPane />
        </section>
      </div>
      <Footer />
      {macrosOpen && <MacroEditor onClose={() => setMacrosOpen(false)} />}
      {onlineOpen && <OnlineSearch onClose={() => setOnlineOpen(false)} />}
    </div>
  );
}
