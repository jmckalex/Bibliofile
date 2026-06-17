/**
 * Read-only detail pane shown in the main window's right column. It surfaces the
 * selected item (cover, preview, citation, fields, notes, attachments) WITHOUT
 * any editing controls — so edits can't happen by accident. The **Edit…** button
 * (and double-clicking a row) opens the full edit UI in a separate window
 * ({@link EditorWindow}); changes there refresh this pane via documentChanged.
 */

import type { ItemDetail } from '@bibdesk/shared';
import { useStore } from './store.js';
import { PreviewCard, CitationBlock, JournalCover, NotesSection, Attachments } from './DetailPane.js';
import { MathText } from './MathText.js';

/** Read-only field list: cite key, type, then each field's de-TeXified value. */
function ReadOnlyFields({ detail }: { detail: ItemDetail }) {
  return (
    <>
      <div className="bd-detail__section">Fields</div>
      <dl className="bd-viewfields">
        <dt>Cite Key</dt>
        <dd className="bd-viewfields__mono">{detail.citeKey}</dd>
        <dt>Type</dt>
        <dd>{detail.type}</dd>
        {detail.fields.map((f, i) => (
          <div key={`${f.name}-${i}`} style={{ display: 'contents' }}>
            <dt className={f.isInherited ? 'bd-viewfields__inherited' : undefined}>
              {f.name}
              {f.isInherited && <span className="bd-field__badge">(inherited)</span>}
            </dt>
            <dd>
              <MathText text={f.value} />
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export function ViewPane() {
  const detail = useStore((s) => s.detail);
  const documentId = useStore((s) => s.documentId);
  const selectedItemId = useStore((s) => s.selectedItemId);
  const detailLoading = useStore((s) => s.detailLoading);
  const openEditor = useStore((s) => s.openEditor);

  if (!selectedItemId) {
    return <div className="bd-detail__empty">Select a publication to see its details.</div>;
  }
  if (!detail || detail.id !== selectedItemId) {
    return <div className="bd-detail__empty">{detailLoading ? 'Loading…' : ''}</div>;
  }

  return (
    <div className="bd-detail bd-view">
      <div className="bd-view__actions">
        <button
          type="button"
          className="bd-btn bd-btn--small bd-btn--primary"
          title="Edit this publication in a separate window"
          onClick={() => openEditor(detail.id)}
        >
          ✎ Edit…
        </button>
      </div>
      {documentId && <JournalCover documentId={documentId} itemId={detail.id} />}
      {detail.previewHtml && (
        <PreviewCard html={detail.previewHtml} files={detail.files.filter((f) => f.kind === 'file')} />
      )}
      <CitationBlock detail={detail} />
      <ReadOnlyFields detail={detail} />
      <NotesSection detail={detail} readOnly />
      <Attachments detail={detail} readOnly />
    </div>
  );
}
