/**
 * Read-only detail pane shown in the main window's right column. It surfaces the
 * selected item (cover, preview, citation, fields, notes, attachments) WITHOUT
 * any editing controls — so edits can't happen by accident. The **Edit…** button
 * (and double-clicking a row) opens the full edit UI in a separate window
 * ({@link EditorWindow}); changes there refresh this pane via documentChanged.
 */

import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import type { ItemDetail } from '@bibdesk/shared';
import { useStore } from './store.js';
import { PreviewCard, CitationBlock, JournalCover, NotesSection, Attachments } from './DetailPane.js';
import { MathText } from './MathText.js';
import { hydratePanel } from './panel-hydrate.js';
import { useT } from './i18n.js';
import { Icon } from './icons.js';

/** Read-only field list: cite key, type, then each field's de-TeXified value. */
function ReadOnlyFields({ detail }: { detail: ItemDetail }) {
  const t = useT();
  return (
    <>
      <div className="bd-detail__section">{t('view.fields')}</div>
      <dl className="bd-viewfields">
        <dt>{t('column.citeKey')}</dt>
        <dd className="bd-viewfields__mono">{detail.citeKey}</dd>
        <dt>{t('column.type')}</dt>
        <dd>{detail.type}</dd>
        {detail.fields.map((f, i) => (
          <div key={`${f.name}-${i}`} style={{ display: 'contents' }}>
            <dt className={f.isInherited ? 'bd-viewfields__inherited' : undefined}>
              {f.name}
              {f.isInherited && <span className="bd-field__badge">{t('view.inherited')}</span>}
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
  const t = useT();
  const detail = useStore((s) => s.detail);
  const documentId = useStore((s) => s.documentId);
  const selectedItemId = useStore((s) => s.selectedItemId);
  const selectedIds = useStore((s) => s.selectedIds);
  const multiPanel = useStore((s) => s.multiPanel);
  const detailLoading = useStore((s) => s.detailLoading);
  const openEditor = useStore((s) => s.openEditor);
  const addAttachment = useStore((s) => s.addAttachment);
  const hostRef = useRef<HTMLDivElement>(null);
  const dropDepth = useRef(0);
  const [dropping, setDropping] = useState(false);

  // With 2+ rows selected, show the multi-select list (+ batch tools) instead of
  // the single-item detail. Both are main-rendered Handlebars HTML, hydrated the
  // same way (the multi HTML additionally wires the batch-tool inputs).
  const multi = selectedIds.length >= 2;
  const html = multi
    ? multiPanel?.detailsHtml
    : detail && detail.id === selectedItemId
      ? detail.detailsPanelHtml
      : undefined;
  useEffect(() => {
    const el = hostRef.current;
    if (!el || !html) return;
    return hydratePanel(el);
  }, [html]);

  // File drag-and-drop onto the detail pane attaches the file(s) to the entry
  // currently shown. The <bd-journal-cover> element stops propagation for its own
  // (image) drops, so dropping ON the cover sets the cover and never lands here.
  const dropItemId = detail?.id;
  const acceptsFiles = (e: ReactDragEvent): boolean => e.dataTransfer.types.includes('Files');
  const dropHandlers = {
    onDragEnter: (e: ReactDragEvent) => {
      if (!acceptsFiles(e)) return;
      e.preventDefault();
      dropDepth.current += 1;
      setDropping(true);
    },
    onDragOver: (e: ReactDragEvent) => {
      if (!acceptsFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: ReactDragEvent) => {
      if (!acceptsFiles(e)) return;
      e.preventDefault();
      if (--dropDepth.current <= 0) {
        dropDepth.current = 0;
        setDropping(false);
      }
    },
    onDrop: (e: ReactDragEvent) => {
      e.preventDefault();
      dropDepth.current = 0;
      setDropping(false);
      if (!dropItemId) return;
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => window.bibdesk?.pathForFile(f))
        .filter((p): p is string => !!p);
      if (paths.length) void addAttachment(dropItemId, paths);
    },
  };
  const dropClass = dropping ? ' bd-detail--dropping' : '';

  if (multi) {
    return html ? (
      <div className="bd-detail bd-view bd-detail--multi" ref={hostRef} dangerouslySetInnerHTML={{ __html: html }} />
    ) : (
      <div className="bd-detail__empty">{t('common.loading')}</div>
    );
  }

  if (!selectedItemId) {
    return <div className="bd-detail__empty">{t('detail.empty.select')}</div>;
  }
  if (!detail || detail.id !== selectedItemId) {
    return <div className="bd-detail__empty">{detailLoading ? t('common.loading') : ''}</div>;
  }

  if (html) {
    return (
      <div
        className={'bd-detail bd-view' + dropClass}
        ref={hostRef}
        {...dropHandlers}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // Fallback: the legacy React composition, used only if the template render
  // failed in main (detailsPanelHtml absent) — so the pane is never broken.
  return (
    <div className={'bd-detail bd-view' + dropClass} {...dropHandlers}>
      <div className="bd-view__actions">
        <button
          type="button"
          className="bd-btn bd-btn--small bd-btn--primary"
          title={t('view.editTitle')}
          onClick={() => openEditor(detail.id)}
        >
          <Icon name="edit" /> Edit…
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
