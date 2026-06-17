/**
 * Detail / preview / EDIT pane. Shows the selected item's preview card (trusted
 * HTML from main, with MathJax), then an editable form: cite key + type + fields
 * (inherited fields are muted + badged; editing one creates a local override),
 * an add-field row, and the attachments list.
 *
 * Field inputs are uncontrolled and keyed by `${itemId}:${name}` so switching
 * items remounts them (correct values) while in-place edits — which reload the
 * detail for the SAME item — reuse the node and preserve focus.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CITATION_STYLES, type ItemDetail, type ItemField, type ItemFile } from '@bibdesk/shared';
import { useStore } from './store.js';
import { typesetMath } from './mathjax.js';
import { PdfViewer } from './PdfViewer.js';

const isPdf = (f: ItemFile): boolean => f.kind === 'file' && /\.pdf$/i.test(f.url);

/** Common BibTeX entry types offered in the type picker. */
const ENTRY_TYPES = [
  'article', 'book', 'inbook', 'incollection', 'inproceedings', 'conference',
  'proceedings', 'phdthesis', 'mastersthesis', 'techreport', 'manual', 'misc',
  'unpublished', 'booklet',
];

function fileIcon(kind: ItemFile['kind']): string {
  return kind === 'url' ? '🔗' : '📄';
}

function openExternal(target: string, kind: 'url' | 'file'): void {
  void window.bibdesk?.openExternal({ target, kind });
}

function PreviewCard({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && html.includes('$')) void typesetMath(ref.current);
  }, [html]);
  const onClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-open-url]');
    if (el?.dataset.openUrl) {
      e.preventDefault();
      openExternal(el.dataset.openUrl, 'url');
    }
  }, []);
  return (
    <div className="bd-preview" ref={ref} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

/** Map a raw tri-state field value to the select's UI value ('' | '0' | '2'). */
function triStateUi(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (/^(2|yes|on)$/.test(s)) return '2';
  if (/^(0|no|off)$/.test(s)) return '0';
  return '';
}

/** A 0–5 clickable star rating. Clicking the current value clears it. */
function RatingStars({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const n = Math.max(0, Math.min(5, parseInt(value, 10) || 0));
  return (
    <span className="bd-rating" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          type="button"
          key={i}
          className={'bd-rating__star' + (i <= n ? ' bd-rating__star--on' : '')}
          aria-label={`${i} star${i === 1 ? '' : 's'}`}
          aria-checked={i === n}
          onClick={() => onChange(i === n ? '' : String(i))}
        >
          {i <= n ? '★' : '☆'}
        </button>
      ))}
    </span>
  );
}

