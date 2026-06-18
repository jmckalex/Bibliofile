/**
 * Smart-group editor — a small condition builder (BibDesk smart groups).
 * Each row is field + comparison + value; the group matches all (AND) or any (OR)
 * of them. With no `editGroupId` it creates a new smart group (groupEdit
 * `createSmart`); with one it loads that group's current definition (store
 * `groupConditions`) and saves changes back (`editSmart`). Comparison integers
 * mirror `@bibdesk/groups` BDSKComparison (string ops).
 */

import { useEffect, useState } from 'react';
import type { SmartCondition } from '@bibdesk/shared';
import { useStore } from './store.js';
import { useT } from './i18n.js';

const COMPARISONS: { value: number; labelKey: string }[] = [
  { value: 2, labelKey: 'smart.cmp.contains' },
  { value: 3, labelKey: 'smart.cmp.notContains' },
  { value: 4, labelKey: 'smart.cmp.is' },
  { value: 5, labelKey: 'smart.cmp.isNot' },
  { value: 6, labelKey: 'smart.cmp.startsWith' },
  { value: 7, labelKey: 'smart.cmp.endsWith' },
];

const FIELDS = ['Title', 'Author', 'Journal', 'Year', 'Keywords', 'Pubtype', 'Abstract', 'Note'];

interface Row {
  key: string;
  comparison: number;
  value: string;
}

const NEW_ROW: Row = { key: 'Title', comparison: 2, value: '' };

export function SmartGroupDialog({
  onClose,
  editGroupId,
}: {
  onClose: () => void;
  editGroupId?: string;
}) {
  const t = useT();
  const groupEdit = useStore((s) => s.groupEdit);
  const groupConditions = useStore((s) => s.groupConditions);
  const selectedFolderId = useStore((s) => s.selectedFolderId);
  const editing = editGroupId !== undefined;
  const [name, setName] = useState(t('smart.defaultName'));
  const [conjunction, setConjunction] = useState<0 | 1>(0);
  const [rows, setRows] = useState<Row[]>([{ ...NEW_ROW }]);
  // While editing, hold input until the existing definition has loaded.
  const [loaded, setLoaded] = useState(!editing);

  useEffect(() => {
    if (!editGroupId) return;
    let cancelled = false;
    void groupConditions(editGroupId).then((res) => {
      if (cancelled || !res) return;
      setName(res.name || t('smart.defaultName'));
      setConjunction(res.conjunction);
      setRows(
        res.conditions.length
          ? res.conditions.map((c) => ({ key: c.key || 'Title', comparison: c.comparison, value: c.value }))
          : [{ ...NEW_ROW }],
      );
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [editGroupId, groupConditions]);

  const update = (i: number, patch: Partial<Row>): void =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = (): void => setRows((rs) => [...rs, { ...NEW_ROW }]);
  const removeRow = (i: number): void => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  const submit = async (): Promise<void> => {
    const conditions: SmartCondition[] = rows
      .filter((r) => r.key)
      .map((r) => ({ key: r.key, comparison: r.comparison, value: r.value }));
    const groupName = name.trim() || t('smart.defaultName');
    if (editGroupId) {
      await groupEdit({ kind: 'editSmart', groupId: editGroupId, name: groupName, conditions, conjunction });
    } else {
      // File the new smart group into the selected folder, if any (captured
      // before createSmart, which clears the folder selection).
      const parent = selectedFolderId;
      const id = await groupEdit({ kind: 'createSmart', name: groupName, conditions, conjunction });
      if (id && parent) await groupEdit({ kind: 'setGroupFolder', groupId: id, folderId: parent });
    }
    onClose();
  };

  const title = editing ? t('smart.editTitle') : t('smart.newTitle');
  return (
    <div className="bd-modal-backdrop" onClick={onClose}>
      <div className="bd-modal bd-modal--wide" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="bd-modal__header">
          <span>{title}</span>
          <button type="button" className="bd-field__del" title={t('common.close')} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="bd-modal__body">
          <div className="bd-fr__row">
            <span className="bd-fr__label">{t('common.name')}</span>
            <input className="bd-input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="bd-fr__row">
            <span className="bd-fr__label">{t('smart.match')}</span>
            <select className="bd-input bd-select" value={conjunction} onChange={(e) => setConjunction(Number(e.target.value) as 0 | 1)}>
              <option value={0}>{t('smart.matchAll')}</option>
              <option value={1}>{t('smart.matchAny')}</option>
            </select>
          </div>

          {rows.map((r, i) => (
            <div className="bd-cond" key={i}>
              <select className="bd-input bd-select" value={r.key} onChange={(e) => update(i, { key: e.target.value })}>
                {/* Allow an unknown stored field to round-trip even if not in the preset list. */}
                {(FIELDS.includes(r.key) ? FIELDS : [r.key, ...FIELDS]).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <select className="bd-input bd-select" value={r.comparison} onChange={(e) => update(i, { comparison: Number(e.target.value) })}>
                {COMPARISONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {t(c.labelKey)}
                  </option>
                ))}
              </select>
              <input className="bd-input" placeholder={t('smart.valuePlaceholder')} value={r.value} onChange={(e) => update(i, { value: e.target.value })} />
              <button type="button" className="bd-field__del" title={t('smart.removeCondition')} onClick={() => removeRow(i)}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="bd-btn bd-btn--small" onClick={addRow}>
            {t('smart.addCondition')}
          </button>
        </div>
        <div className="bd-modal__footer">
          <button type="button" className="bd-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="bd-btn bd-btn--primary" disabled={!loaded} onClick={() => void submit()}>
            {editing ? t('common.save') : t('common.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
