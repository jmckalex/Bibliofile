/**
 * Batch-operations bar — a floating contextual bar shown when 2+ rows are
 * selected (Cmd/Shift-click in the table). Applies one operation to the whole
 * selection in a single undo step via the store's batchEdit: set a field, or
 * add / remove a keyword. (Deleting a selection is done with the Delete key or
 * the row context menu, not here.)
 *
 * It floats a small offset above the window's bottom edge, horizontally centred
 * over the bottom panel (the middle content column) when that column is the
 * relevant target — i.e. when the bottom panel is open — and over the whole
 * window otherwise.
 */

import { useLayoutEffect, useState } from 'react';
import { useStore } from './store.js';
import { useT } from './i18n.js';
import { Icon } from './icons.js';

export function BatchBar() {
  const t = useT();
  const selectedIds = useStore((s) => s.selectedIds);
  const batchEdit = useStore((s) => s.batchEdit);
  const bottomPanelVisible = useStore((s) => s.settings.layout.bottomPanelVisible);
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  const [keyword, setKeyword] = useState('');
  const [centerX, setCenterX] = useState<number | null>(null);

  const n = selectedIds.length;
  const visible = n >= 2;

  // When the bottom panel is open, centre the bar over the middle content column
  // (which is exactly where the bottom panel sits) rather than the whole window.
  // A ResizeObserver keeps it in sync as the side pane / sidebar / window resize.
  useLayoutEffect(() => {
    if (!visible || !bottomPanelVisible) {
      setCenterX(null);
      return;
    }
    const el = document.querySelector<HTMLElement>('.bd-center');
    if (!el) {
      setCenterX(null);
      return;
    }
    const measure = (): void => {
      const r = el.getBoundingClientRect();
      setCenterX(r.left + r.width / 2);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
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
      // Inline `left` overrides the CSS `left: 50%` (window centre) when we've
      // measured the content column; the `translateX(-50%)` recentres on it.
      style={centerX != null ? { left: centerX } : undefined}
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
