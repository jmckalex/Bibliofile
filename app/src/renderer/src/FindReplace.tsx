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
import { useT } from './i18n.js';

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
  const t = useT();
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
        aria-label={t('fr.aria')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bd-modal__header">
          <span>
            {t('fr.title')}
            {groupName ? t('fr.inGroup', { name: groupName }) : ''}
          </span>
          <button type="button" className="bd-field__del" title={t('common.close')} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="bd-modal__body">
          <div className="bd-fr__row">
            <span className="bd-fr__label">{t('fr.field')}</span>
            <select className="bd-input bd-select" value={field} onChange={(e) => setField(e.target.value)}>
              <option value="">{t('fr.allFields')}</option>
              {FIELD_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="bd-fr__row">
            <span className="bd-fr__label">{t('fr.find')}</span>
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
            <span className="bd-fr__label">{t('fr.replace')}</span>
            <input className="bd-input" value={replace} onChange={(e) => setReplace(e.target.value)} />
          </div>
          <div className="bd-fr__opts">
            <label>
              <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />{' '}
              {t('fr.regex')}
            </label>
            <label>
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
              />{' '}
              {t('fr.caseSensitive')}
            </label>
          </div>

          {result && (
            <div className="bd-fr__result">
              {result.error ? (
                <span className="bd-fr__error">{t('fr.invalidPattern', { error: result.error })}</span>
              ) : result.applied ? (
                <span>
                  {t('fr.replaced')} <strong>{result.total}</strong>{' '}
                  {t(result.total === 1 ? 'fr.occurrence' : 'fr.occurrences')} {t('fr.inWord')}{' '}
                  <strong>{result.matches.length}</strong>{' '}
                  {t(result.matches.length === 1 ? 'fr.fieldWord' : 'fr.fieldsWord')}.
                </span>
              ) : (
                <span>
                  <strong>{result.total}</strong>{' '}
                  {t(result.total === 1 ? 'fr.occurrence' : 'fr.occurrences')} {t('fr.inWord')}{' '}
                  <strong>{result.matches.length}</strong>{' '}
                  {t(result.matches.length === 1 ? 'fr.fieldWord' : 'fr.fieldsWord')}.
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
                  {result.matches.length > 40 && (
                    <li>{t('fr.andMore', { count: result.matches.length - 40 })}</li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="bd-modal__footer">
          <button type="button" className="bd-btn" disabled={busy || !find} onClick={() => void run(false)}>
            {t('fr.find')}
          </button>
          <button
            type="button"
            className="bd-btn bd-btn--primary"
            disabled={busy || !find}
            onClick={() => void run(true)}
          >
            {t('fr.replaceAll')}
          </button>
        </div>
      </div>
    </div>
  );
}

function truncate(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
