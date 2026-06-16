/**
 * `@string` macro editor — a small modal listing the document's file-level
 * macros (name + value), with inline edit, remove, and an add row. Edits go
 * through the store's `edit` action (setMacro / removeMacro).
 */

import { useState } from 'react';
import { useStore } from './store.js';

export function MacroEditor({ onClose }: { onClose: () => void }) {
  const macros = useStore((s) => s.macros);
  const edit = useStore((s) => s.edit);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');

  const add = (): void => {
    const n = newName.trim();
    if (!n) return;
    void edit({ kind: 'setMacro', name: n, value: newValue });
    setNewName('');
    setNewValue('');
  };

  return (
    <div className="bd-modal-backdrop" onClick={onClose}>
      <div className="bd-modal" role="dialog" aria-label="String macros" onClick={(e) => e.stopPropagation()}>
        <div className="bd-modal__header">
          <span>@string macros</span>
          <button type="button" className="bd-field__del" title="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="bd-modal__body">
          {macros.length === 0 && <p className="bd-modal__empty">No macros defined yet.</p>}
          {macros.map((m) => (
            <div className="bd-macro" key={m.name}>
              <span className="bd-macro__name" title={m.name}>
                {m.name}
              </span>
              <input
                key={`${m.name}:${m.value}`}
                className="bd-input"
                defaultValue={m.value}
                onBlur={(e) => {
                  if (e.target.value !== m.value) {
                    void edit({ kind: 'setMacro', name: m.name, value: e.target.value });
                  }
                }}
              />
              <button
                type="button"
                className="bd-field__del"
                title={`Remove ${m.name}`}
                onClick={() => void edit({ kind: 'removeMacro', name: m.name })}
              >
                ×
              </button>
            </div>
          ))}
          <div className="bd-macro bd-macro--add">
            <input
              className="bd-input"
              placeholder="name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              className="bd-input"
              placeholder="value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add();
              }}
            />
            <button type="button" className="bd-field__add" title="Add macro" onClick={add}>
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
