/**
 * Batch-operations bar — a floating contextual bar shown when 2+ rows are
 * selected (Cmd/Shift-click in the table). Applies one operation to the whole
 * selection in a single undo step via the store's batchEdit: set a field, or
 * add / remove a keyword. (Deleting a selection is done with the Delete key or
 * the row context menu, not here.)
 *
 * When the bottom panel is open, the bar floats just *above* the panel's top
 * edge, horizontally centred over it (the middle content column). When the panel
 * is closed, it sits a small offset above the window's bottom edge, centred over
 * the window (the CSS defaults).
 */

import { useLayoutEffect, useState } from 'react';
import { useStore } from './store.js';
import { useT } from './i18n.js';
import { Icon } from './icons.js';

/** Gap between the bar's bottom edge and the bottom panel's top edge (clears the splitter). */
const PANEL_GAP_PX = 12;

export function BatchBar() {
  const t = useT();
  const selectedIds = useStore((s) => s.selectedIds);
  const batchEdit = useStore((s) => s.batchEdit);
  const bottomPanelVisible = useStore((s) => s.settings.layout.bottomPanelVisible);
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  const [keyword, setKeyword] = useState('');
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);

  const n = selectedIds.length;
  const visible = n >= 2;

  // When the bottom panel is open, lift the bar above it: horizontally centred
  // over the middle content column, vertically just above the panel's top edge.
  // A ResizeObserver keeps it in sync as the side pane / sidebar / panel / window
  // resize. When closed, `pos` is null and the CSS defaults apply.
  useLayoutEffect(() => {
    const center = document.querySelector<HTMLElement>('.bd-center');
    const panel = document.querySelector<HTMLElement>('.bd-bottom');
    if (!visible || !bottomPanelVisible || !center || !panel) {
      setPos(null);
      return;
    }
    const measure = (): void => {
      const c = center.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      setPos({ left: c.left + c.width / 2, bottom: window.innerHeight - p.top + PANEL_GAP_PX });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(center);
    ro.observe(panel);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [visible, bottomPanelVisible]);

  if (!visible) return null;

  const applySet = (): void => {
    if (!field.trim()) return;
    void batchEdit({ kind: 'setField', field: field.trim(), value });
    setField('');
    setValue('');
  };
  const applyKeyword = (kind: 'addKeyword' | 'removeKeyword'): void => {
    if (!keyword.trim()) return;
    void batchEdit({ kind, keyword: keyword.trim() });
    setKeyword('');
  };

  return (
    <div
      className="bd-batch"
      role="toolbar"
      aria-label={t('batch.actions')}
      // Inline left/bottom override the CSS defaults (window centre, 16px above
      // the window's bottom) to lift the bar above the open bottom panel; the
      // CSS `translateX(-50%)` still recentres it on `left`.
      style={pos ? { left: pos.left, bottom: pos.bottom } : undefined}
    >
      <span className="bd-batch__count">{t('common.itemsSelected', { count: n })}</span>

      <span className="bd-batch__group">
        <input
          className="bd-input bd-input--small"
          placeholder={t('batch.field')}
          value={field}
          onChange={(e) => setField(e.target.value)}
        />
        <input
          className="bd-input bd-input--small"
          placeholder={t('batch.value')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applySet();
          }}
        />
        <button type="button" className="bd-btn bd-btn--small" disabled={!field.trim()} onClick={applySet}>
          {t('batch.set')}
        </button>
      </span>

      <span className="bd-batch__group">
        <input
          className="bd-input bd-input--small"
          placeholder={t('batch.keyword')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyKeyword('addKeyword');
          }}
        />
        <button type="button" className="bd-btn bd-btn--small" disabled={!keyword.trim()} onClick={() => applyKeyword('addKeyword')}>
          <Icon name="plus" /> {t('batch.addKeyword')}
        </button>
        <button type="button" className="bd-btn bd-btn--small" disabled={!keyword.trim()} onClick={() => applyKeyword('removeKeyword')}>
          <Icon name="removeMinus" /> {t('batch.removeKeyword')}
        </button>
      </span>
    </div>
  );
}
