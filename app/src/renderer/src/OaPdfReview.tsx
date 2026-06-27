/**
 * Open-Access PDF review window — for a "possible match" the locator wasn't sure
 * enough to attach automatically. Downloads the candidate PDF (via the main
 * process) and renders it in-app with PDF.js, so you can eyeball whether it's the
 * right paper, then **Attach** it to the entry or **Discard**. No external app.
 */

import { useEffect, useRef, useState } from 'react';
import { useStore } from './store.js';
import { useT } from './i18n.js';
import { Icon } from './icons.js';
import { renderPdfToCanvases } from './pdfjs.js';

export function OaPdfReview({
  itemId,
  citeKey,
  matchedTitle,
  url,
  onClose,
}: {
  itemId: string;
  citeKey: string;
  matchedTitle?: string;
  url: string;
  onClose: () => void;
}) {
  const t = useT();
  const attachReviewedPdf = useStore((s) => s.attachReviewedPdf);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'attaching' | 'error'>('loading');
  const [error, setError] = useState('');

  // Download + render the candidate PDF once, on open.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await window.bibdesk.fetchPdfBytes({ url });
      if (cancelled) return;
      if (!res.data) {
        setError(res.error ?? t('oareview.error'));
        setStatus('error');
        return;
      }
      setBytes(res.data);
      try {
        const canvases = await renderPdfToCanvases(res.data, { scale: 1.2 });
        if (cancelled) return;
        const host = pagesRef.current;
        if (host) {
          host.replaceChildren(
            ...canvases.map((c) => {
              c.className = 'bd-oareview__page';
              return c;
            }),
          );
        }
        setStatus('ready');
      } catch {
        if (!cancelled) {
          setError(t('oareview.error'));
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attach = async (): Promise<void> => {
    if (!bytes) return;
    setStatus('attaching');
    const ok = await attachReviewedPdf(itemId, bytes);
    if (ok) onClose();
    else setStatus('ready');
  };

  return (
    <div className="bd-modal-backdrop" onClick={onClose}>
      <div
        className="bd-modal bd-modal--wide bd-oareview"
        role="dialog"
        aria-label={t('oareview.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bd-modal__header">
          <span>
            {t('oareview.title')}{' '}
            <span className="bd-oareview__sub">
              <code>{citeKey}</code>
              {matchedTitle ? ` · ${matchedTitle}` : ''}
            </span>
          </span>
          <button type="button" className="bd-field__del" title={t('common.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="bd-oareview__body">
          {status === 'loading' && <p className="bd-modal__empty">{t('oareview.loading')}</p>}
          {status === 'error' && <p className="bd-modal__empty">{error}</p>}
          <div className="bd-oareview__pages" ref={pagesRef} />
        </div>
        <div className="bd-oareview__footer">
          <span className="bd-oareview__hint">{t('oareview.hint')}</span>
          <span className="bd-toolbar__spacer" />
          <button type="button" className="bd-btn" onClick={onClose}>
            {t('oareview.discard')}
          </button>
          <button
            type="button"
            className="bd-btn bd-btn--primary"
            disabled={status !== 'ready'}
            onClick={() => void attach()}
          >
            {status === 'attaching' ? t('oareview.attaching') : t('oareview.attach')}
          </button>
        </div>
      </div>
    </div>
  );
}
