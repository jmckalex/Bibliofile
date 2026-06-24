/**
 * Standalone annotation-editor window. Mounted by main.tsx when the window was
 * launched with an `#annotation=<documentId>::<itemId>` hash. It shows the
 * entry's pretty-printed preview card (with journal cover / book cover, like the
 * details pane) above a full-height markdown editor for the annotation.
 *
 * Typing debounce-saves the `Annote` field back to the shared main-process
 * document every ~1s (and on blur / window close); main broadcasts the change so
 * the main window's detail pane refreshes. Disk persistence follows the normal
 * Save flow (⌘S / autosave) — this writes to the entry, not directly to the file.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useStore } from './store.js';
import { CodeEditor } from './CodeEditor.js';
import { PreviewCard } from './DetailPane.js';
import { useT } from './i18n.js';

// The journal-cover web component is normally emitted as a template HTML string;
// here we mount it as JSX, so declare its intrinsic element + attributes.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'bd-journal-cover': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        'doc-id'?: string;
        'item-id'?: string;
      };
    }
  }
}

const SAVE_DEBOUNCE_MS = 1000;

export function AnnotationWindow({ documentId, itemId }: { documentId: string; itemId: string }) {
  const t = useT();
  const initEditor = useStore((s) => s.initEditor);
  const reloadAfterExternalChange = useStore((s) => s.reloadAfterExternalChange);
  const edit = useStore((s) => s.edit);
  const detail = useStore((s) => s.detail);
  const error = useStore((s) => s.error);

  // `base` is the value handed to the editor; it changes only on first load and
  // on EXTERNAL edits (never echoed from our own debounced save). `draftRef` is
  // the live text; `savedRef` is what we last persisted. Comparing the two tells
  // us whether there are unsaved local edits (so an external refresh — or our own
  // save round-trip — never clobbers text typed during the save).
  const [base, setBase] = useState<string | null>(null);
  const draftRef = useRef('');
  const savedRef = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    void initEditor(documentId, itemId);
  }, [initEditor, documentId, itemId]);

  // Refresh when another window mutates this same document.
  useEffect(() => {
    const off = window.bibdesk?.onDocumentChanged((e) => {
      if (e.documentId === documentId) void reloadAfterExternalChange();
    });
    return () => off?.();
  }, [reloadAfterExternalChange, documentId]);

  // Adopt the entry's annotation into the editor on first load, and on external
  // changes — but only when there are no unsaved local edits, so we never wipe
  // out text the user is mid-way through typing.
  useEffect(() => {
    if (!detail || detail.id !== itemId) return;
    const notes = detail.notesRaw;
    const firstLoad = base === null;
    const locallyDirty = draftRef.current !== savedRef.current;
    if (firstLoad || (!locallyDirty && notes !== draftRef.current)) {
      draftRef.current = notes;
      savedRef.current = notes;
      setBase(notes);
    }
  }, [detail, itemId, base]);

  // Keep the OS window title (title bar) on the entry's cite key.
  useEffect(() => {
    document.title =
      detail && detail.id === itemId
        ? t('annotation.windowTitle', { key: detail.citeKey })
        : t('annotation.windowTitleEmpty');
  }, [detail, itemId, t]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const v = draftRef.current;
    if (v === savedRef.current) return;
    savedRef.current = v;
    setStatus('saving');
    void edit({ kind: 'setField', itemId, field: 'Annote', value: v }).then(() =>
      setStatus('saved'),
    );
  }, [edit, itemId]);

  const scheduleSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  // Flush any pending edit when the window is torn down (close / reload).
  useEffect(() => {
    const onBeforeUnload = (): void => flush();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      flush();
    };
  }, [flush]);

  const ready = detail && detail.id === itemId && base !== null;

  return (
    <div className="bd-annowin bd-app">
      <header className="bd-annowin__bar">
        <span className="bd-annowin__title">
          {t('annotation.editing')}
          {ready ? ` · ${detail.citeKey}` : '…'}
        </span>
        <span className="bd-annowin__status" aria-live="polite">
          {status === 'saving'
            ? t('annotation.saving')
            : status === 'saved'
              ? t('annotation.saved')
              : ''}
        </span>
        <span className="bd-annowin__spacer" />
        <button
          type="button"
          className="bd-btn bd-btn--small"
          onClick={() => {
            (document.activeElement as HTMLElement | null)?.blur();
            flush();
            window.close();
          }}
        >
          {t('common.close')}
        </button>
      </header>
      {error && <div className="bd-annowin__error">{error}</div>}
      {ready ? (
        <div className="bd-annowin__body">
          <div className="bd-annowin__card bd-view">
            <bd-journal-cover doc-id={documentId} item-id={itemId} />
            {detail.previewHtml ? (
              <PreviewCard html={detail.previewHtml} files={detail.files} />
            ) : (
              <div className="bd-preview bd-preview--bare">
                <span className="bd-viewfields__mono">{detail.citeKey}</span>
              </div>
            )}
          </div>
          <div className="bd-annowin__editor">
            <CodeEditor
              language="markdown"
              value={base ?? ''}
              placeholder={t('detail.notesPlaceholder')}
              minHeight="220px"
              autoFocus
              onChange={(v) => {
                draftRef.current = v;
                setStatus('idle');
                scheduleSave();
              }}
              onBlur={flush}
            />
          </div>
        </div>
      ) : (
        <div className="bd-annowin__body">
          <p className="bd-bottompanel__hint">{t('common.loading')}</p>
        </div>
      )}
    </div>
  );
}
