/**
 * Detail / preview pane. Shows the selected item's preview card (trusted HTML
 * pre-rendered + escaped by main), then a fields table (inherited fields are
 * muted + badged), then the attachments list.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { ItemFile, ItemDetail } from '@bibdesk/shared';
import { useStore } from './store.js';
import { typesetMath } from './mathjax.js';

function fileIcon(kind: ItemFile['kind']): string {
  return kind === 'url' ? '🔗' : '📄';
}

/** Open a URL/file via the bridge; best-effort (no-op if bridge absent). */
function openExternal(target: string, kind: 'url' | 'file'): void {
  void window.bibdesk?.openExternal({ target, kind });
}

function PreviewCard({ html }: { html: string }) {
  // main HTML-escapes field values before composing this snippet, so it is
  // trusted-but-sanitized; render it directly, then run MathJax over any $…$.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && html.includes('$')) void typesetMath(ref.current);
  }, [html]);
  // Delegate clicks on the card's DOI/URL chips (rendered by main as buttons
  // carrying data-open-url) to the external opener.
  const onClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-open-url]');
    if (el?.dataset.openUrl) {
      e.preventDefault();
      openExternal(el.dataset.openUrl, 'url');
    }
  }, []);
  return (
    <div
      className="bd-preview"
      ref={ref}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Fields({ detail }: { detail: ItemDetail }) {
  if (detail.fields.length === 0) return null;
  return (
    <>
      <div className="bd-detail__section">Fields</div>
      <div className="bd-fields">
        {detail.fields.map((f, i) => (
          <div
            key={`${f.name}-${i}`}
            className={'bd-field' + (f.isInherited ? ' bd-field--inherited' : '')}
            style={{ display: 'contents' }}
          >
            <div className="bd-field__name">{f.name}</div>
            <div className="bd-field__value">
              {f.value}
              {f.isInherited && <span className="bd-field__badge">(inherited)</span>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Attachments({ detail }: { detail: ItemDetail }) {
  if (detail.files.length === 0) return null;
  return (
    <>
      <div className="bd-detail__section">Attachments</div>
      <ul className="bd-files">
        {detail.files.map((file, i) => (
          <li className="bd-file" key={`${file.url}-${i}`}>
            <button
              type="button"
              className="bd-file__btn"
              title={`Open ${file.url}`}
              onClick={() => openExternal(file.url, file.kind === 'url' ? 'url' : 'file')}
            >
              <span className="bd-file__icon" aria-hidden="true">
                {fileIcon(file.kind)}
              </span>
              <span className="bd-file__name">{file.displayName}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function DetailPane() {
  const detail = useStore((s) => s.detail);
  const selectedItemId = useStore((s) => s.selectedItemId);
  const detailLoading = useStore((s) => s.detailLoading);

  if (!selectedItemId) {
    return <div className="bd-detail__empty">Select a publication to see its details.</div>;
  }

  if (!detail || detail.id !== selectedItemId) {
    return <div className="bd-detail__empty">{detailLoading ? 'Loading…' : ''}</div>;
  }

  return (
    <div className="bd-detail">
      {detail.previewHtml ? (
        <PreviewCard html={detail.previewHtml} />
      ) : (
        <div>
          <span className="bd-detail__citekey">{detail.citeKey}</span>
          <span className="bd-detail__type">{detail.type}</span>
        </div>
      )}
      <Fields detail={detail} />
      <Attachments detail={detail} />
    </div>
  );
}
