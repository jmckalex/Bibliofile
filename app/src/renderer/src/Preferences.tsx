/**
 * Preferences pane — the BibDesk-equivalent options this app supports:
 * appearance (theme), the default citation style, the cite-key format, the
 * default new-entry type, and the field-type classification sets (which drive
 * how the model treats person / URL / rating / boolean / citation fields).
 */

import { CITATION_STYLES, type Settings } from '@bibdesk/shared';
import { useStore } from './store.js';

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
