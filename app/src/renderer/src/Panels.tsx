/**
 * Resizable / hidable layout panels (Phase 1 of the configurable-panels work):
 * a drag splitter, the swappable right pane (Details ↔ Claude), and the
 * bottom-panel shell (made a template-driven annotation reader in a later phase).
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from './store.js';
import { ViewPane } from './ViewPane.js';
import { Assistant } from './Assistant.js';
import { TexPreviewPane } from './TexPreviewPane.js';
import { hydratePanel } from './panel-hydrate.js';
import { useT } from './i18n.js';
import { Icon } from './icons.js';

/** A drag handle between two panels. `onDrag` receives the incremental px delta. */
export function Splitter({
  orientation,
  onDrag,
  onCommit,
  label,
}: {
  orientation: 'vertical' | 'horizontal';
  onDrag: (deltaPx: number) => void;
  onCommit: () => void;
  label: string;
}) {
  const last = useRef(0);
  const onPointerDown = (e: ReactPointerEvent): void => {
    e.preventDefault();
    last.current = orientation === 'vertical' ? e.clientX : e.clientY;
    const move = (ev: PointerEvent): void => {
      const pos = orientation === 'vertical' ? ev.clientX : ev.clientY;
      onDrag(pos - last.current);
      last.current = pos;
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('bd-resizing');
      onCommit();
    };
    document.body.classList.add('bd-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      className={`bd-splitter bd-splitter--${orientation}`}
      role="separator"
      aria-label={label}
      onPointerDown={onPointerDown}
    />
  );
}

/**
 * A small dropdown that swaps what a pane shows. Used in both pane headers so the
 * user can switch content (which they do somewhat frequently) without the menu.
 * Values are constrained by the caller's `options`, so the `onChange` cast is safe.
 */
function PaneSwitch({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [value: string, label: string]>;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="bd-paneswitch"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
    >
      {options.map(([v, lbl]) => (
        <option key={v} value={v}>
          {lbl}
        </option>
      ))}
    </select>
  );
}

/** The right pane: a Details ↔ Claude content dropdown + a hide button, then the body. */
export function RightPane() {
  const t = useT();
  const content = useStore((s) => s.settings.layout.rightPaneContent);
  const setLayout = useStore((s) => s.setLayout);
  return (
    <section className="bd-pane bd-pane--detail bd-rightpane">
      <div className="bd-rightpane__tabs">
        <PaneSwitch
          label={t('panel.content')}
          value={content}
          options={[
            ['details', t('panel.details')],
            ['assistant', t('panel.claude')],
          ]}
          onChange={(v) => setLayout({ rightPaneContent: v as 'details' | 'assistant' })}
        />
        <span className="bd-toolbar__spacer" />
        <button
          type="button"
          className="bd-field__del"
          title={t('panel.hide')}
          aria-label={t('panel.hide')}
          onClick={() => setLayout({ rightPaneVisible: false })}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="bd-rightpane__body">
        {content === 'assistant' ? (
          <Assistant onClose={() => setLayout({ rightPaneContent: 'details' })} />
        ) : (
          <ViewPane />
        )}
      </div>
    </section>
  );
}

/**
 * The annotation reader: the current entry's annotation, full-width. Renders
 * main-built HTML (a Handlebars template) and hydrates it like the detail pane.
 */
function AnnotationBody() {
  const t = useT();
  const detail = useStore((s) => s.detail);
  const selectedItemId = useStore((s) => s.selectedItemId);
  const hostRef = useRef<HTMLDivElement>(null);
  const html = detail && detail.id === selectedItemId ? detail.bottomPanelHtml : undefined;

  useEffect(() => {
    const el = hostRef.current;
    if (!el || !html) return;
    return hydratePanel(el);
  }, [html]);

  return html ? (
    <div className="bd-bottompanel__body" ref={hostRef} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <div className="bd-bottompanel__body">
      <p className="bd-bottompanel__hint">{selectedItemId ? '' : t('panel.selectAnnotation')}</p>
    </div>
  );
}

/**
 * Bottom panel — a configurable, selection-driven reader whose content the user
 * picks from the header dropdown (or the View ▸ Bottom Panel menu): the entry
 * annotation (default) or the LaTeX preview.
 */
export function BottomPanel() {
  const t = useT();
  const setLayout = useStore((s) => s.setLayout);
  const content = useStore((s) => s.settings.layout.bottomPaneContent) ?? 'annotation';

  return (
    <div className="bd-bottompanel">
      <div className="bd-bottompanel__bar">
        <PaneSwitch
          label={t('panel.content')}
          value={content}
          options={[
            ['annotation', t('panel.annotation')],
            ['texPreview', t('panel.texPreview')],
          ]}
          onChange={(v) => setLayout({ bottomPaneContent: v as 'annotation' | 'texPreview' })}
        />
        <span className="bd-toolbar__spacer" />
        <button
          type="button"
          className="bd-field__del"
          title={t('panel.hideBottom')}
          aria-label={t('panel.hideBottom')}
          onClick={() => setLayout({ bottomPanelVisible: false })}
        >
          <Icon name="close" />
        </button>
      </div>
      {content === 'texPreview' ? <TexPreviewPane /> : <AnnotationBody />}
    </div>
  );
}
