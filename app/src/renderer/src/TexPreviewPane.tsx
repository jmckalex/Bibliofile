/**
 * Bottom-panel LaTeX preview. Renders the artifact produced by the TeX toolchain
 * (via the `texPreview` store action / Tools → LaTeX Preview):
 *  - a small selection comes back as inline SVG (DVI→dvisvgm), styled to inherit
 *    the pane's text colour so it themes with light/dark;
 *  - the whole library / big selections come back as PDF bytes, rasterised page
 *    by page with PDF.js (`pdfjs.ts`).
 * The Refresh button re-runs the render for the current selection.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from './store.js';
import { useT } from './i18n.js';
import { renderPdfToCanvases } from './pdfjs.js';

export function TexPreviewPane() {
  const t = useT();
  const state = useStore((s) => s.texPreviewState);
  const texPreview = useStore((s) => s.texPreview);
  const documentId = useStore((s) => s.documentId);
  const pdfHostRef = useRef<HTMLDivElement>(null);
  const [pdfError, setPdfError] = useState<string | undefined>(undefined);

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
  if (state.loading) {
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
    body = <p className="bd-bottompanel__hint">{t('panel.texPreviewHint')}</p>;
  }

  return (
    <div className="bd-texpreview">
      <div className="bd-texpreview__bar">
        <button
          type="button"
          className="bd-rptab"
          disabled={!documentId || state.loading}
          onClick={() => void texPreview()}
        >
          {t('panel.texPreviewRender')}
        </button>
      </div>
      <div className="bd-texpreview__body">{body}</div>
    </div>
  );
}
