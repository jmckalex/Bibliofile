/**
 * OCR Scanned PDFs — a **non-blocking** floating panel (bottom-right) that shows
 * live progress while the main process adds a searchable text layer to the
 * image-only PDFs of the selected entries, then the per-entry summary. The user
 * can keep working in the library while it runs. State lives in the store
 * (`ocr`), fed by `ocrProgress` events; this component only renders it. Clicking
 * a row selects that entry.
 */

import type { OcrItemStatus } from '@bibdesk/shared';
import { useStore } from './store.js';
import { useT } from './i18n.js';
import { Icon } from './icons.js';

const STATUS_KEY: Record<OcrItemStatus, string> = {
  ocred: 'ocr.status.ocred',
  skipped: 'ocr.status.skipped',
  error: 'ocr.status.error',
};

export function OcrPanel() {
  const t = useT();
  const ocr = useStore((s) => s.ocr);
  const close = useStore((s) => s.closeOcr);
  const selectByCiteKey = useStore((s) => s.selectByCiteKey);
  if (!ocr) return null;

  const ocred = ocr.results.filter((r) => r.status === 'ocred').length;
  const pct = ocr.total ? Math.round((ocr.done / ocr.total) * 100) : 0;

  return (
    <div className="bd-oa-panel" role="dialog" aria-label={t('ocr.title')}>
      <div className="bd-oa-panel__header">
        <span className="bd-oa-panel__title">{t('ocr.title')}</span>
        <span className="bd-oa-panel__count">
          {ocr.running
            ? t('ocr.progress', { done: ocr.done, total: ocr.total })
            : t('ocr.summary', { ocred, total: ocr.total })}
        </span>
        <button type="button" className="bd-field__del" title={t('common.close')} onClick={close}>
          <Icon name="close" />
        </button>
      </div>
      {ocr.running && (
        <div className="bd-oa-panel__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="bd-oa-panel__barfill" style={{ width: `${pct}%` }} />
        </div>
      )}
      <ul className="bd-oa__list">
        {ocr.results.map((r) => (
          <li key={r.itemId} className={`bd-oa__row bd-oa__row--${r.status}`}>
            <button type="button" className="bd-oa__entry" onClick={() => void selectByCiteKey(r.citeKey)}>
              <span className={`bd-oa__status bd-oa__status--${r.status}`}>{t(STATUS_KEY[r.status])}</span>
              <code className="bd-oa__key">{r.citeKey}</code>
              <span className="bd-oa__msg">{r.message}</span>
            </button>
          </li>
        ))}
        {ocr.running && ocr.current && (
          <li className="bd-oa__row bd-oa__row--pending">
            <span className="bd-oa__pending">
              {t('ocr.page', {
                citeKey: ocr.current.citeKey,
                page: ocr.current.page,
                pages: ocr.current.pages,
              })}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}
