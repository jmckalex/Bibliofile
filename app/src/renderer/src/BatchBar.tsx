/**
 * Batch-operations bar — a floating contextual bar shown when 2+ rows are
 * selected (Cmd/Shift-click in the table). Applies one operation to the whole
 * selection in a single undo step via the store's batchEdit: set a field, add /
 * remove a keyword, or delete.
 */

import { useState } from 'react';
import { useStore } from './store.js';
import { useT } from './i18n.js';
import { Icon } from './icons.js';

export function BatchBar() {
  const t = useT();
  const selectedIds = useStore((s) => s.selectedIds);
  const batchEdit = useStore((s) => s.batchEdit);
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  const [keyword, setKeyword] = useState('');

  const n = selectedIds.length;
  if (n < 2) return null;

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
    <div className="bd-batch" role="toolbar" aria-label={t('batch.actions')}>
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

      <button
        type="button"
        className="bd-btn bd-btn--small bd-btn--danger"
        onClick={() => void batchEdit({ kind: 'delete' })}
      >
        <Icon name="trash" /> {t('batch.delete', { count: n })}
      </button>
    </div>
  );
}
