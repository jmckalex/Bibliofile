/**
 * Find & Replace modal — search (and optionally replace) text across field
 * values of the current group/library. "Find" previews matches without mutating;
 * "Replace All" performs the replacement via the store (which refreshes the table
 * + detail and marks the document dirty). Supports literal or regex matching and
 * a case-sensitive toggle; "All fields" or one specific field.
 */

import { useState } from 'react';
import type { FindReplaceResult } from '@bibdesk/shared';
import { useStore } from './store.js';

// Common fields offered explicitly; "All fields" searches every field.
const FIELD_OPTIONS = [
  'Title',
  'Author',
  'Editor',
  'Journal',
  'Booktitle',
  'Year',
  'Publisher',
  'Keywords',
  'Abstract',
  'Note',
  'Annote',
  'Doi',
  'Url',
];

export function FindReplace({ onClose }: { onClose: () => void }) {
  const findReplace = useStore((s) => s.findReplace);
  const groups = useStore((s) => s.groups);
  const selectedGroupId = useStore((s) => s.selectedGroupId);
  const groupName = groups.find((g) => g.id === selectedGroupId)?.name;

  const [field, setField] = useState('');
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<FindReplaceResult | undefined>();
  const [busy, setBusy] = useState(false);

  const run = async (apply: boolean): Promise<void> => {
    if (!find) return;
    setBusy(true);
    try {
      const res = await findReplace({
        ...(field ? { field } : {}),
        find,
        replace,
        regex,
        caseSensitive,
        apply,
      });
      setResult(res);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bd-modal-backdrop" onClick={onClose}>
      <div
        className="bd-modal bd-modal--wide"
        role="dialog"
        aria-label="Find and replace"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bd-modal__header">
          <span>Find &amp; Replace{groupName ? ` — in ${groupName}` : ''}</span>
          <button type="button" className="bd-field__del" title="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="bd-modal__body">
          <div className="bd-fr__row">
            <span className="bd-fr__label">Field</span>
            <select className="bd-input bd-select" value={field} onChange={(e) => setField(e.target.value)}>
              <option value="">All fields</option>
              {FIELD_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="bd-fr__row">
            <span className="bd-fr__label">Find</span>
            <input
              className="bd-input"
              value={find}
              autoFocus
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void run(false);
              }}
            />
          </div>
          <div className="bd-fr__row">
            <span className="bd-fr__label">Replace</span>
            <input className="bd-input" value={replace} onChange={(e) => setReplace(e.target.value)} />
          </div>
          <div className="bd-fr__opts">
            <label>
              <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> Regular
              expression
            </label>
            <label>
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
              />{' '}
              Case sensitive
            </label>
          </div>

          {result && (
            <div className="bd-fr__result">
              {result.error ? (
                <span className="bd-fr__error">Invalid pattern: {result.error}</span>
              ) : result.applied ? (
                <span>
                  Replaced <strong>{result.total}</strong> occurrence{result.total === 1 ? '' : 's'} in{' '}
                  {result.matches.length} field{result.matches.length === 1 ? '' : 's'}.
                </span>
              ) : (
                <span>
                  <strong>{result.total}</strong> occurrence{result.total === 1 ? '' : 's'} in{' '}
                  {result.matches.length} field{result.matches.length === 1 ? '' : 's'}.
                </span>
              )}
              {!result.applied && result.matches.length > 0 && (
                <ul className="bd-fr__matches">
                  {result.matches.slice(0, 40).map((m, i) => (
                    <li key={`${m.itemId}:${m.field}:${i}`}>
                      <code>{m.citeKey}</code> · <span className="bd-fr__field">{m.field}</span>:{' '}
                      <span className="bd-fr__before">{truncate(m.before)}</span> →{' '}
                      <span className="bd-fr__after">{truncate(m.after)}</span>
                    </li>
                  ))}
                  {result.matches.length > 40 && <li>… and {result.matches.length - 40} more</li>}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="bd-modal__footer">
          <button type="button" className="bd-btn" disabled={busy || !find} onClick={() => void run(false)}>
            Find
          </button>
          <button
            type="button"
            className="bd-btn bd-btn--primary"
            disabled={busy || !find}
            onClick={() => void run(true)}
          >
            Replace All
          </button>
        </div>
      </div>
    </div>
  );
}

function truncate(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
