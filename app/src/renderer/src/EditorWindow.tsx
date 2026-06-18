/**
 * Standalone editor window (BibDesk-style). Mounted by main.tsx when the window
 * was launched with a `#editor=<documentId>::<itemId>` hash. It drives this
 * window's own store via {@link initEditor} (no table/sidebar) and renders the
 * full edit UI ({@link DetailPane}) for the one item. Edits mutate the shared
 * main-process document; main broadcasts the change so the main window refreshes.
 * Save is done from the main window (⌘S / File → Save).
 */

import { useEffect } from 'react';

import { useStore } from './store.js';
import { DetailPane } from './DetailPane.js';
import { useT } from './i18n.js';

export function EditorWindow({ documentId, itemId }: { documentId: string; itemId: string }) {
  const t = useT();
  const initEditor = useStore((s) => s.initEditor);
  const reloadAfterExternalChange = useStore((s) => s.reloadAfterExternalChange);
  const loadEntryTypes = useStore((s) => s.loadEntryTypes);
  const detail = useStore((s) => s.detail);
  const error = useStore((s) => s.error);

  useEffect(() => {
    void initEditor(documentId, itemId);
    // This window runs its own store; load the type list so the type picker
    // (DetailPane → Identity) includes custom entry types.
    void loadEntryTypes();
  }, [initEditor, loadEntryTypes, documentId, itemId]);

  // If the main window mutates this item (rename author, find/replace, …), refresh
  // — but only for this editor's own document, not some other open library.
  useEffect(() => {
    const off = window.bibdesk?.onDocumentChanged((e) => {
      if (e.documentId === documentId) void reloadAfterExternalChange();
    });
    return () => off?.();
  }, [reloadAfterExternalChange, documentId]);

  // Keep the OS window title on the entry being edited.
  useEffect(() => {
    document.title = detail
      ? t('editor.docTitle', { key: detail.citeKey })
      : t('editor.docTitleEmpty');
  }, [detail, t]);

  return (
    <div className="bd-editorwin bd-app">
      <header className="bd-editorwin__bar">
        <span className="bd-editorwin__title">
          {t('editor.editing')}
          {detail ? ` · ${detail.citeKey}` : '…'}
        </span>
        <span className="bd-editorwin__spacer" />
        <button type="button" className="bd-btn bd-btn--small" onClick={() => window.close()}>
          {t('common.close')}
        </button>
      </header>
      {error && <div className="bd-editorwin__error">{error}</div>}
      <div className="bd-editorwin__body">
        <DetailPane />
      </div>
    </div>
  );
}