/** One editable field row (uncontrolled; commits on blur / Enter). */
function FieldRow({ itemId, field }: { itemId: string; field: ItemField }) {
  const edit = useStore((s) => s.edit);
  const fieldSuggestions = useStore((s) => s.fieldSuggestions);
  const long = field.name.toLowerCase() === 'abstract' || field.rawValue.length > 60;
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  const listId = `dl-${itemId}-${field.name}`;

  const commit = (value: string): void => {
    if (value !== field.rawValue) {
      void edit({ kind: 'setField', itemId, field: field.name, value });
    }
  };

  // Fetch existing values for this field on first focus (autocomplete).
  const loadSuggestions = (): void => {
    if (suggestions.length === 0) void fieldSuggestions(field.name).then(setSuggestions);
  };

  return (
    <div className={'bd-field' + (field.isInherited ? ' bd-field--inherited' : '')} style={{ display: 'contents' }}>
      <div className="bd-field__name">
        {field.name}
        {field.isInherited && <span className="bd-field__badge">(inherited)</span>}
      </div>
      <div className="bd-field__edit">
        {field.kind === 'rating' ? (
          <RatingStars value={field.rawValue} onChange={commit} />
        ) : field.kind === 'boolean' ? (
          <input
            type="checkbox"
            className="bd-field__check"
            checked={/^(yes|true|1|on)$/i.test(field.rawValue.trim())}
            onChange={(e) => commit(e.target.checked ? 'Yes' : '')}
          />
        ) : field.kind === 'triState' ? (
          <select
            className="bd-input bd-select"
            value={triStateUi(field.rawValue)}
            onChange={(e) => commit(e.target.value)}
          >
            <option value="">—</option>
            <option value="0">No</option>
            <option value="2">Yes</option>
          </select>
        ) : long ? (
          <textarea
            key={`${itemId}:${field.name}`}
            className="bd-input bd-input--area"
            defaultValue={field.rawValue}
            rows={3}
            onBlur={(e) => commit(e.target.value)}
          />
        ) : (
          <input
            key={`${itemId}:${field.name}`}
            className="bd-input"
            list={listId}
            defaultValue={field.rawValue}
            onFocus={loadSuggestions}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        )}
        {suggestions.length > 0 && (
          <datalist id={listId}>
            {suggestions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        )}
        {!field.isInherited && (
          <button
            type="button"
            className="bd-field__del"
            title={`Remove ${field.name}`}
            onClick={() => void edit({ kind: 'removeField', itemId, field: field.name })}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/** Row for adding a brand-new field (name + value). */
function AddFieldRow({ itemId }: { itemId: string }) {
  const edit = useStore((s) => s.edit);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const add = (): void => {
    const n = name.trim();
    if (!n) return;
    void edit({ kind: 'setField', itemId, field: n, value });
    setName('');
    setValue('');
  };
  return (
    <div className="bd-field bd-field--add" style={{ display: 'contents' }}>
      <div className="bd-field__name">
        <input
          className="bd-input bd-input--newname"
          placeholder="New field"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="bd-field__edit">
        <input
          className="bd-input"
          placeholder="value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <button type="button" className="bd-field__add" title="Add field" onClick={add}>
          +
        </button>
      </div>
    </div>
  );
}

/** Formatted CSL citation with a style picker. Refetches on edit (detail change). */
function CitationBlock({ detail }: { detail: ItemDetail }) {
  const documentId = useStore((s) => s.documentId);
  const defaultStyle = useStore((s) => s.settings.defaultCiteStyle);
  const [styleId, setStyleId] = useState(defaultStyle);
  const [html, setHtml] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!documentId) return;
    let active = true;
    void window.bibdesk
      ?.formatCitation({ documentId, itemId: detail.id, styleId })
      .then((r) => {
        if (active) setHtml(r.html);
      });
    return () => {
      active = false;
    };
  }, [documentId, detail, styleId]);

  useEffect(() => {
    if (bodyRef.current && html.includes('$')) void typesetMath(bodyRef.current);
  }, [html]);

  return (
    <div className="bd-cite">
      <div className="bd-cite__head">
        <span className="bd-detail__section bd-detail__section--inline">Citation</span>
        <select
          className="bd-input bd-select bd-cite__style"
          value={styleId}
          onChange={(e) => setStyleId(e.target.value)}
          aria-label="Citation style"
        >
          {CITATION_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {html && (
        <div className="bd-cite__body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}

/** Notes: rendered markdown (with [[citeKey]] cross-refs + iframes) + an editor. */
function NotesSection({ detail }: { detail: ItemDetail }) {
  const edit = useStore((s) => s.edit);
  const selectByCiteKey = useStore((s) => s.selectByCiteKey);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing && ref.current && detail.notesHtml.includes('$')) void typesetMath(ref.current);
  }, [editing, detail.notesHtml]);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const cite = (e.target as HTMLElement).closest<HTMLElement>('[data-cite]');
      if (cite?.dataset.cite) {
        e.preventDefault();
        void selectByCiteKey(cite.dataset.cite);
        return;
      }
      const link = (e.target as HTMLElement).closest<HTMLElement>('[data-open-url]');
      if (link?.dataset.openUrl) {
        e.preventDefault();
        openExternal(link.dataset.openUrl, 'url');
      }
    },
    [selectByCiteKey],
  );

  return (
    <>
      <div className="bd-detail__section bd-detail__section--withaction">
        <span>Notes</span>
        <button
          type="button"
          className="bd-btn bd-btn--small"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      {editing ? (
        <textarea
          key={`${detail.id}:notes`}
          className="bd-input bd-input--area bd-notes__editor"
          defaultValue={detail.notesRaw}
          rows={6}
          placeholder="Markdown notes. Link entries with [[citeKey]]. Inline <iframe> embeds allowed."
          onBlur={(e) => {
            if (e.target.value !== detail.notesRaw) {
              void edit({ kind: 'setField', itemId: detail.id, field: 'Annote', value: e.target.value });
            }
          }}
        />
      ) : detail.notesHtml ? (
        <div
          className="bd-notes"
          ref={ref}
          onClick={onClick}
          dangerouslySetInnerHTML={{ __html: detail.notesHtml }}
        />
      ) : (
        <div className="bd-notes__empty">No notes. Click Edit to add markdown notes.</div>
      )}
    </>
  );
}

function Identity({ detail }: { detail: ItemDetail }) {
  const edit = useStore((s) => s.edit);
  const types = ENTRY_TYPES.includes(detail.type) ? ENTRY_TYPES : [detail.type, ...ENTRY_TYPES];
  return (
    <div className="bd-identity">
      <div className="bd-identity__row">
        <label className="bd-identity__label">Cite Key</label>
        <input
          key={`${detail.id}:citekey`}
          className="bd-input bd-input--mono"
          defaultValue={detail.citeKey}
          onBlur={(e) => {
            if (e.target.value && e.target.value !== detail.citeKey) {
              void edit({ kind: 'setCiteKey', itemId: detail.id, citeKey: e.target.value });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <button
          type="button"
          className="bd-btn bd-btn--small"
          title="Generate cite key from author + year"
          onClick={() => void edit({ kind: 'generateCiteKey', itemId: detail.id })}
        >
          Generate
        </button>
      </div>
      <div className="bd-identity__row">
        <label className="bd-identity__label">Type</label>
        <select
          className="bd-input bd-select"
          value={detail.type}
          onChange={(e) => void edit({ kind: 'setType', itemId: detail.id, entryType: e.target.value })}
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Fields({ detail }: { detail: ItemDetail }) {
  return (
    <>
      <div className="bd-detail__section">Fields</div>
      <div className="bd-fields">
        {detail.fields.map((f, i) => (
          <FieldRow key={`${f.name}-${i}`} itemId={detail.id} field={f} />
        ))}
        <AddFieldRow itemId={detail.id} />
      </div>
    </>
  );
}

function Attachments({ detail, onPreview }: { detail: ItemDetail; onPreview: (f: ItemFile) => void }) {
  const addAttachment = useStore((s) => s.addAttachment);
  const removeAttachment = useStore((s) => s.removeAttachment);
  return (
    <>
      <div className="bd-detail__section bd-detail__section--withaction">
        <span>Attachments</span>
        <button
          type="button"
          className="bd-btn bd-btn--small"
          title="Attach file(s)"
          onClick={() => void addAttachment(detail.id)}
        >
          ＋ Add
        </button>
      </div>
      {detail.files.length === 0 ? (
        <div className="bd-files__empty">No attachments.</div>
      ) : (
        <ul className="bd-files">
          {detail.files.map((file, i) => (
            <li className="bd-file" key={`${file.url}-${i}`}>
              <button
                type="button"
                className="bd-file__btn"
                title={isPdf(file) ? `Preview ${file.displayName}` : `Open ${file.url}`}
                onClick={() =>
                  isPdf(file) ? onPreview(file) : openExternal(file.url, file.kind === 'url' ? 'url' : 'file')
                }
              >
                <span className="bd-file__icon" aria-hidden="true">
                  {fileIcon(file.kind)}
                </span>
                <span className="bd-file__name">{file.displayName}</span>
              </button>
              {file.field && (
                <button
                  type="button"
                  className="bd-field__del"
                  title="Remove attachment"
                  onClick={() => void removeAttachment(detail.id, file.field!)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** A clean generated cover (journal initials on a name-derived colour) — fallback. */
function GeneratedCover({ journal }: { journal: string }) {
  const hue = [...journal].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const abbr =
    journal
      .split(/\s+/)
      .filter((w) => /^[A-Za-z]/.test(w) && !/^(the|of|and|a|in|for)$/i.test(w))
      .map((w) => w[0])
      .join('')
      .slice(0, 4)
      .toUpperCase() || journal.slice(0, 3).toUpperCase();
  return (
    <div className="bd-jcover bd-jcover--gen" style={{ background: `hsl(${hue} 42% 34%)` }} title={journal}>
      <span>{abbr}</span>
    </div>
  );
}

/** The entry's journal cover thumbnail (downloaded), or a generated fallback. */
function JournalCover({ documentId, itemId }: { documentId: string; itemId: string }) {
  const [state, setState] = useState<{ url?: string; journal?: string }>({});
  useEffect(() => {
    let cancelled = false;
    let made: string | undefined;
    void window.bibdesk?.journalCover({ documentId, itemId }).then((res) => {
      if (cancelled) return;
      if (res.data) {
        made = URL.createObjectURL(new Blob([res.data as BlobPart]));
        setState({ url: made, journal: res.journal });
      } else {
        setState({ journal: res.journal });
      }
    });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [documentId, itemId]);

  if (state.url) {
    return (
      <div className="bd-jcover" title={state.journal}>
        <img src={state.url} alt={state.journal ? `${state.journal} cover` : 'journal cover'} />
      </div>
    );
  }
  if (state.journal) return <GeneratedCover journal={state.journal} />;
  return null;
}

export function DetailPane() {
  const detail = useStore((s) => s.detail);
  const documentId = useStore((s) => s.documentId);
  const selectedItemId = useStore((s) => s.selectedItemId);
  const detailLoading = useStore((s) => s.detailLoading);
  const [pdfFile, setPdfFile] = useState<ItemFile | null>(null);

  if (!selectedItemId) {
    return <div className="bd-detail__empty">Select a publication to see and edit its details.</div>;
  }
  if (!detail || detail.id !== selectedItemId) {
    return <div className="bd-detail__empty">{detailLoading ? 'Loading…' : ''}</div>;
  }

  return (
    <div className="bd-detail">
      {documentId && <JournalCover documentId={documentId} itemId={detail.id} />}
      {detail.previewHtml && <PreviewCard html={detail.previewHtml} />}
      <CitationBlock detail={detail} />
      <Identity detail={detail} />
      <Fields detail={detail} />
      <NotesSection detail={detail} />
      <Attachments detail={detail} onPreview={setPdfFile} />
      {pdfFile && <PdfViewer file={pdfFile} onClose={() => setPdfFile(null)} />}
    </div>
  );
}
