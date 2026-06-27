/**
 * Find Open-Access PDFs — a **non-blocking** floating panel (bottom-right) that
 * shows live progress while the main process locates and attaches open-access
 * PDFs for the selected entries, then the per-entry summary. The user can keep
 * working in the library while it runs. State lives in the store (`oaLookup`),
 * fed by `oaPdfProgress` events; this component only renders it. Clicking a row
 * selects that entry; an unconfident "possible match" offers an Open-PDF link.
 */

import { useState } from 'react';
import type { OaPdfStatus } from '@bibdesk/shared';
import { useStore } from './store.js';
import { useT } from './i18n.js';
import { Icon } from './icons.js';
import { OaPdfReview } from './OaPdfReview.js';

const STATUS_KEY: Record<OaPdfStatus, string> = {
  attached: 'oa.status.attached',
  candidate: 'oa.status.candidate',
  none: 'oa.status.none',
  skipped: 'oa.status.skipped',
  error: 'oa.status.error',
};

interface ReviewTarget {
  itemId: string;
  citeKey: string;
  matchedTitle?: string;
  url: string;
}

export function OaPdfLocator() {
  const t = useT();
  const oa = useStore((s) => s.oaLookup);
  const close = useStore((s) => s.closeOaLookup);
  const selectByCiteKey = useStore((s) => s.selectByCiteKey);
  const [review, setReview] = useState<ReviewTarget | null>(null);
  if (!oa) return null;

  const attached = oa.results.filter((r) => r.status === 'attached').length;
  const pct = oa.total ? Math.round((oa.done / oa.total) * 100) : 0;
  const remaining = oa.total - oa.results.length;

  return (
    <div className="bd-oa-panel" role="dialog" aria-label={t('oa.title')}>
      <div className="bd-oa-panel__header">
        <span className="bd-oa-panel__title">{t('oa.title')}</span>
        <span className="bd-oa-panel__count">
          {oa.running
            ? t('oa.progress', { done: oa.done, total: oa.total })
            : t('oa.summary', { attached, total: oa.total })}
        </span>
        <button type="button" className="bd-field__del" title={t('common.close')} onClick={close}>
          <Icon name="close" />
        </button>
      </div>
      {oa.running && (
        <div className="bd-oa-panel__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="bd-oa-panel__barfill" style={{ width: `${pct}%` }} />
        </div>
      )}
      <ul className="bd-oa__list">
        {oa.results.map((r) => (
          <li key={r.itemId} className={`bd-oa__row bd-oa__row--${r.status}`}>
            <button type="button" className="bd-oa__entry" onClick={() => void selectByCiteKey(r.citeKey)}>
              <span className={`bd-oa__status bd-oa__status--${r.status}`}>{t(STATUS_KEY[r.status])}</span>
              <code className="bd-oa__key">{r.citeKey}</code>
              <span className="bd-oa__msg">{r.message}</span>
            </button>
            {r.url && (
              <button
                type="button"
                className="bd-btn bd-btn--small bd-oa__open"
                onClick={() =>
                  setReview({ itemId: r.itemId, citeKey: r.citeKey, matchedTitle: r.matchedTitle, url: r.url! })
                }
              >
                {t('oa.review')}
              </button>
            )}
          </li>
        ))}
        {oa.running && remaining > 0 && (
          <li className="bd-oa__row bd-oa__row--pending">
            <span className="bd-oa__pending">{t('oa.searching', { count: remaining })}</span>
          </li>
        )}
      </ul>
      {review && (
        <OaPdfReview
          itemId={review.itemId}
          citeKey={review.citeKey}
          matchedTitle={review.matchedTitle}
          url={review.url}
          onClose={() => setReview(null)}
        />
      )}
    </div>
  );
}
