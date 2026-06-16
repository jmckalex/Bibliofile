/**
 * Detail / preview pane. Shows the selected item's preview card (trusted HTML
 * pre-rendered + escaped by main), then a fields table (inherited fields are
 * muted + badged), then the attachments list.
 */

import type { ItemDetail, ItemFile } from '@bibdesk/shared';
import { useStore } from './store.js';

function fileIcon(kind: ItemFile['kind']): string {
  return kind === 'url' ? '🔗' : '📄';
}

function PreviewCard({ html }: { html: string }) {
  // main HTML-escapes field values before composing this snippet, so it is
  // trusted-but-sanitized; render it directly.
  return <div className="bd-preview" dangerouslySetInnerHTML={{ __html: html }} />;
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
          <li className="bd-file" key={`${file.url}-${i}`} title={file.url}>
            <span className="bd-file__icon" aria-hidden="true">
              {fileIcon(file.kind)}
            </span>
            <span className="bd-file__name">{file.displayName}</span>
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
