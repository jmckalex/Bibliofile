/**
 * Bottom-panel LaTeX preview. Renders the artifact produced by the TeX toolchain:
 *  - a small selection comes back as inline SVG (DVI→dvisvgm), styled to inherit
 *    the pane's text colour so it themes with light/dark;
 *  - the whole library / big selections come back as PDF bytes, rasterised page
 *    by page with PDF.js (`pdfjs.ts`).
 * While the pane is open it auto-refreshes: it renders on open and re-renders
 * (debounced) whenever the selection changes, so no manual refresh is needed.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from './store.js';
import { useT } from './i18n.js';
import { renderPdfToCanvases } from './pdfjs.js';

/** Debounce so arrow-key navigation through rows doesn't spawn a LaTeX run per row. */
const REFRESH_DEBOUNCE_MS = 350;

export function TexPreviewPane() {
  const t = useT();
  const state = useStore((s) => s.texPreviewState);
  const texPreview = useStore((s) => s.texPreview);
  const documentId = useStore((s) => s.documentId);
  const selectedIds = useStore((s) => s.selectedIds);
  const pdfHostRef = useRef<HTMLDivElement>(null);
  const [pdfError, setPdfError] = useState<string | undefined>(undefined);
  const firstRun = useRef(true);

  // Auto-refresh: with a selection, render immediately on open, then re-render
  // (debounced) on every selection change. Nothing selected → show the hint, no
  // render. The store's sequence guard discards superseded results.
  const selKey = selectedIds.join(',');
  const hasSelection = selectedIds.length > 0;
  useEffect(() => {
    if (!documentId || !hasSelection) return;
    if (firstRun.current) {
      firstRun.current = false;
      void texPreview();
      return;
    }
    const id = setTimeout(() => void texPreview(), REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [selKey, hasSelection, documentId, texPreview]);

  // Rasterise PDF bytes to canvases whenever they arrive or change. SVG and the
  // other states render declaratively below; only PDF needs this imperative step.
  useEffect(() => {
    const host = pdfHostRef.current;
    if (!host) return;
    if (state.kind !== 'pdf' || !state.pdfBytes) {
      host.replaceChildren();
      return;
    }
    let cancelled = false;
    setPdfError(undefined);
    host.replaceChildren();
    renderPdfToCanvases(state.pdfBytes)
      .then((canvases) => {
        if (cancelled) return;
        for (const c of canvases) {
          c.className = 'bd-texpreview__page';
          host.appendChild(c);
        }
      })
      .catch((err) => {
        if (!cancelled) setPdfError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [state.kind, state.pdfBytes]);

  let body;
  if (!hasSelection) {
    body = <p className="bd-bottompanel__hint">{t('panel.texPreviewHint')}</p>;
  } else if (state.loading) {
    body = <p className="bd-bottompanel__hint">{t('panel.texPreviewLoading')}</p>;
  } else if (state.error) {
    body = <pre className="bd-texpreview__error">{state.error}</pre>;
  } else if (state.kind === 'svg' && state.svgs?.length) {
    body = state.svgs.map((svg, i) => (
      <div
        key={i}
        className="bd-texpreview__page bd-texpreview__svg"
        // dvisvgm output; recoloured to currentColor so it themes with the pane.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    ));
  } else if (state.kind === 'pdf') {
    body = pdfError ? <pre className="bd-texpreview__error">{pdfError}</pre> : <div ref={pdfHostRef} />;
  } else {
    // Selection present but the first render hasn't set loading yet (one frame).
    body = <p className="bd-bottompanel__hint">{t('panel.texPreviewLoading')}</p>;
  }

  return <div className="bd-texpreview__body">{body}</div>;
}
