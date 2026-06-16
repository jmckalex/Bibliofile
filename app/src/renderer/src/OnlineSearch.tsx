/**
 * Online search modal — query CrossRef / arXiv (via main, no CORS) and import a
 * result as a new entry. Search state is local; importing goes through the store
 * (which refreshes the table + selects the new entry).
 */

import { useState } from 'react';
import { ONLINE_SOURCES, type OnlineResult, type OnlineSource } from '@bibdesk/shared';
import { useStore } from './store.js';

export function OnlineSearch({ onClose }: { onClose: () => void }) {
  const importOnline = useStore((s) => s.importOnline);
  const [source, setSource] = useState<OnlineSource>('crossref');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OnlineResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [imported, setImported] = useState<Set<number>>(new Set());

  const run = async (): Promise<void> => {
    if (!query.trim() || !window.bibdesk) return;
    setSearching(true);
    setError(undefined);
    setResults([]);
    setImported(new Set());
    try {
      const res = await window.bibdesk.searchOnline({ source, query });
      setResults([...res.results]);
      if (res.error) setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="bd-modal-backdrop" onClick={onClose}>
      <div className="bd-modal bd-modal--wide" role="dialog" aria-label="Online search" onClick={(e) => e.stopPropagation()}>
        <div className="bd-modal__header">
          <span>Online search</span>
          <button type="button" className="bd-field__del" title="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="bd-online__bar">
          <select
            className="bd-input bd-select"
            value={source}
            onChange={(e) => setSource(e.target.value as OnlineSource)}
          >
            {ONLINE_SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <input
            className="bd-input"
            placeholder="Search title, author, DOI…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run();
            }}
          />
          <button type="button" className="bd-btn bd-btn--primary" disabled={searching} onClick={() => void run()}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="bd-modal__body">
          {error && <p className="bd-footer__error">{error}</p>}
          {!searching && results.length === 0 && !error && (
            <p className="bd-modal__empty">Enter a query and press Search.</p>
          )}
          {results.map((r, i) => (
            <div className="bd-online__result" key={i}>
              <div className="bd-online__meta">
                <div className="bd-online__title">{r.title || '(untitled)'}</div>
                <div className="bd-online__sub">
                  {[r.authorsDisplay, r.year, r.venue].filter(Boolean).join(' · ')}
                  {r.doi ? ` · ${r.doi}` : ''}
                </div>
              </div>
              <button
                type="button"
                className="bd-btn bd-btn--small"
                disabled={imported.has(i)}
                onClick={() => {
                  void importOnline(r);
                  setImported((s) => new Set(s).add(i));
                }}
              >
                {imported.has(i) ? 'Imported' : 'Import'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
