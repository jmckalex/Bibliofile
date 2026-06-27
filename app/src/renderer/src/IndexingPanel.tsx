/**
 * Background full-text indexing panel — a small **non-blocking** card (lower-left)
 * that shows how far the app has got reading the text out of the library's PDF
 * attachments into the search index, the first time a library is opened. Driven by
 * `onIndexProgress` events (see the store's `applyIndexProgress`). It only appears
 * if indexing actually takes a moment — a fast cache-hit reopen never flashes it —
 * and disappears when indexing finishes (or you dismiss it; indexing keeps going).
 */

import { useEffect, useState } from 'react';
import { useStore } from './store.js';
import { useT } from './i18n.js';
import { Icon } from './icons.js';

export function IndexingPanel() {
  const t = useT();
  const indexing = useStore((s) => s.indexing);
  const dismiss = useStore((s) => s.dismissIndexing);
  const active = indexing !== null;

  // Delay showing so a fast (all-cache-hit) reopen doesn't flash a panel.
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) {
      setShow(false);
      return;
    }
    const timer = setTimeout(() => setShow(true), 700);
    return () => clearTimeout(timer);
  }, [active]);

  if (!indexing || !show) return null;
  const pct = indexing.total ? Math.round((indexing.done / indexing.total) * 100) : 0;

  return (
    <div className="bd-oa-panel bd-index-panel" role="dialog" aria-label={t('index.title')}>
      <div className="bd-oa-panel__header">
        <span className="bd-oa-panel__title">{t('index.title')}</span>
        <span className="bd-oa-panel__count">
          {t('index.progress', { done: indexing.done, total: indexing.total })}
        </span>
        <button type="button" className="bd-field__del" title={t('common.close')} onClick={dismiss}>
          <Icon name="close" />
        </button>
      </div>
      <div
        className="bd-oa-panel__bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="bd-oa-panel__barfill" style={{ width: `${pct}%` }} />
      </div>
      <p className="bd-index-panel__hint">{t('index.hint')}</p>
    </div>
  );
}
