/**
 * Preferences pane — the BibDesk-equivalent options this app supports:
 * appearance (theme), the default citation style, the cite-key format, the
 * default new-entry type, and the field-type classification sets (which drive
 * how the model treats person / URL / rating / boolean / citation fields).
 */

import { useState } from 'react';
import { BUILTIN_COLUMNS, LOCALES, defaultPanelBody, type Settings, type EntryTypeInfo, type ExportTemplate, type PanelTemplate, type PanelWhich } from '@bibdesk/shared';
import { useT } from './i18n.js';
import { CodeEditor } from './CodeEditor.js';
import { Icon, type IconName } from './icons.js';
import { useStore } from './store.js';
import { PANEL_PRESETS } from './panel-presets.js';

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
  const t = useT();
  const [field, setField] = useState('');
  // Builtin columns get a translated label (column.*); a raw BibTeX field name
  // (e.g. "Journal") is shown verbatim.
  const colLabel = (k: string): string => (k in COLUMN_LABELS ? t(`column.${k}`) : k);

  const set = (next: string[]): void => void save({ columns: next });
  const remove = (key: string): void => set(columns.filter((c) => c !== key));
  const add = (key: string): void => {
    const k = key.trim();
    if (k && !columns.includes(k)) set([...columns, k]);
  };

  const availableBuiltins = BUILTIN_COLUMNS.filter((c) => !columns.includes(c));

  return (
    <section className="bd-prefs__section">
      <h3>{t('prefs.columns')}</h3>
      <ul className="bd-cols">
        {columns.map((key) => (
          <li className="bd-cols__row" key={key}>
            <span className="bd-cols__name">{colLabel(key)}</span>
            <span className="bd-cols__btns">
              <button type="button" className="bd-field__del" onClick={() => remove(key)} title={t('prefs.removeColumn')}>
                <Icon name="close" />
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
            <option value="">{t('prefs.addColumn')}</option>
            {availableBuiltins.map((c) => (
              <option key={c} value={c}>
                {colLabel(c)}
              </option>
            ))}
          </select>
        )}
        <input
          className="bd-input"
          placeholder={t('prefs.addFieldColumn')}
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

const FIELD_CATEGORIES: { key: keyof Settings['fieldTypes']; labelKey: string }[] = [
  { key: 'person', labelKey: 'prefs.fieldType.person' },
  { key: 'remoteURL', labelKey: 'prefs.fieldType.remoteURL' },
  { key: 'localFile', labelKey: 'prefs.fieldType.localFile' },
  { key: 'rating', labelKey: 'prefs.fieldType.rating' },
  { key: 'boolean', labelKey: 'prefs.fieldType.boolean' },
  { key: 'triState', labelKey: 'prefs.fieldType.triState' },
  { key: 'citation', labelKey: 'prefs.fieldType.citation' },
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
  const t = useT();
  const [newType, setNewType] = useState('');
  const standardNames = new Set(entryTypes.filter((et) => et.standard).map((et) => et.name.toLowerCase()));
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

  const standardTypes = entryTypes.filter((et) => et.standard);

  return (
    <section className="bd-prefs__section">
      <h3>{t('prefs.entryTypes')}</h3>
      <p className="bd-prefs__hint">
        Define your own BibTeX entry types and the fields the editor offers for them. Required and
        optional fields are comma-separated; the <strong>order you type them</strong> is the order
        shown. The 15 standard types are built in (listed below for reference).
      </p>
      {customNames.length === 0 && <p className="bd-prefs__hint">{t('prefs.noCustomTypes')}</p>}
      {customNames.map((name) => {
        const ct = customTypes[name]!;
        return (
          <div className="bd-ctype" key={name}>
            <div className="bd-ctype__head">
              <input
                className="bd-input bd-input--mono"
                key={`name:${name}`}
                defaultValue={name}
                aria-label={t('prefs.typeName')}
                onBlur={(e) => renameType(name, e.target.value)}
              />
              <button type="button" className="bd-field__del" title={t('prefs.deleteType')} onClick={() => removeType(name)}>
                <Icon name="close" />
              </button>
            </div>
            <label className="bd-prefs__row">
              <span>{t('prefs.required')}</span>
              <input
                className="bd-input"
                key={`req:${name}:${ct.required.join(',')}`}
                defaultValue={ct.required.join(', ')}
                onBlur={(e) => setFields(name, 'required', e.target.value)}
              />
            </label>
            <label className="bd-prefs__row">
              <span>{t('prefs.optional')}</span>
              <input
                className="bd-input"
                key={`opt:${name}:${ct.optional.join(',')}`}
                defaultValue={ct.optional.join(', ')}
                onBlur={(e) => setFields(name, 'optional', e.target.value)}
              />
            </label>
          </div>
        );
      })}
      <div className="bd-cols__add">
        <input
          className="bd-input"
          placeholder={t('prefs.newTypePlaceholder')}
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
          title={t('prefs.addEntryType')}
          aria-label={t('prefs.addEntryType')}
          onClick={() => {
            addType(newType);
            setNewType('');
          }}
        >
          <Icon name="plus" />
        </button>
      </div>
      <details className="bd-ctype__std">
        <summary>{t('prefs.standardTypes')}</summary>
        <ul className="bd-ctype__stdlist">
          {standardTypes.map((et) => (
            <li key={et.name}>
              <strong>{et.name}</strong>
              <div>
                <em>{t('prefs.requiredLabel')}</em> {et.required.join(', ') || '—'}
              </div>
              <div>
                <em>{t('prefs.optionalLabel')}</em> {et.optional.join(', ') || '—'}
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
  const t = useT();
  const [body, setBody] = useState(template.body);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // How to show the preview: raw text, or interpreted as HTML (sandboxed iframe).
  // Default to HTML for html-extension templates.
  const [mode, setMode] = useState<'text' | 'html'>(template.extension === 'html' ? 'html' : 'text');

  const runPreview = async (): Promise<void> => {
    if (!documentId) {
      setError(t('prefs.openLibraryToPreview'));
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
          aria-label={t('prefs.templateName')}
          onBlur={(e) => onChange({ name: e.target.value.trim() || template.name })}
        />
        <input
          className="bd-input bd-tmpl__ext"
          defaultValue={template.extension}
          aria-label={t('prefs.fileExtension')}
          title={t('prefs.outputExtTitle')}
          onBlur={(e) => onChange({ extension: e.target.value.replace(/^\./, '').trim() || 'txt' })}
        />
        <button type="button" className="bd-field__del" title={t('prefs.deleteTemplate')} onClick={onRemove}>
          <Icon name="close" />
        </button>
      </div>
      <CodeEditor
        language="html"
        value={body}
        minHeight="140px"
        onChange={setBody}
        onBlur={() => {
          if (body !== template.body) onChange({ body });
        }}
      />
      <div className="bd-tmpl__actions">
        <button type="button" className="bd-btn bd-btn--small" onClick={() => void runPreview()}>
          {t('prefs.preview')}
        </button>
        {preview !== null && !error && (
          <div className="bd-tmpl__view" role="group" aria-label={t('prefs.previewMode')}>
            <button
              type="button"
              className={'bd-seg' + (mode === 'text' ? ' bd-seg--on' : '')}
              aria-pressed={mode === 'text'}
              onClick={() => setMode('text')}
            >
              {t('prefs.text')}
            </button>
            <button
              type="button"
              className={'bd-seg' + (mode === 'html' ? ' bd-seg--on' : '')}
              aria-pressed={mode === 'html'}
              onClick={() => setMode('html')}
            >
              {t('prefs.html')}
            </button>
          </div>
        )}
      </div>
      {error && <pre className="bd-tmpl__preview bd-tmpl__preview--err">{error}</pre>}
      {preview !== null && !error && (
        <>
          {mode === 'text' ? (
            <pre className="bd-tmpl__preview">{preview || t('prefs.empty')}</pre>
          ) : (
            <iframe
              className="bd-tmpl__preview bd-tmpl__preview--html"
              title={t('prefs.htmlPreview')}
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
  const t = useT();
  const setAll = (next: ExportTemplate[]): void => void save({ exportTemplates: next });
  const update = (i: number, patch: Partial<ExportTemplate>): void => {
    if (patch.name !== undefined && templates.some((tpl, j) => j !== i && tpl.name === patch.name)) return;
    setAll(templates.map((tpl, j) => (j === i ? { ...tpl, ...patch } : tpl)));
  };
  const remove = (i: number): void => setAll(templates.filter((_, j) => j !== i));
  const add = (): void => {
    const taken = new Set(templates.map((tpl) => tpl.name));
    let name = 'Template';
    for (let n = 2; taken.has(name); n++) name = `Template ${n}`;
    setAll([...templates, { name, extension: 'html', body: STARTER_TEMPLATE }]);
  };

  return (
    <section className="bd-prefs__section">
      <h3>{t('prefs.exportTemplates')}</h3>
      <p className="bd-prefs__hint">
        Author your own export formats with Handlebars; each appears under{' '}
        <strong>File → Export</strong>. Per-entry context: <code>citeKey</code>, <code>type</code>,{' '}
        <code>fields.&lt;Name&gt;</code>, <code>authors</code>/<code>authorsText</code>, and{' '}
        <code>title year venue volume pages doi</code>; <code>{'{{field "name"}}'}</code> looks up a
        field case-insensitively. Loop with <code>{'{{#each entries}}'}</code>.
      </p>
      {templates.length === 0 && <p className="bd-prefs__hint">{t('prefs.noTemplates')}</p>}
      {templates.map((tpl, i) => (
        <TemplateRow
          key={tpl.name}
          template={tpl}
          documentId={documentId}
          onChange={(patch) => update(i, patch)}
          onRemove={() => remove(i)}
        />
      ))}
      <div className="bd-cols__add">
        <button
          type="button"
          className="bd-circbtn bd-circbtn--add"
          title={t('prefs.addExportTemplate')}
          aria-label={t('prefs.addExportTemplate')}
          onClick={add}
        >
          <Icon name="plus" />
        </button>
      </div>
    </section>
  );
}

/** One fork editor (label + body + live preview + delete) for a panel template. */
function PanelForkRow({
  fork,
  which,
  documentId,
  onChange,
  onRemove,
}: {
  fork: PanelTemplate;
  which: PanelWhich;
  documentId: string | undefined;
  onChange: (patch: Partial<PanelTemplate>) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const [body, setBody] = useState(fork.body);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'text' | 'html'>('html');

  const runPreview = async (): Promise<void> => {
    if (!documentId) {
      setError(t('prefs.openLibraryToPreview'));
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
        <input
          className="bd-input"
          defaultValue={fork.name}
          aria-label={t('prefs.templateName')}
          onBlur={(e) => onChange({ name: e.target.value.trim() || fork.name })}
        />
        <button type="button" className="bd-field__del" title={t('prefs.deleteTemplate')} onClick={onRemove}>
          <Icon name="close" />
        </button>
      </div>
      <CodeEditor
        language="html"
        value={body}
        minHeight="140px"
        onChange={setBody}
        onBlur={() => {
          if (body !== fork.body) onChange({ body });
        }}
      />
      <div className="bd-tmpl__actions">
        <button type="button" className="bd-btn bd-btn--small" onClick={() => void runPreview()}>
          {t('prefs.preview')}
        </button>
        {preview !== null && !error && (
          <div className="bd-tmpl__view" role="group" aria-label={t('prefs.previewMode')}>
            <button
              type="button"
              className={'bd-seg' + (mode === 'text' ? ' bd-seg--on' : '')}
              onClick={() => setMode('text')}
            >
              {t('prefs.text')}
            </button>
            <button
              type="button"
              className={'bd-seg' + (mode === 'html' ? ' bd-seg--on' : '')}
              onClick={() => setMode('html')}
            >
              {t('prefs.html')}
            </button>
          </div>
        )}
      </div>
      {error && <pre className="bd-tmpl__preview bd-tmpl__preview--err">{error}</pre>}
      {preview !== null &&
        !error &&
        (mode === 'text' ? (
          <pre className="bd-tmpl__preview">{preview || t('prefs.empty')}</pre>
        ) : (
          <iframe className="bd-tmpl__preview bd-tmpl__preview--html" title={t('prefs.panelPreview')} sandbox="" srcDoc={preview} />
        ))}
    </div>
  );
}

/**
 * Manage the named forks of ONE panel (detail pane or bottom panel): pick which
 * one is active (or the built-in default), add a fork from the default or a
 * preset, and rename / edit / delete each. A new fork becomes active immediately
 * so the user sees it in the live panel.
 */
function PanelForkManager({
  which,
  label,
  forks,
  active,
  activeField,
  forksField,
  documentId,
  save,
}: {
  which: PanelWhich;
  label: string;
  forks: readonly PanelTemplate[];
  active: string | undefined;
  activeField: 'activeDetailsFork' | 'activeBottomFork';
  forksField: 'detailsForks' | 'bottomForks';
  documentId: string | undefined;
  save: (patch: Partial<Settings>) => Promise<void>;
}) {
  const t = useT();
  const presets = PANEL_PRESETS.filter((p) => p.for === which || p.for === 'both');
  const apply = (patch: Record<string, unknown>): void => void save(patch as Partial<Settings>);

  const uniqueName = (base: string): string => {
    const taken = new Set(forks.map((f) => f.name));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base} ${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  };

  const update = (i: number, patch: Partial<PanelTemplate>): void => {
    // Reject a rename that collides with another fork (the input keeps its old value).
    if (patch.name !== undefined && forks.some((f, j) => j !== i && f.name === patch.name)) return;
    const prevName = forks[i]!.name;
    const next = forks.map((f, j) => (j === i ? { ...f, ...patch } : f));
    // Keep the active pointer in sync when the active fork is renamed.
    const renamedActive = patch.name !== undefined && active === prevName;
    apply(renamedActive ? { [forksField]: next, [activeField]: patch.name } : { [forksField]: next });
  };

  const remove = (i: number): void => {
    const removed = forks[i]!.name;
    const next = forks.filter((_, j) => j !== i);
    // Deleting the active fork falls back to the built-in default.
    apply(active === removed ? { [forksField]: next, [activeField]: undefined } : { [forksField]: next });
  };

  const addFork = (base: string, body: string): void => {
    const name = uniqueName(base);
    apply({ [forksField]: [...forks, { name, body }], [activeField]: name });
  };

  // An empty value resets the panel to the built-in default; a stale active name
  // (its fork was deleted) also shows as the default.
  const activeValue = active && forks.some((f) => f.name === active) ? active : '';

  return (
    <div className="bd-panelfork">
      <div className="bd-ctype__head">
        <strong>{label}</strong>
        <span className="bd-toolbar__spacer" />
        <span className="bd-panelfork__activelabel">{t('prefs.activeTemplate')}</span>
        <select
          className="bd-input bd-select"
          value={activeValue}
          aria-label={t('prefs.activeTemplate')}
          onChange={(e) => apply({ [activeField]: e.target.value || undefined })}
        >
          <option value="">{t('prefs.builtinDefault')}</option>
          {forks.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      {forks.length === 0 && <p className="bd-prefs__hint">{t('prefs.noForks')}</p>}
      {forks.map((f, i) => (
        <PanelForkRow
          key={f.name}
          fork={f}
          which={which}
          documentId={documentId}
          onChange={(patch) => update(i, patch)}
          onRemove={() => remove(i)}
        />
      ))}
      <div className="bd-panelfork__add">
        <button
          type="button"
          className="bd-btn bd-btn--small"
          title={t('prefs.forkDefaultTitle')}
          onClick={() => addFork(t('prefs.forkBaseName'), defaultPanelBody(which))}
        >
          {t('prefs.forkDefault')}
        </button>
        {presets.length > 0 && (
          <select
            className="bd-input bd-select"
            defaultValue=""
            aria-label={t('prefs.newForkFromPreset')}
            title={t('prefs.loadPresetTitle')}
            onChange={(e) => {
              const p = presets.find((x) => x.name === e.target.value);
              if (p) addFork(p.name, p.body);
              e.currentTarget.value = '';
            }}
          >
            <option value="">{t('prefs.newForkFromPreset')}</option>
            {presets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

/** Fork, label, edit, and switch the detail-pane and bottom-panel templates. */
function PanelsSection({
  settings,
  documentId,
  save,
}: {
  settings: Settings;
  documentId: string | undefined;
  save: (patch: Partial<Settings>) => Promise<void>;
}) {
  const t = useT();
  return (
    <section className="bd-prefs__section">
      <h3>{t('prefs.panels')}</h3>
      <p className="bd-prefs__hint">
        Fork the right detail pane and the bottom panel to customize them with Handlebars, then pick
        which fork is active (or keep the built-in default). Per-item context: <code>citeKey</code>,{' '}
        <code>type</code>, <code>fields</code> (<code>name</code>/<code>value</code>/
        <code>isInherited</code>), <code>{'{{{notesHtml}}}'}</code>, <code>attachments</code> /{' '}
        <code>links</code> (<code>displayName</code>/<code>url</code>), <code>{'{{{previewHtml}}}'}</code>.
        Live widgets: <code>{'<bd-journal-cover>'}</code>, <code>{'<bd-citation>'}</code> (these don’t
        render in the sandboxed HTML preview, but do in the live panel).
      </p>
      <PanelForkManager
        which="details"
        label={t('prefs.detailPane')}
        forks={settings.detailsForks}
        active={settings.activeDetailsFork}
        activeField="activeDetailsFork"
        forksField="detailsForks"
        documentId={documentId}
        save={save}
      />
      <PanelForkManager
        which="bottom"
        label={t('prefs.bottomPanel')}
        forks={settings.bottomForks}
        active={settings.activeBottomFork}
        activeField="activeBottomFork"
        forksField="bottomForks"
        documentId={documentId}
        save={save}
      />
    </section>
  );
}

type PrefSection =
  | 'general'
  | 'display'
  | 'citation'
  | 'citeKeys'
  | 'files'
  | 'fields'
  | 'templates'
  | 'panels'
  | 'assistant';

/** Left-rail sections (icon + label), BibDesk-style. Reuse already-translated
 *  keys where one fits; the section-only labels live under `prefs.section.*`
 *  (English source, fall back to English in other locales until seeded). */
const PREF_SECTIONS: { id: PrefSection; icon: IconName; labelKey: string }[] = [
  { id: 'general', icon: 'prefGeneral', labelKey: 'prefs.section.general' },
  { id: 'display', icon: 'prefDisplay', labelKey: 'prefs.section.display' },
  { id: 'citation', icon: 'prefCitation', labelKey: 'prefs.citations' },
  { id: 'citeKeys', icon: 'prefCiteKeys', labelKey: 'prefs.citeKeys' },
  { id: 'files', icon: 'prefFiles', labelKey: 'prefs.section.files' },
  { id: 'fields', icon: 'prefFields', labelKey: 'prefs.section.fields' },
  { id: 'templates', icon: 'prefTemplates', labelKey: 'prefs.section.templates' },
  { id: 'panels', icon: 'prefPanels', labelKey: 'prefs.panels' },
  { id: 'assistant', icon: 'prefAssistant', labelKey: 'prefs.assistant' },
];

export function Preferences({ onClose }: { onClose: () => void }) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const documentId = useStore((s) => s.documentId);
  const entryTypes = useStore((s) => s.entryTypes);
  const citationStyles = useStore((s) => s.citationStyles);
  const installCitationStyle = useStore((s) => s.installCitationStyle);
  const removeCitationStyle = useStore((s) => s.removeCitationStyle);
  const save = useStore((s) => s.saveSettings);
  const [section, setSection] = useState<PrefSection>('general');

  return (
    <div className="bd-modal-backdrop" onClick={onClose}>
      <div className="bd-modal bd-modal--prefs" role="dialog" aria-label={t('prefs.title')} onClick={(e) => e.stopPropagation()}>
        <div className="bd-modal__header">
          <span>{t('prefs.title')}</span>
          <button type="button" className="bd-field__del" title={t('common.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="bd-prefs">
          <nav className="bd-prefs__nav" aria-label={t('prefs.title')}>
            {PREF_SECTIONS.map((sec) => (
              <button
                key={sec.id}
                type="button"
                className={'bd-prefs__navitem' + (section === sec.id ? ' bd-prefs__navitem--on' : '')}
                aria-current={section === sec.id ? 'page' : undefined}
                onClick={() => setSection(sec.id)}
              >
                <span className="bd-prefs__navicon">
                  <Icon name={sec.icon} />
                </span>
                <span className="bd-prefs__navlabel">{t(sec.labelKey)}</span>
              </button>
            ))}
          </nav>

          <div className="bd-prefs__content">
            {section === 'general' && (
              <>
                <section className="bd-prefs__section">
                  <h3>{t('prefs.appearance')}</h3>
                  <label className="bd-prefs__row">
                    <span>{t('prefs.language')}</span>
                    <select
                      className="bd-input bd-select"
                      value={settings.locale}
                      onChange={(e) => void save({ locale: e.target.value })}
                    >
                      <option value="system">{t('prefs.language.system')}</option>
                      {LOCALES.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="bd-prefs__hint">{t('prefs.language.hint')}</p>
                  <label className="bd-prefs__row">
                    <span>{t('prefs.theme')}</span>
                    <select
                      className="bd-input bd-select"
                      value={settings.theme}
                      onChange={(e) => void save({ theme: e.target.value as Settings['theme'] })}
                    >
                      <option value="system">{t('prefs.theme.system')}</option>
                      <option value="light">{t('prefs.theme.light')}</option>
                      <option value="dark">{t('prefs.theme.dark')}</option>
                    </select>
                  </label>
                </section>
                <section className="bd-prefs__section">
                  <h3>{t('prefs.saving')}</h3>
                  <label className="bd-prefs__row">
                    <span>{t('prefs.autosave')}</span>
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
              </>
            )}

            {section === 'display' && <ColumnsSection columns={settings.columns} save={save} />}

            {section === 'citation' && (
              <>
                <section className="bd-prefs__section">
                  <h3>{t('prefs.citations')}</h3>
                  <label className="bd-prefs__row">
                    <span>{t('prefs.defaultStyle')}</span>
                    <select
                      className="bd-input bd-select"
                      value={settings.defaultCiteStyle}
                      onChange={(e) => void save({ defaultCiteStyle: e.target.value })}
                    >
                      {citationStyles.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                          {s.custom ? ' ★' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="bd-prefs__row">
                    <span />
                    <span className="bd-prefs__btnrow">
                      <button
                        type="button"
                        className="bd-btn bd-btn--small"
                        onClick={() => void installCitationStyle()}
                      >
                        {t('prefs.installStyle')}
                      </button>
                      {citationStyles.find((s) => s.id === settings.defaultCiteStyle)?.custom && (
                        <button
                          type="button"
                          className="bd-btn bd-btn--small bd-btn--danger"
                          onClick={() => void removeCitationStyle(settings.defaultCiteStyle)}
                        >
                          {t('prefs.removeStyle')}
                        </button>
                      )}
                    </span>
                  </div>
                  <p className="bd-prefs__hint">{t('prefs.installStyleHint')}</p>
                </section>
                <section className="bd-prefs__section">
                  <h3>{t('prefs.citeCommand')}</h3>
                  <label className="bd-prefs__row">
                    <span>{t('prefs.dragCopyCite')}</span>
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
                <section className="bd-prefs__section">
                  <h3>{t('prefs.texPreview')}</h3>
                  <label className="bd-prefs__row">
                    <span>{t('prefs.texBibStyle')}</span>
                    <input
                      key={settings.texBibStyle}
                      className="bd-input bd-input--mono"
                      defaultValue={settings.texBibStyle}
                      placeholder="plain"
                      onBlur={(e) => {
                        if (e.target.value !== settings.texBibStyle) {
                          void save({ texBibStyle: e.target.value.trim() || 'plain' });
                        }
                      }}
                    />
                  </label>
                  <label className="bd-prefs__row">
                    <span>{t('prefs.texBinDir')}</span>
                    <input
                      key={settings.texBinDir}
                      className="bd-input bd-input--mono"
                      defaultValue={settings.texBinDir}
                      placeholder="/Library/TeX/texbin"
                      onBlur={(e) => {
                        if (e.target.value !== settings.texBinDir) void save({ texBinDir: e.target.value.trim() });
                      }}
                    />
                  </label>
                  <p className="bd-prefs__hint">{t('prefs.texPreviewHint')}</p>
                </section>
              </>
            )}

            {section === 'citeKeys' && (
              <section className="bd-prefs__section">
                <h3>{t('prefs.citeKeys')}</h3>
                <label className="bd-prefs__row">
                  <span>{t('prefs.format')}</span>
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
                <p className="bd-prefs__hint">
                  <strong>Author-count recipe</strong> (the default):{' '}
                  <code>%p[/][/etal1]2:%Y%u0</code> → <code>Surname:Year</code> for one author,{' '}
                  <code>Surname1/Surname2:Year</code> for two, <code>Surname1/etal:Year</code> for
                  three or more; <code>%u0</code> adds a disambiguating letter (<code>a</code>,{' '}
                  <code>b</code>, …) only on a clash. <code>%p</code> uses editors when an entry has
                  no author (e.g. edited books); use <code>%a</code> instead for authors only.
                </p>
              </section>
            )}

            {section === 'files' && (
              <>
                <section className="bd-prefs__section">
                  <h3>{t('prefs.autofile')}</h3>
                  <label className="bd-prefs__row">
                    <span>{t('prefs.papersFolder')}</span>
                    <span className="bd-prefs__folder">
                      <input className="bd-input" readOnly placeholder={t('prefs.folderNone')} value={settings.papersFolder} />
                      <button
                        type="button"
                        className="bd-btn bd-btn--small"
                        onClick={async () => {
                          const res = await window.bibdesk?.chooseFolder();
                          if (res?.path) void save({ papersFolder: res.path });
                        }}
                      >
                        {t('prefs.choose')}
                      </button>
                      {settings.papersFolder && (
                        <button type="button" className="bd-field__del" title={t('prefs.clear')} onClick={() => void save({ papersFolder: '' })}>
                          <Icon name="close" />
                        </button>
                      )}
                    </span>
                  </label>
                  <label className="bd-prefs__row">
                    <span>{t('prefs.fileName')}</span>
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
                    Papers folder, named by this format (default <code>%p1/%T5</code> = a folder per first
                    author or editor, then the title’s first words; the extension is added automatically).
                  </p>
                </section>
                <section className="bd-prefs__section">
                  <h3>{t('prefs.annotationStorage')}</h3>
                  <label className="bd-prefs__row">
                    <span>{t('prefs.writeNotesAs')}</span>
                    <select
                      className="bd-input bd-select"
                      value={settings.annotationStorage}
                      onChange={(e) => void save({ annotationStorage: e.target.value as Settings['annotationStorage'] })}
                    >
                      <option value="compressed">{t('prefs.annotation.compressed')}</option>
                      <option value="readable">{t('prefs.annotation.readable')}</option>
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
              </>
            )}

            {section === 'fields' && (
              <>
                <section className="bd-prefs__section">
                  <h3>{t('prefs.newEntries')}</h3>
                  <label className="bd-prefs__row">
                    <span>{t('prefs.defaultType')}</span>
                    <select
                      className="bd-input bd-select"
                      value={settings.defaultEntryType}
                      onChange={(e) => void save({ defaultEntryType: e.target.value })}
                    >
                      {(entryTypes.length ? entryTypes.map((et) => et.name) : ENTRY_TYPES).map((ty) => (
                        <option key={ty} value={ty}>
                          {ty}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
                <EntryTypesSection customTypes={settings.customTypes} entryTypes={entryTypes} save={save} />
                <section className="bd-prefs__section">
                  <h3>{t('prefs.fieldTypes')}</h3>
                  <p className="bd-prefs__hint">
                    Comma-separated field names. These control how the app treats each field — which
                    are parsed as people, shown as links, rated, etc.
                  </p>
                  {FIELD_CATEGORIES.map(({ key, labelKey }) => (
                    <label className="bd-prefs__row" key={key}>
                      <span>{t(labelKey)}</span>
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
              </>
            )}

            {section === 'templates' && (
              <TemplatesSection templates={settings.exportTemplates} documentId={documentId} save={save} />
            )}

            {section === 'panels' && <PanelsSection settings={settings} documentId={documentId} save={save} />}

            {section === 'assistant' && (
              <section className="bd-prefs__section">
                <h3>{t('prefs.assistant')}</h3>
                <label className="bd-prefs__row">
                  <span>{t('prefs.model')}</span>
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
