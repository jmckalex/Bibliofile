/**
 * Preferences pane — the BibDesk-equivalent options this app supports:
 * appearance (theme), the default citation style, the cite-key format, the
 * default new-entry type, and the field-type classification sets (which drive
 * how the model treats person / URL / rating / boolean / citation fields).
 */

import { useState } from 'react';
import { CITATION_STYLES, BUILTIN_COLUMNS, type Settings, type EntryTypeInfo, type ExportTemplate } from '@bibdesk/shared';
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

/** Column manager: show/hide and add table columns. Reordering + resizing now
 * happen directly on the table header (drag a header to reorder, drag its right
 * edge to resize). */
function ColumnsSection({
  columns,
  save,
}: {
  columns: readonly string[];
  save: (patch: Partial<Settings>) => Promise<void>;
}) {
  const [field, setField] = useState('');

  const set = (next: string[]): void => void save({ columns: next });
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
        {columns.map((key) => (
          <li className="bd-cols__row" key={key}>
            <span className="bd-cols__name">{COLUMN_LABELS[key] ?? key}</span>
            <span className="bd-cols__btns">
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
        <strong>Reorder</strong> columns by dragging a header; <strong>resize</strong> by dragging a
        header’s right edge. Any BibTeX field name works as a column, and the{' '}
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

/**
 * Define custom BibTeX entry types + their required/optional field lists (the
 * order you type the comma-separated fields is the order the editor shows). The
 * 15 standard types are protected and listed read-only for reference.
 */
function EntryTypesSection({
  customTypes,
  entryTypes,
  save,
}: {
  customTypes: Settings['customTypes'];
  entryTypes: readonly EntryTypeInfo[];
  save: (patch: Partial<Settings>) => Promise<void>;
}) {
  const [newType, setNewType] = useState('');
  const standardNames = new Set(entryTypes.filter((t) => t.standard).map((t) => t.name.toLowerCase()));
  const customNames = Object.keys(customTypes);
  const taken = (lower: string): boolean =>
    standardNames.has(lower) || customNames.some((n) => n.toLowerCase() === lower);

  const setMap = (next: Record<string, { required: string[]; optional: string[] }>): void =>
    void save({ customTypes: next });
  const cloneMap = (): Record<string, { required: string[]; optional: string[] }> =>
    Object.fromEntries(
      Object.entries(customTypes).map(([k, v]) => [k, { required: [...v.required], optional: [...v.optional] }]),
    );

  const addType = (raw: string): void => {
    const name = raw.trim();
    if (!name || taken(name.toLowerCase())) return;
    const next = cloneMap();
    next[name] = { required: [], optional: [] };
    setMap(next);
  };
  const removeType = (name: string): void => {
    const next = cloneMap();
    delete next[name];
    setMap(next);
  };
  const renameType = (oldName: string, raw: string): void => {
    const name = raw.trim();
    if (!name || name === oldName || taken(name.toLowerCase())) return;
    const next: Record<string, { required: string[]; optional: string[] }> = {};
    for (const [k, v] of Object.entries(customTypes)) {
      next[k === oldName ? name : k] = { required: [...v.required], optional: [...v.optional] };
    }
    setMap(next);
  };
  const setFields = (name: string, kind: 'required' | 'optional', csv: string): void => {
    const next = cloneMap();
    if (!next[name]) return;
    next[name][kind] = csv.split(',').map((x) => x.trim()).filter(Boolean);
    setMap(next);
  };

  const standardTypes = entryTypes.filter((t) => t.standard);

  return (
    <section className="bd-prefs__section">
      <h3>Entry types</h3>
      <p className="bd-prefs__hint">
        Define your own BibTeX entry types and the fields the editor offers for them. Required and
        optional fields are comma-separated; the <strong>order you type them</strong> is the order
        shown. The 15 standard types are built in (listed below for reference).
      </p>
      {customNames.length === 0 && <p className="bd-prefs__hint">No custom types yet.</p>}
      {customNames.map((name) => {
        const t = customTypes[name]!;
        return (
          <div className="bd-ctype" key={name}>
            <div className="bd-ctype__head">
              <input
                className="bd-input bd-input--mono"
                key={`name:${name}`}
                defaultValue={name}
                aria-label="Type name"
                onBlur={(e) => renameType(name, e.target.value)}
              />
              <button type="button" className="bd-field__del" title="Delete type" onClick={() => removeType(name)}>
                ×
              </button>
            </div>
            <label className="bd-prefs__row">
              <span>Required</span>
              <input
                className="bd-input"
                key={`req:${name}:${t.required.join(',')}`}
                defaultValue={t.required.join(', ')}
                onBlur={(e) => setFields(name, 'required', e.target.value)}
              />
            </label>
            <label className="bd-prefs__row">
              <span>Optional</span>
              <input
                className="bd-input"
                key={`opt:${name}:${t.optional.join(',')}`}
                defaultValue={t.optional.join(', ')}
                onBlur={(e) => setFields(name, 'optional', e.target.value)}
              />
            </label>
          </div>
        );
      })}
      <div className="bd-cols__add">
        <input
          className="bd-input"
          placeholder="New type name (e.g. dataset)"
          value={newType}
          onChange={(e) => setNewType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              addType(newType);
              setNewType('');
            }
          }}
        />
        <button
          type="button"
          className="bd-circbtn bd-circbtn--add"
          title="Add entry type"
          aria-label="Add entry type"
          onClick={() => {
            addType(newType);
            setNewType('');
          }}
        >
          +
        </button>
      </div>
      <details className="bd-ctype__std">
        <summary>Standard types (read-only)</summary>
        <ul className="bd-ctype__stdlist">
          {standardTypes.map((t) => (
            <li key={t.name}>
              <strong>{t.name}</strong>
              <div>
                <em>required:</em> {t.required.join(', ') || '—'}
              </div>
              <div>
                <em>optional:</em> {t.optional.join(', ') || '—'}
              </div>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

const STARTER_TEMPLATE = `{{#each entries}}
{{authorsText}} ({{year}}). {{title}}. {{venue}}. [{{citeKey}}]
{{/each}}
`;

/** One editable export template + a live preview against the open library. */
function TemplateRow({
  template,
  documentId,
  onChange,
  onRemove,
}: {
  template: ExportTemplate;
  documentId: string | undefined;
  onChange: (patch: Partial<ExportTemplate>) => void;
  onRemove: () => void;
}) {
  const [body, setBody] = useState(template.body);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // How to show the preview: raw text, or interpreted as HTML (sandboxed iframe).
  // Default to HTML for html-extension templates.
  const [mode, setMode] = useState<'text' | 'html'>(template.extension === 'html' ? 'html' : 'text');

  const runPreview = async (): Promise<void> => {
    if (!documentId) {
      setError('Open a library to preview.');
      setPreview(null);
      return;
    }
    const res = await window.bibdesk?.previewTemplate({ documentId, body });
    if (!res) return;
    if (res.error) {
      setError(res.error);
      setPreview(null);
    } else {
      setPreview(res.text ?? '');
      setError(null);
    }
  };

  return (
    <div className="bd-ctype">
      <div className="bd-ctype__head">
        <input
          className="bd-input"
          defaultValue={template.name}
          aria-label="Template name"
          onBlur={(e) => onChange({ name: e.target.value.trim() || template.name })}
        />
        <input
          className="bd-input bd-tmpl__ext"
          defaultValue={template.extension}
          aria-label="File extension"
          title="Output file extension"
          onBlur={(e) => onChange({ extension: e.target.value.replace(/^\./, '').trim() || 'txt' })}
        />
        <button type="button" className="bd-field__del" title="Delete template" onClick={onRemove}>
          ×
        </button>
      </div>
      <textarea
        className="bd-input bd-input--area bd-tmpl__body"
        value={body}
        rows={6}
        spellCheck={false}
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => {
          if (body !== template.body) onChange({ body });
        }}
      />
      <div className="bd-tmpl__actions">
        <button type="button" className="bd-btn bd-btn--small" onClick={() => void runPreview()}>
          Preview
        </button>
        {preview !== null && !error && (
          <div className="bd-tmpl__view" role="group" aria-label="Preview mode">
            <button
              type="button"
              className={'bd-seg' + (mode === 'text' ? ' bd-seg--on' : '')}
              aria-pressed={mode === 'text'}
              onClick={() => setMode('text')}
            >
              Text
            </button>
            <button
              type="button"
              className={'bd-seg' + (mode === 'html' ? ' bd-seg--on' : '')}
              aria-pressed={mode === 'html'}
              onClick={() => setMode('html')}
            >
              HTML
            </button>
          </div>
        )}
      </div>
      {error && <pre className="bd-tmpl__preview bd-tmpl__preview--err">{error}</pre>}
      {preview !== null && !error && (
        <>
          {mode === 'text' ? (
            <pre className="bd-tmpl__preview">{preview || '(empty)'}</pre>
          ) : (
            <iframe
              className="bd-tmpl__preview bd-tmpl__preview--html"
              title="HTML preview"
              sandbox=""
              srcDoc={preview}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Author named Handlebars export templates; each appears under File → Export. */
function TemplatesSection({
  templates,
  documentId,
  save,
}: {
  templates: readonly ExportTemplate[];
  documentId: string | undefined;
  save: (patch: Partial<Settings>) => Promise<void>;
}) {
  const setAll = (next: ExportTemplate[]): void => void save({ exportTemplates: next });
  const update = (i: number, patch: Partial<ExportTemplate>): void => {
    if (patch.name !== undefined && templates.some((t, j) => j !== i && t.name === patch.name)) return;
    setAll(templates.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  };
  const remove = (i: number): void => setAll(templates.filter((_, j) => j !== i));
  const add = (): void => {
    const taken = new Set(templates.map((t) => t.name));
    let name = 'Template';
    for (let n = 2; taken.has(name); n++) name = `Template ${n}`;
    setAll([...templates, { name, extension: 'html', body: STARTER_TEMPLATE }]);
  };

  return (
    <section className="bd-prefs__section">
      <h3>Export templates</h3>
      <p className="bd-prefs__hint">
        Author your own export formats with Handlebars; each appears under{' '}
        <strong>File → Export</strong>. Per-entry context: <code>citeKey</code>, <code>type</code>,{' '}
        <code>fields.&lt;Name&gt;</code>, <code>authors</code>/<code>authorsText</code>, and{' '}
        <code>title year venue volume pages doi</code>; <code>{'{{field "name"}}'}</code> looks up a
        field case-insensitively. Loop with <code>{'{{#each entries}}'}</code>.
      </p>
      {templates.length === 0 && <p className="bd-prefs__hint">No templates yet.</p>}
      {templates.map((t, i) => (
        <TemplateRow
          key={t.name}
          template={t}
          documentId={documentId}
          onChange={(patch) => update(i, patch)}
          onRemove={() => remove(i)}
        />
      ))}
      <div className="bd-cols__add">
        <button
          type="button"
          className="bd-circbtn bd-circbtn--add"
          title="Add export template"
          aria-label="Add export template"
          onClick={add}
        >
          +
        </button>
      </div>
    </section>
  );
}

/** One panel-template editor (detail or bottom) with a live preview. */
function PanelTemplateEditor({
  which,
  label,
  field,
  value,
  documentId,
  save,
}: {
  which: 'details' | 'bottom';
  label: string;
  field: 'detailsTemplate' | 'bottomPanelTemplate';
  value: string;
  documentId: string | undefined;
  save: (patch: Partial<Settings>) => Promise<void>;
}) {
  const [body, setBody] = useState(value);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'text' | 'html'>('html');

  const runPreview = async (): Promise<void> => {
    if (!documentId) {
      setError('Open a library to preview.');
      setPreview(null);
      return;
    }
    const res = await window.bibdesk?.previewPanel({ documentId, which, body });
    if (!res) return;
    if (res.error) {
      setError(res.error);
      setPreview(null);
    } else {
      setPreview(res.html ?? '');
      setError(null);
    }
  };

  return (
    <div className="bd-ctype">
      <div className="bd-ctype__head">
        <strong>{label}</strong>
        <span className="bd-toolbar__spacer" />
        <button
          type="button"
          className="bd-btn bd-btn--small"
          title="Reset to the built-in default"
          onClick={() => {
            setBody('');
            void save({ [field]: undefined } as Partial<Settings>);
          }}
        >
          Reset
        </button>
      </div>
      <textarea
        className="bd-input bd-input--area bd-tmpl__body"
        value={body}
        rows={6}
        spellCheck={false}
        placeholder="Leave empty to use the built-in default."
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => {
          if (body !== value) void save({ [field]: body } as Partial<Settings>);
        }}
      />
      <div className="bd-tmpl__actions">
        <button type="button" className="bd-btn bd-btn--small" onClick={() => void runPreview()}>
          Preview
        </button>
        {preview !== null && !error && (
          <div className="bd-tmpl__view" role="group" aria-label="Preview mode">
            <button
              type="button"
              className={'bd-seg' + (mode === 'text' ? ' bd-seg--on' : '')}
              onClick={() => setMode('text')}
            >
              Text
            </button>
            <button
              type="button"
              className={'bd-seg' + (mode === 'html' ? ' bd-seg--on' : '')}
              onClick={() => setMode('html')}
            >
              HTML
            </button>
          </div>
        )}
      </div>
      {error && <pre className="bd-tmpl__preview bd-tmpl__preview--err">{error}</pre>}
      {preview !== null &&
        !error &&
        (mode === 'text' ? (
          <pre className="bd-tmpl__preview">{preview || '(empty)'}</pre>
        ) : (
          <iframe className="bd-tmpl__preview bd-tmpl__preview--html" title="Panel preview" sandbox="" srcDoc={preview} />
        ))}
    </div>
  );
}

/** Edit the (optional) detail-pane and bottom-panel Handlebars templates. */
function PanelsSection({
  settings,
  documentId,
  save,
}: {
  settings: Settings;
  documentId: string | undefined;
  save: (patch: Partial<Settings>) => Promise<void>;
}) {
  return (
    <section className="bd-prefs__section">
      <h3>Panels</h3>
      <p className="bd-prefs__hint">
        Customize the right detail pane and the bottom panel with Handlebars. Per-item context:{' '}
        <code>citeKey</code>, <code>type</code>, <code>fields</code> (<code>name</code>/<code>value</code>/
        <code>isInherited</code>), <code>{'{{{notesHtml}}}'}</code>, <code>attachments</code> /{' '}
        <code>links</code> (<code>displayName</code>/<code>url</code>), <code>{'{{{previewHtml}}}'}</code>.
        Live widgets: <code>{'<bd-journal-cover>'}</code>, <code>{'<bd-citation>'}</code> (these don’t
        render in the sandboxed HTML preview, but do in the live panel). Leave empty for the default.
      </p>
      <PanelTemplateEditor
        which="details"
        label="Detail pane"
        field="detailsTemplate"
        value={settings.detailsTemplate ?? ''}
        documentId={documentId}
        save={save}
      />
      <PanelTemplateEditor
        which="bottom"
        label="Bottom panel"
        field="bottomPanelTemplate"
        value={settings.bottomPanelTemplate ?? ''}
        documentId={documentId}
        save={save}
      />
    </section>
  );
}

export function Preferences({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const documentId = useStore((s) => s.documentId);
  const entryTypes = useStore((s) => s.entryTypes);
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
            <h3>Annotation storage</h3>
            <label className="bd-prefs__row">
              <span>Write notes as</span>
              <select
                className="bd-input bd-select"
                value={settings.annotationStorage}
                onChange={(e) => void save({ annotationStorage: e.target.value as Settings['annotationStorage'] })}
              >
                <option value="compressed">Compressed (safe, compact)</option>
                <option value="readable">Readable (portable)</option>
              </select>
            </label>
            <p className="bd-prefs__hint">
              <strong>Compressed</strong> stores markdown annotations lz-string-compressed in a
              private <code>Bdsk-Annotation</code> field — brace-safe and small, but opaque to other
              tools. <strong>Readable</strong> keeps them in the standard <code>Annote</code> field
              (only <code>% {'{'} {'}'}</code> escaped) — portable and human-readable, but the
              flakier path. Existing entries convert on next edit; either form always reads back.
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
            <h3>Claude Assistant</h3>
            <label className="bd-prefs__row">
              <span>Model</span>
              <input
                key={settings.agentModel}
                className="bd-input bd-input--mono"
                defaultValue={settings.agentModel}
                onBlur={(e) => {
                  if (e.target.value !== settings.agentModel) void save({ agentModel: e.target.value });
                }}
              />
            </label>
            <p className="bd-prefs__hint">
              The assistant (Tools → Claude Assistant, ⌘J) uses your Anthropic API key, stored
              encrypted on this device. It reads the library freely and asks before any change.
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
                {(entryTypes.length ? entryTypes.map((t) => t.name) : ENTRY_TYPES).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <EntryTypesSection customTypes={settings.customTypes} entryTypes={entryTypes} save={save} />

          <TemplatesSection templates={settings.exportTemplates} documentId={documentId} save={save} />

          <PanelsSection settings={settings} documentId={documentId} save={save} />

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
