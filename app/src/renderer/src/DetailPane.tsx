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
import { useT } from './i18n.js';
import { Icon, type IconName } from './icons.js';
import { typesetMath, hasMath } from './mathjax.js';

/** Fallback BibTeX entry types if the dynamic list hasn't loaded yet. */
const ENTRY_TYPES = [
  'article', 'book', 'inbook', 'incollection', 'inproceedings', 'conference',
  'proceedings', 'phdthesis', 'mastersthesis', 'techreport', 'manual', 'misc',
  'unpublished', 'booklet',
];

function fileIcon(kind: ItemFile['kind']): IconName {
  return kind === 'url' ? 'link' : 'file';
}

function openExternal(target: string, kind: 'url' | 'file'): void {
  void window.bibdesk?.openExternal({ target, kind });
}

export function PreviewCard({ html, files = [] }: { html: string; files?: readonly ItemFile[] }) {
  const ref = useRef<HTMLDivElement>(null);
  // When the "📎 N files" chip is clicked and there's more than one file, show a
  // small menu (anchored at x/y) so the user can pick which one to open.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (ref.current && hasMath(html)) void typesetMath(ref.current);
  }, [html]);

  // Dismiss the file menu on any outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const openFile = (f: ItemFile): void => {
    openExternal(f.url, f.kind === 'url' ? 'url' : 'file');
    setMenu(null);
  };

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const urlEl = (e.target as HTMLElement).closest<HTMLElement>('[data-open-url]');
      if (urlEl?.dataset.openUrl) {
        e.preventDefault();
        openExternal(urlEl.dataset.openUrl, 'url');
        return;
      }
      const filesEl = (e.target as HTMLElement).closest<HTMLElement>('[data-open-files]');
      if (filesEl) {
        e.preventDefault();
        if (files.length === 1) {
          openFile(files[0]!);
        } else if (files.length > 1) {
          const r = filesEl.getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom + 2 });
        }
      }
    },
    [files],
  );

  return (
    <>
      <div className="bd-preview" ref={ref} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      {menu && (
        <div
          className="bd-filemenu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {files.map((f, i) => (
            <button
              key={`${f.url}-${i}`}
              type="button"
              className="bd-filemenu__item"
              onClick={() => openFile(f)}
            >
              <span className="bd-file__icon" aria-hidden="true">
                <Icon name="file" />
              </span>
              {f.displayName}
            </button>
          ))}
        </div>
      )}
    </>
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
  const t = useT();
  const n = Math.max(0, Math.min(5, parseInt(value, 10) || 0));
  return (
    <span className="bd-rating" role="radiogroup" aria-label={t('column.rating')}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          type="button"
          key={i}
          className={'bd-rating__star' + (i <= n ? ' bd-rating__star--on' : '')}
          aria-label={t(i === 1 ? 'detail.starCount' : 'detail.starCountPlural', { count: i })}
          aria-checked={i === n}
          onClick={() => onChange(i === n ? '' : String(i))}
        >
          <Icon name={i <= n ? 'starOn' : 'starOff'} />
        </button>
      ))}
    </span>
  );
}

/** One editable field row (uncontrolled; commits on blur / Enter). `template`
 * marks a not-yet-saved row offered for the entry type (no remove button). */
