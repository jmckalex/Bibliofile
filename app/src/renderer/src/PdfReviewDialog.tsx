/**
 * Drop-a-PDF review dialog.
 *
 * When dropped PDFs have no DOI/arXiv id (so no metadata could be fetched), they
 * are NOT auto-added to the library — instead each is staged as an editable draft
 * in an off-library scratch document, and this modal lets the user fill it in with
 * the real entry editor and Accept (create + attach the PDF) or Discard (drop it).
 *
 * The left panel lists the PDFs; the right panel hosts the standard {@link DetailPane}
 * editor — but pointed at the *staging* store (a second {@link createStore} instance
 * bound to the scratch doc) via {@link StoreContext}, so editing never touches the
 * real library until Accept. Nothing here is committed until the user says so.
 */
import { useEffect, useRef, useState } from 'react';

import { createStore, useStore, StoreContext, type ViewerStore } from './store.js';
import { DetailPane } from './DetailPane.js';
import { Icon } from './icons.js';
import { useT } from './i18n.js';

export function PdfReviewDialog() {
  const t = useT();
  const review = useStore((s) => s.pdfReview);
  const acceptStagedPdf = useStore((s) => s.acceptStagedPdf);
  const discardStagedPdf = useStore((s) => s.discardStagedPdf);
  const finishPdfReview = useStore((s) => s.finishPdfReview);

  // A second store bound to the off-library staging doc drives the editor; the
  // rest of the app keeps running against the real library on the singleton store.
  const stagingRef = useRef<ViewerStore>();
  if (!stagingRef.current && window.bibdesk) stagingRef.current = createStore(window.bibdesk);
  const staging = stagingRef.current;

  const [currentId, setCurrentId] = useState<string | null>(null);

  // Initialise the staging store (entry types + CSL styles for the editor) once we
  // have a batch; re-runs only if the staging document changes (a new drop).
  const stagingDocId = review?.stagingDocId;
  useEffect(() => {
    if (!stagingDocId || !staging) return;
    void staging.getState().loadEntryTypes();
    void staging.getState().loadCitationStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagingDocId]);

  // Keep a valid selection as items are accepted/discarded, and load its detail.
  useEffect(() => {
    if (!review || !staging) return;
    const ids = review.items.map((i) => i.itemId);
    if (currentId && ids.includes(currentId)) return;
    const next = ids[0] ?? null;
    setCurrentId(next);
    if (next) void staging.getState().initEditor(review.stagingDocId, next);
  }, [review, currentId, staging]);

  if (!review || !staging) return null;

  const select = (itemId: string): void => {
    if (itemId === currentId) return;
    setCurrentId(itemId);
    void staging.getState().loadDetail(itemId);
  };

  // Flush a field being edited (its blur-commit reaches the staging doc) before we
  // read it back to commit — the blur dispatches its setField IPC synchronously,
  // ahead of the commit IPC, so the last edit isn't lost.
  const flush = (): void => (document.activeElement as HTMLElement | null)?.blur();

  return (
    <div className="bd-modal-backdrop" onClick={() => void finishPdfReview()}>
      <div
        className="bd-modal bd-modal--wide bd-modal--pdfreview"
        role="dialog"
        aria-label={t('pdfReview.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bd-modal__header">
          <span>{t('pdfReview.heading', { count: review.items.length })}</span>
          <button
            type="button"
            className="bd-field__del"
            title={t('common.close')}
            onClick={() => void finishPdfReview()}
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="bd-pdfreview__hint">{t('pdfReview.hint')}</p>
        <div className="bd-pdfreview">
          <ul className="bd-pdfreview__list">
            {review.items.map((it) => (
              <li key={it.itemId}>
                <button
                  type="button"
                  className={'bd-pdfreview__item' + (it.itemId === currentId ? ' bd-pdfreview__item--on' : '')}
                  title={it.pdf}
                  onClick={() => select(it.itemId)}
                >
                  <span className="bd-pdfreview__icon" aria-hidden="true">
                    <Icon name="attachment" />
                  </span>
                  <span className="bd-pdfreview__name">{it.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="bd-pdfreview__editor">
            {currentId && (
              <StoreContext.Provider value={staging}>
                <DetailPane />
              </StoreContext.Provider>
            )}
          </div>
        </div>
        <div className="bd-pdfreview__actions">
          <span className="bd-pdfreview__count">{t('pdfReview.remaining', { count: review.items.length })}</span>
          <span className="bd-toolbar__spacer" />
          <button
            type="button"
            className="bd-btn bd-btn--danger"
            disabled={!currentId}
            onClick={() => currentId && discardStagedPdf(currentId)}
          >
            {t('pdfReview.discard')}
          </button>
          <button
            type="button"
            className="bd-btn bd-btn--primary"
            disabled={!currentId}
            onClick={() => {
              if (!currentId) return;
              flush();
              void acceptStagedPdf(currentId);
            }}
          >
            {t('pdfReview.accept')}
          </button>
        </div>
      </div>
    </div>
  );
}
