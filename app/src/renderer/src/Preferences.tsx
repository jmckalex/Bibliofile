/**
 * Preferences pane — the BibDesk-equivalent options this app supports:
 * appearance (theme), the default citation style, the cite-key format, the
 * default new-entry type, and the field-type classification sets (which drive
 * how the model treats person / URL / rating / boolean / citation fields).
 */

import { useState } from 'react';
import { CITATION_STYLES, BUILTIN_COLUMNS, type Settings } from '@bibdesk/shared';
import { useStore } from './store.js';

const COLUMN_LABELS: Record<string, string> = {
  citeKey: 'Cite Key',
  type: 'Type',
  authors: 'Authors',
  title: 'Title',
  year: 'Year',
  keywords: 'Keywords',
  attachments: 'Attachments',
  read: 'Read',
  rating: 'Rating',
};

/** Column manager: reorder, remove, and add table columns (builtin or field). */
function ColumnsSection({
  columns,
  save,
}: {
  columns: readonly string[];
  save: (patch: Partial<Settings>) => Promise<void>;
}) {
  const [field, setField] = useState('');

  const set = (next: string[]): void => void save({ columns: next });
  const move = (i: number, d: -1 | 1): void => {
    const j = i + d;
    if (j < 0 || j >= columns.length) return;
    const next = [...columns];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set(next);
  };
  const remove = (key: string): void => set(columns.filter((c) => c !== key));
  const add = (key: string): void => {
    const k = key.trim();
    if (k && !columns.includes(k)) set([...columns, k]);
  };

  const availableBuiltins = BUILTIN_COLUMNS.filter((c) => !columns.includes(c));

  return (
    <section className="bd-prefs__section">
      <h3>Columns</h3>
      <ul className="bd-cols">
        {columns.map((key, i) => (
          <li className="bd-cols__row" key={key}>
            <span className="bd-cols__name">{COLUMN_LABELS[key] ?? key}</span>
            <span className="bd-cols__btns">
              <button type="button" className="bd-btn bd-btn--small" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                ↑
              </button>
              <button
                type="button"
                className="bd-btn bd-btn--small"
                disabled={i === columns.length - 1}
                onClick={() => move(i, 1)}
                title="Move down"
              >
                ↓
              </button>
              <button type="button" className="bd-field__del" onClick={() => remove(key)} title="Remove column">
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="bd-cols__add">
        {availableBuiltins.length > 0 && (
          <select
            className="bd-input bd-select"
            value=""
            onChange={(e) => {
              if (e.target.value) add(e.target.value);
            }}
          >
            <option value="">Add column…</option>
            {availableBuiltins.map((c) => (
              <option key={c} value={c}>
                {COLUMN_LABELS[c] ?? c}
              </option>
            ))}
          </select>
        )}
        <input
          className="bd-input"
          placeholder="Add a field (e.g. Journal)"
          value={field}
          onChange={(e) => setField(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              add(field);
              setField('');
            }
          }}
        />
      </div>
      <p className="bd-prefs__hint">
        Drag-reorder isn’t needed — use ↑/↓. Any BibTeX field name works as a column. The{' '}
        <strong>View → Columns</strong> menu toggles these too.
      </p>
    </section>
  );
}

const ENTRY_TYPES = [
  'article', 'book', 'inbook', 'incollection', 'inproceedings', 'conference',
  'proceedings', 'phdthesis', 'mastersthesis', 'techreport', 'manual', 'misc',
  'unpublished', 'booklet',
];

const FIELD_CATEGORIES: { key: keyof Settings['fieldTypes']; label: string }[] = [
  { key: 'person', label: 'Person fields' },
  { key: 'remoteURL', label: 'Remote URL fields' },
  { key: 'localFile', label: 'Local file fields' },
  { key: 'rating', label: 'Rating fields' },
  { key: 'boolean', label: 'Boolean fields' },
  { key: 'triState', label: 'Tri-state fields' },
  { key: 'citation', label: 'Citation fields' },
];

export function Preferences({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const save = useStore((s) => s.saveSettings);

  return (
    <div className="bd-modal-backdrop" onClick={onClose}>
      <div className="bd-modal bd-modal--wide" role="dialog" aria-label="Preferences" onClick={(e) => e.stopPropagation()}>
        <div className="bd-modal__header">
          <span>Preferences</span>
          <button type="button" className="bd-field__del" title="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="bd-modal__body bd-prefs">
          <section className="bd-prefs__section">
            <h3>Appearance</h3>
            <label className="bd-prefs__row">
              <span>Theme</span>
              <select
                className="bd-input bd-select"
                value={settings.theme}
                onChange={(e) => void save({ theme: e.target.value as Settings['theme'] })}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </section>

          <section className="bd-prefs__section">
            <h3>Citations</h3>
            <label className="bd-prefs__row">
              <span>Default style</span>
              <select
                className="bd-input bd-select"
                value={settings.defaultCiteStyle}
                onChange={(e) => void save({ defaultCiteStyle: e.target.value })}
              >
                {CITATION_STYLES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="bd-prefs__section">
            <h3>Cite keys</h3>
            <label className="bd-prefs__row">
              <span>Format</span>
              <input
                key={settings.citeKeyFormat}
                className="bd-input bd-input--mono"
                defaultValue={settings.citeKeyFormat}
                onBlur={(e) => {
                  if (e.target.value !== settings.citeKeyFormat) {
                    void save({ citeKeyFormat: e.target.value });
                  }
                }}
              />
            </label>
            <p className="bd-prefs__hint">
              BibDesk format language — e.g. <code>%a1:%Y%u2</code> = first author, year, then a
              unique suffix. Used by the <strong>Generate</strong> button.
            </p>
          </section>

          <section className="bd-prefs__section">
            <h3>Cite command (TeX)</h3>
            <label className="bd-prefs__row">
              <span>Drag / Copy cite</span>
              <input
                key={settings.citeCommandTemplate}
                className="bd-input bd-input--mono"
                defaultValue={settings.citeCommandTemplate}
                onBlur={(e) => {
                  if (e.target.value !== settings.citeCommandTemplate) {
                    void save({ citeCommandTemplate: e.target.value });
                  }
                }}
              />
            </label>
            <p className="bd-prefs__hint">
              Inserted when you drag rows to a TeX editor or run <strong>Copy \cite&#123;…&#125;</strong>.
              <code>%K</code> expands to the cite key(s) — e.g. <code>\cite&#123;%K&#125;</code> or{' '}
              <code>\citep&#123;%K&#125;</code>.
            </p>
          </section>

          <ColumnsSection columns={settings.columns} save={save} />

          <section className="bd-prefs__section">
            <h3>AutoFile</h3>
            <label className="bd-prefs__row">
              <span>Papers folder</span>
              <span className="bd-prefs__folder">
                <input className="bd-input" readOnly placeholder="(none)" value={settings.papersFolder} />
                <button
                  type="button"
                  className="bd-btn bd-btn--small"
                  onClick={async () => {
                    const res = await window.bibdesk?.chooseFolder();
                    if (res?.path) void save({ papersFolder: res.path });
                  }}
                >
                  Choose…
                </button>
                {settings.papersFolder && (
                  <button type="button" className="bd-field__del" title="Clear" onClick={() => void save({ papersFolder: '' })}>
                    ×
                  </button>
                )}
              </span>
            </label>
            <label className="bd-prefs__row">
              <span>File name</span>
              <input
                key={settings.autoFileFormat}
                className="bd-input bd-input--mono"
                defaultValue={settings.autoFileFormat}
                onBlur={(e) => {
                  if (e.target.value !== settings.autoFileFormat) void save({ autoFileFormat: e.target.value });
                }}
              />
            </label>
            <p className="bd-prefs__hint">
              <strong>Publication → AutoFile Linked Files</strong> moves an entry’s attachments into the
              Papers folder, named by this format (e.g. <code>%a1/%Y%u0</code> = first-author folder,
              year + disambiguator).
            </p>
          </section>

          <section className="bd-prefs__section">
            <h3>Saving</h3>
            <label className="bd-prefs__row">
              <span>Autosave</span>
              <input
                type="checkbox"
                checked={settings.autosave}
                onChange={(e) => void save({ autosave: e.target.checked })}
              />
            </label>
            <p className="bd-prefs__hint">
              Save automatically a moment after each edit. Undo (⌘Z) / Redo (⇧⌘Z) work regardless.
            </p>
          </section>

          <section className="bd-prefs__section">
            <h3>New entries</h3>
            <label className="bd-prefs__row">
              <span>Default type</span>
              <select
                className="bd-input bd-select"
                value={settings.defaultEntryType}
                onChange={(e) => void save({ defaultEntryType: e.target.value })}
              >
                {ENTRY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="bd-prefs__section">
            <h3>Field types</h3>
            <p className="bd-prefs__hint">
              Comma-separated field names. These control how the app treats each field — which
              are parsed as people, shown as links, rated, etc.
            </p>
            {FIELD_CATEGORIES.map(({ key, label }) => (
              <label className="bd-prefs__row" key={key}>
                <span>{label}</span>
                <input
                  key={`${key}:${settings.fieldTypes[key].join(',')}`}
                  className="bd-input"
                  defaultValue={settings.fieldTypes[key].join(', ')}
                  onBlur={(e) => {
                    const arr = e.target.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean);
                    void save({ fieldTypes: { ...settings.fieldTypes, [key]: arr } });
                  }}
                />
              </label>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