function FieldRow({ itemId, field, template = false }: { itemId: string; field: ItemField; template?: boolean }) {
  const t = useT();
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
        {field.isInherited && <span className="bd-field__badge">{t('view.inherited')}</span>}
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
        {!field.isInherited && !field.required && !template && (
          <button
            type="button"
            className="bd-circbtn bd-circbtn--del"
            title={t('detail.removeField', { name: field.name })}
            aria-label={t('detail.removeField', { name: field.name })}
            onClick={() => void edit({ kind: 'removeField', itemId, field: field.name })}
          >
            <Icon name="removeMinus" />
          </button>
        )}
        {field.required && (
          <span className="bd-field__req" title={t('detail.requiredTitle')}>
            {t('detail.req')}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A blank field-editor row added on demand by the green ＋ button. Type a name +
 * value and press Enter to add the field; the red − (or Escape) discards the row.
 */
function NewFieldRow({ itemId, onDone }: { itemId: string; onDone: () => void }) {
  const t = useT();
  const edit = useStore((s) => s.edit);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const commit = (): void => {
    const n = name.trim();
    if (n) void edit({ kind: 'setField', itemId, field: n, value });
    onDone();
  };
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') onDone();
  };
  return (
    <div className="bd-field bd-field--add" style={{ display: 'contents' }}>
      <div className="bd-field__name">
        <input
          className="bd-input bd-input--newname"
          placeholder={t('detail.fieldNamePlaceholder')}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKey}
        />
      </div>
      <div className="bd-field__edit">
        <input
          className="bd-input"
          placeholder={t('detail.valuePlaceholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
        />
        <button
          type="button"
          className="bd-circbtn bd-circbtn--del"
          title={t('detail.discardField')}
          aria-label={t('detail.discardField')}
          onClick={onDone}
        >
          <Icon name="removeMinus" />
        </button>
      </div>
    </div>
  );
}

/**
 * Formatted CSL citation. The style comes from Preferences
 * (`settings.defaultCiteStyle`) — not a per-view picker — so it's consistent and
 * doesn't overflow the narrow pane. Refetches on edit (detail change) or when the
 * preferred style changes.
 */
export function CitationBlock({ detail }: { detail: ItemDetail }) {
  const t = useT();
  const documentId = useStore((s) => s.documentId);
  const styleId = useStore((s) => s.settings.defaultCiteStyle);
  const [html, setHtml] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const styleLabel = CITATION_STYLES.find((s) => s.id === styleId)?.label ?? styleId;

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
    if (bodyRef.current && hasMath(html)) void typesetMath(bodyRef.current);
  }, [html]);

  return (
    <div className="bd-cite">
      <div className="bd-cite__head">
        <span className="bd-detail__section bd-detail__section--inline">{t('detail.citation')}</span>
        <span className="bd-cite__stylename" title={t('detail.citationStyleTitle')}>
          {styleLabel}
        </span>
      </div>
      {html && (
        <div className="bd-cite__body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}

/** Notes: rendered markdown (with [[citeKey]] cross-refs + iframes) + an editor. */
export function NotesSection({ detail, readOnly = false }: { detail: ItemDetail; readOnly?: boolean }) {
  const t = useT();
  const edit = useStore((s) => s.edit);
  const selectByCiteKey = useStore((s) => s.selectByCiteKey);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing && ref.current && hasMath(detail.notesHtml)) void typesetMath(ref.current);
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
        <span>{t('panel.annotation')}</span>
        {!readOnly && (
          <button
            type="button"
            className="bd-btn bd-btn--small"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? t('detail.done') : t('detail.edit')}
          </button>
        )}
      </div>
      {editing && !readOnly ? (
        <textarea
          key={`${detail.id}:notes`}
          className="bd-input bd-input--area bd-notes__editor"
          defaultValue={detail.notesRaw}
          rows={6}
          placeholder={t('detail.notesPlaceholder')}
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
        <div className="bd-notes__empty">
          {readOnly ? t('detail.noAnnotation') : t('detail.noAnnotationHint')}
        </div>
      )}
    </>
  );
}

function Identity({ detail }: { detail: ItemDetail }) {
  const t = useT();
  const edit = useStore((s) => s.edit);
  const entryTypes = useStore((s) => s.entryTypes);
  // Dynamic types (standard + custom); fall back to the static list pre-load.
  const names = entryTypes.length ? entryTypes.map((et) => et.name) : ENTRY_TYPES;
  const types = names.includes(detail.type) ? names : [detail.type, ...names];
  return (
    <div className="bd-identity">
      <div className="bd-identity__row">
        <label className="bd-identity__label">{t('column.citeKey')}</label>
        <input
          // Key includes the cite key so the uncontrolled input re-mounts (and
          // shows the new value) when it changes externally — e.g. via Generate.
          key={`${detail.id}:${detail.citeKey}`}
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
          title={t('detail.generateTitle')}
          onClick={() => void edit({ kind: 'generateCiteKey', itemId: detail.id })}
        >
          {t('detail.generate')}
        </button>
      </div>
      <div className="bd-identity__row">
        <label className="bd-identity__label">{t('column.type')}</label>
        <select
          className="bd-input bd-select"
          value={detail.type}
          onChange={(e) => void edit({ kind: 'setType', itemId: detail.id, entryType: e.target.value })}
        >
          {types.map((ty) => (
            <option key={ty} value={ty}>
              {ty}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Fields({ detail }: { detail: ItemDetail }) {
  const t = useT();
  // Blank rows added on demand by the ＋ button (keyed by a monotonic id).
  const [pending, setPending] = useState<number[]>([]);
  const nextId = useRef(0);
  const entryTypes = useStore((s) => s.entryTypes);
  // Drop any unsaved blank rows when switching to a different item.
  useEffect(() => {
    setPending([]);
  }, [detail.id]);

  // Offer the entry type's required/optional fields the item doesn't have yet as
  // empty rows, so a new (or incomplete) entry exposes the fields to fill in.
  // They persist only once given a value (FieldRow ignores empty no-ops).
  const present = new Set(detail.fields.map((f) => f.name.toLowerCase()));
  const info = entryTypes.find((et) => et.name.toLowerCase() === detail.type.toLowerCase());
  const templateRows: ItemField[] = [];
  if (info) {
    const seen = new Set(present);
    const offer = (name: string, required: boolean): void => {
      const lower = name.toLowerCase();
      if (seen.has(lower)) return;
      seen.add(lower);
      templateRows.push({ name, value: '', rawValue: '', isInherited: false, required });
    };
    for (const name of info.required) offer(name, true);
    for (const name of info.optional) offer(name, false);
  }

  return (
    <>
      <div className="bd-detail__section">{t('view.fields')}</div>
      <div className="bd-fields">
        {detail.fields.map((f, i) => (
          <FieldRow key={`${f.name}-${i}`} itemId={detail.id} field={f} />
        ))}
        {templateRows.map((f) => (
          <FieldRow key={`tmpl-${f.name}`} itemId={detail.id} field={f} template />
        ))}
        {pending.map((id) => (
          <NewFieldRow
            key={`new-${id}`}
            itemId={detail.id}
            onDone={() => setPending((p) => p.filter((x) => x !== id))}
          />
        ))}
      </div>
      <div className="bd-fields__add">
        <button
          type="button"
          className="bd-circbtn bd-circbtn--add"
          title={t('detail.addField')}
          aria-label={t('detail.addField')}
          onClick={() => setPending((p) => [...p, nextId.current++])}
        >
          +
        </button>
      </div>
    </>
  );
}

export function Attachments({
  detail,
  readOnly = false,
}: {
  detail: ItemDetail;
  readOnly?: boolean;
}) {
  const t = useT();
  const addAttachment = useStore((s) => s.addAttachment);
  const removeAttachment = useStore((s) => s.removeAttachment);
  // Real file attachments vs. remote Url/Doi links — shown separately so links
  // aren't miscounted as "attachments".
  const files = detail.files.filter((f) => f.kind === 'file');
  const links = detail.files.filter((f) => f.kind === 'url');

  const renderItem = (file: ItemFile, i: number) => (
    <li className="bd-file" key={`${file.kind}-${file.url}-${i}`}>
      <button
        type="button"
        className="bd-file__btn"
        title={t('detail.openFile', { name: file.displayName })}
        onClick={() => openExternal(file.url, file.kind === 'url' ? 'url' : 'file')}
      >
        <span className="bd-file__icon" aria-hidden="true">
          <Icon name={fileIcon(file.kind)} />
        </span>
        <span className="bd-file__name">{file.displayName}</span>
      </button>
      {!readOnly && file.field && (
        <button
          type="button"
          className="bd-field__del"
          title={t('detail.removeAttachment')}
          onClick={() => void removeAttachment(detail.id, file.field!)}
        >
          <Icon name="close" />
        </button>
      )}
    </li>
  );

  return (
    <>
      <div className="bd-detail__section bd-detail__section--withaction">
        <span>{t('column.attachments')}</span>
        {!readOnly && (
          <button
            type="button"
            className="bd-btn bd-btn--small"
            title={t('detail.attachTitle')}
            onClick={() => void addAttachment(detail.id)}
          >
            <Icon name="plus" /> {t('detail.add')}
          </button>
        )}
      </div>
      {files.length === 0 ? (
        <div className="bd-files__empty">{t('detail.noAttachments')}</div>
      ) : (
        <ul className="bd-files">{files.map(renderItem)}</ul>
      )}
      {links.length > 0 && (
        <>
          <div className="bd-detail__section">{t('detail.links')}</div>
          <ul className="bd-files">{links.map(renderItem)}</ul>
        </>
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
export function JournalCover({ documentId, itemId }: { documentId: string; itemId: string }) {
  const t = useT();
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
        <img
          src={state.url}
          alt={state.journal ? t('detail.journalCover', { name: state.journal }) : t('detail.journalCoverGeneric')}
        />
      </div>
    );
  }
  if (state.journal) return <GeneratedCover journal={state.journal} />;
  return null;
}

export function DetailPane() {
  const t = useT();
  const detail = useStore((s) => s.detail);
  const documentId = useStore((s) => s.documentId);
  const selectedItemId = useStore((s) => s.selectedItemId);
  const detailLoading = useStore((s) => s.detailLoading);

  if (!selectedItemId) {
    return <div className="bd-detail__empty">{t('detail.emptyEdit')}</div>;
  }
  if (!detail || detail.id !== selectedItemId) {
    return <div className="bd-detail__empty">{detailLoading ? t('common.loading') : ''}</div>;
  }

  return (
    <div className="bd-detail">
      {documentId && <JournalCover documentId={documentId} itemId={detail.id} />}
      {detail.previewHtml && (
        <PreviewCard html={detail.previewHtml} files={detail.files.filter((f) => f.kind === 'file')} />
      )}
      <CitationBlock detail={detail} />
      <Identity detail={detail} />
      <Fields detail={detail} />
      <NotesSection detail={detail} />
      <Attachments detail={detail} />
    </div>
  );
}
