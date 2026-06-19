/**
 * Find Duplicates modal — runs a duplicate scan on mount and lists the groups
 * (entries sharing a cite key, or with equivalent field content). Clicking an
 * entry selects it in the main table (and closes the modal) so the user can
 * compare, merge, or delete. Read-only: it never mutates the library itself.
 */

import { useCallback, useEffect, useState } from 'react';
import type { FindDuplicatesResult } from '@bibdesk/shared';
import { useStore } from './store.js';
import { useT } from './i18n.js';
import { Icon } from './icons.js';

export function FindDuplicates({ onClose }: { onClose: () => void }) {
  const t = useT();
  const findDuplicates = useStore((s) => s.findDuplicates);
  const selectByCiteKey = useStore((s) => s.selectByCiteKey);
  const edit = useStore((s) => s.edit);
  const [result, setResult] = useState<FindDuplicatesResult | undefined>();

  const scan = useCallback(async (): Promise<void> => {
    setResult(await findDuplicates());
  }, [findDuplicates]);

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

  // Merge a group into its first entry, then re-scan (the group should be gone).
  const merge = async (entryIds: readonly string[]): Promise<void> => {
    const [primaryId, ...otherIds] = entryIds;
    if (!primaryId || otherIds.length === 0) return;
    await edit({ kind: 'mergeEntries', primaryId, otherIds });
    await scan();
  };

  return (
    <div className="bd-modal-backdrop" onClick={onClose}>
      <div
        className="bd-modal bd-modal--wide"
        role="dialog"
        aria-label={t('dup.ariaLabel')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bd-modal__header">
          <span>
            {t('dup.title')}
            {result && result.groups.length > 0 && (
              <span className="bd-dup__summary">
                {' '}
                {t('dup.summary', { groups: result.groups.length, total: result.total })}
              </span>
            )}
          </span>
          <button type="button" className="bd-field__del" title={t('common.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="bd-modal__body">
          {!result ? (
            <p className="bd-modal__empty">{t('dup.scanning')}</p>
          ) : result.groups.length === 0 ? (
            <p className="bd-modal__empty">{t('dup.none')}</p>
          ) : (
            result.groups.map((g, gi) => (
              <div className="bd-dup__group" key={gi}>
                <div className="bd-dup__kind">
                  <span>
                    {g.kind === 'citeKey' ? t('dup.identicalKey') : t('dup.equivalent')} ·{' '}
                    {t('dup.entriesCount', { count: g.entries.length })}
                  </span>
                  <button
                    type="button"
                    className="bd-btn bd-btn--small"
                    title={t('dup.mergeTitle')}
                    onClick={() => void merge(g.entries.map((e) => e.id))}
                  >
                    {t('dup.merge')}
                  </button>
                </div>
                <ul className="bd-dup__entries">
                  {g.entries.map((e) => (
                    <li key={e.id}>
                      <button type="button" className="bd-dup__entry" onClick={() => pick(e.citeKey)}>
                        <code>{e.citeKey}</code>
                        <span className="bd-dup__title">{e.title || t('common.untitled')}</span>
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
