/**
 * In-app PDF viewer for attachments — renders pages with PDF.js (pdfjs-dist) in
 * a scrolling overlay, with zoom and an "open externally" escape hatch. The PDF
 * bytes are fetched from main via `readAttachment` (validated against the item's
 * real attachments), so the renderer never touches the filesystem directly.
 */

import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ItemFile } from '@bibdesk/shared';
import { useStore } from './store.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfViewer({ file, onClose }: { file: ItemFile; onClose: () => void }) {
  const documentId = useStore((s) => s.documentId);
  const itemId = useStore((s) => s.selectedItemId);
  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docRef = useRef<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [error, setError] = useState<string | undefined>();

  // Load the document once (per attachment).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!documentId || !itemId || !window.bibdesk) return;
      const res = await window.bibdesk.readAttachment({ documentId, itemId, url: file.url });
      if (cancelled) return;
      if (!res.data) {
        setError(res.error ?? 'Could not read the file.');
        return;
      }
      try {
        const doc = await pdfjs.getDocument({ data: res.data }).promise;
        if (cancelled) {
          void doc.destroy();
          return;
        }
        docRef.current = doc;
        setNumPages(doc.numPages);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      void docRef.current?.destroy?.();
      docRef.current = null;
    };
  }, [documentId, itemId, file.url]);

  // (Re)render all pages whenever the doc loads or the zoom changes.
  useEffect(() => {
    const doc = docRef.current;
    const container = scrollRef.current;
    if (!doc || !container) return;
    let cancelled = false;
    void (async () => {
      container.replaceChildren();
      for (let p = 1; p <= doc.numPages; p++) {
        if (cancelled) return;
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.className = 'bd-pdf__page';
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        container.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numPages, scale]);

  return (
    <div className="bd-modal-backdrop" onClick={onClose}>
      <div className="bd-pdf" role="dialog" aria-label="PDF preview" onClick={(e) => e.stopPropagation()}>
        <div className="bd-pdf__bar">
          <span className="bd-pdf__name" title={file.url}>
            📄 {file.displayName}
          </span>
          {numPages > 0 && <span className="bd-pdf__pages">{numPages} pages</span>}
          <span className="bd-toolbar__spacer" />
          <button type="button" className="bd-btn bd-btn--small" title="Zoom out" onClick={() => setScale((s) => Math.max(0.5, +(s - 0.2).toFixed(2)))}>
            −
          </button>
          <button type="button" className="bd-btn bd-btn--small" title="Zoom in" onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(2)))}>
            +
          </button>
          <button
            type="button"
            className="bd-btn bd-btn--small"
            onClick={() => void window.bibdesk?.openExternal({ target: file.url, kind: 'file' })}
          >
            Open externally
          </button>
          <button type="button" className="bd-field__del" title="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {error ? (
          <div className="bd-pdf__error">Could not preview this file: {error}</div>
        ) : (
          <div className="bd-pdf__scroll" ref={scrollRef} />
        )}
      </div>
    </div>
  );
}
