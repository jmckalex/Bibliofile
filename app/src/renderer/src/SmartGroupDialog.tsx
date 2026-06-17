/**
 * Smart-group creation dialog — a small condition builder (BibDesk smart groups).
 * Each row is field + comparison + value; the group matches all (AND) or any (OR)
 * of them. Persists via the store's groupEdit (createSmart) and selects the new
 * group. Comparison integers mirror `@bibdesk/groups` BDSKComparison (string ops).
 */

import { useState } from 'react';
import type { SmartCondition } from '@bibdesk/shared';
import { useStore } from './store.js';

const COMPARISONS: { value: number; label: string }[] = [
  { value: 2, label: 'contains' },
  { value: 3, label: 'does not contain' },
  { value: 4, label: 'is' },
  { value: 5, label: 'is not' },
  { value: 6, label: 'starts with' },
  { value: 7, label: 'ends with' },
];

const FIELDS = ['Title', 'Author', 'Journal', 'Year', 'Keywords', 'Pubtype', 'Abstract', 'Note'];

interface Row {
  key: string;
  comparison: number;
  value: string;
}

export function SmartGroupDialog({ onClose }: { onClose: () => void }) {
  const groupEdit = useStore((s) => s.groupEdit);
  const [name, setName] = useState('Smart Group');
  const [conjunction, setConjunction] = useState<0 | 1>(0);
  const [rows, setRows] = useState<Row[]>([{ key: 'Title', comparison: 2, value: '' }]);

  const update = (i: number, patch: Partial<Row>): void =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = (): void => setRows((rs) => [...rs, { key: 'Title', comparison: 2, value: '' }]);
  const removeRow = (i: number): void => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  const create = async (): Promise<void> => {
    const conditions: SmartCondition[] = rows
      .filter((r) => r.key)
      .map((r) => ({ key: r.key, comparison: r.comparison, value: r.value }));
    await groupEdit({ kind: 'createSmart', name: name.trim() || 'Smart Group', conditions, conjunction });
    onClose();
  };

  return (
    <div className="bd-modal-backdrop" onClick={onClose}>
      <div className="bd-modal bd-modal--wide" role="dialog" aria-label="New smart group" onClick={(e) => e.stopPropagation()}>
        <div className="bd-modal__header">
          <span>New Smart Group</span>
          <button type="button" className="bd-field__del" title="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="bd-modal__body">
          <div className="bd-fr__row">
            <span className="bd-fr__label">Name</span>
            <input className="bd-input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="bd-fr__row">
            <span className="bd-fr__label">Match</span>
            <select className="bd-input bd-select" value={conjunction} onChange={(e) => setConjunction(Number(e.target.value) as 0 | 1)}>
              <option value={0}>all of the following (AND)</option>
              <option value={1}>any of the following (OR)</option>
            </select>
          </div>

          {rows.map((r, i) => (
            <div className="bd-cond" key={i}>
              <select className="bd-input bd-select" value={r.key} onChange={(e) => update(i, { key: e.target.value })}>
                {FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <select className="bd-input bd-select" value={r.comparison} onChange={(e) => update(i, { comparison: Number(e.target.value) })}>
                {COMPARISONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input className="bd-input" placeholder="value" value={r.value} onChange={(e) => update(i, { value: e.target.value })} />
              <button type="button" className="bd-field__del" title="Remove condition" onClick={() => removeRow(i)}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="bd-btn bd-btn--small" onClick={addRow}>
            ＋ Condition
          </button>
        </div>
        <div className="bd-modal__footer">
          <button type="button" className="bd-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="bd-btn bd-btn--primary" onClick={() => void create()}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
