/**
 * Script Console — write JavaScript that runs against the open library via the
 * `bibliofile` API (the cross-platform successor to AppleScript). The editor is
 * the shared CodeMirror component in 'javascript' mode; Run sends the code to the
 * main-process scripting host (script-host.ts) and shows console output, the
 * return value, and any error (with its source line). One run = one undo step.
 */
import { useState } from 'react';

import { useStore } from './store.js';
import { CodeEditor } from './CodeEditor.js';
import { Icon } from './icons.js';
import { useT } from './i18n.js';

const STARTER = `// Automate your library with JavaScript. The 'bibliofile' API is global.
const doc = bibliofile.activeDocument;
console.log(doc.count() + ' entries');

// e.g. uppercase every keyword set (one Undo reverts the whole run):
// for (const e of doc.entries()) e.setField('Keywords', e.field('Keywords').toUpperCase());

return doc.entries().slice(0, 5).map((e) => e.citeKey);
`;

interface RunState {
  output: readonly string[];
  result?: string;
  error?: string;
  errorLine?: number;
}

export function ScriptConsole({ onClose }: { onClose: () => void }) {
  const t = useT();
  const documentId = useStore((s) => s.documentId);
  const [code, setCode] = useState(STARTER);
  const [run, setRun] = useState<RunState | null>(null);
  const [running, setRunning] = useState(false);

  const execute = async (): Promise<void> => {
    if (!documentId || running) return;
    setRunning(true);
    try {
      const res = await window.bibdesk!.runScript({ documentId, code });
      setRun({ output: res.output, result: res.result, error: res.error, errorLine: res.errorLine });
    } catch (err) {
      setRun({ output: [], error: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bd-modal-backdrop" onClick={onClose}>
      <div
        className="bd-modal bd-modal--wide bd-modal--script"
        role="dialog"
        aria-label={t('scripting.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bd-modal__header">
          <span>{t('scripting.title')}</span>
          <button type="button" className="bd-field__del" title={t('common.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <p className="bd-script__hint">{t('scripting.hint')}</p>
        <div
          className="bd-script__editor"
          onKeyDownCapture={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void execute();
            }
          }}
        >
          <CodeEditor language="javascript" value={code} onChange={setCode} minHeight="220px" />
        </div>
        <div className="bd-script__actions">
          <span className="bd-script__runhint">{t('scripting.runHint')}</span>
          <span className="bd-toolbar__spacer" />
          <button type="button" className="bd-btn bd-btn--primary" disabled={!documentId || running} onClick={() => void execute()}>
            {running ? t('scripting.running') : t('scripting.run')}
          </button>
        </div>
        <div className="bd-script__output" role="log" aria-label={t('scripting.output')}>
          {run === null ? (
            <p className="bd-script__empty">{t('scripting.outputEmpty')}</p>
          ) : (
            <>
              {run.output.map((line, i) => (
                <pre className="bd-script__line" key={i}>
                  {line}
                </pre>
              ))}
              {run.result !== undefined && (
                <pre className="bd-script__line bd-script__line--result">⇒ {run.result}</pre>
              )}
              {run.error && (
                <pre className="bd-script__line bd-script__line--err">
                  {run.errorLine != null ? t('scripting.errorAt', { line: run.errorLine, error: run.error }) : run.error}
                </pre>
              )}
              {run.output.length === 0 && run.result === undefined && !run.error && (
                <p className="bd-script__empty">{t('scripting.ranNoOutput')}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
