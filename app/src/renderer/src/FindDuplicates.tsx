/**
 * Find Duplicates modal — runs a duplicate scan on mount and lists the groups
 * (entries sharing a cite key, or with equivalent field content). Clicking an
 * entry selects it in the main table (and closes the modal) so the user can
 * compare, merge, or delete. Read-only: it never mutates the library itself.
 */

import { useEffect, useState } from 'react';
import type { FindDuplicatesResult } from '@bibdesk/shared';
import { useStore } from './store.js';

export function FindDuplicates({ onClose }: { onClose: () => void }) {
  const findDuplicates = useStore((s) => s.findDuplicates);
  const selectByCiteKey = useStore((s) => s.selectByCiteKey);
  const [result, setResult] = useState<FindDuplicatesResult | undefined>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await findDuplicates();
      if (!cancelled) setResult(res);
    })();
    return () => {
      cancelled = true;
    };
  }, [findDuplicates]);

  const pick = (citeKey: string): void => {
    void selectByCiteKey(citeKey);
    onClose();
  };

  return (
    <div className="bd-modal-backdrop" onClick={onClose}>
      <div
        className="bd-modal bd-modal--wide"
        role="dialog"
        aria-label="Find duplicates"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bd-modal__header">
          <span>
            Find Duplicates
            {result && result.groups.length > 0 && (
              <span className="bd-dup__summary">
                {' '}
                — {result.groups.length} group{result.groups.length === 1 ? '' : 's'}, {result.total}{' '}
                entries
              </span>
            )}
          </span>
          <button type="button" className="bd-field__del" title="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="bd-modal__body">
          {!result ? (
            <p className="bd-modal__empty">Scanning…</p>
          ) : result.groups.length === 0 ? (
            <p className="bd-modal__empty">No duplicates found. 🎉</p>
          ) : (
            result.groups.map((g, gi) => (
              <div className="bd-dup__group" key={gi}>
                <div className="bd-dup__kind">
                  {g.kind === 'citeKey' ? 'Identical cite key' : 'Equivalent content'} ·{' '}
                  {g.entries.length} entries
                </div>
                <ul className="bd-dup__entries">
                  {g.entries.map((e) => (
                    <li key={e.id}>
                      <button type="button" className="bd-dup__entry" onClick={() => pick(e.citeKey)}>
                        <code>{e.citeKey}</code>
                        <span className="bd-dup__title">{e.title || '(untitled)'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
