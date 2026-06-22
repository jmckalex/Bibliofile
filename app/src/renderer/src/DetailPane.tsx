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
import { splitGroupFieldValue } from '@bibdesk/groups';
import { filterCiteKeyInput, citeKeyHasFragileChars } from '@bibdesk/formats';
import { useStore } from './store.js';
import { useT } from './i18n.js';
import { Icon, type IconName } from './icons.js';
import { CodeEditor } from './CodeEditor.js';
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

/** Stable hue (0–359) from a keyword, so the same keyword always gets the same
 *  colour chip across entries. */
function keywordHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

/**
 * Reusable token / chip editor. Each token is a coloured chip; the single text
 * input acts as a movable caret that lives *between* chips: the tokens to its
 * left are `before`, the ones to its right are `after`, and `draft` is the text
 * currently under the caret. Typing `,` or Enter settles the draft into chips;
 * Left/Right arrows at the edge of the draft step the caret across a chip,
 * lifting that chip back into editable text (so any keyword can be corrected in
 * place without the layout shifting); Backspace/Delete on an empty draft removes
 * the neighbouring chip; a chip's × removes it.
 *
 * `onChange` fires only on *settle* events (comma/Enter/navigation/delete/blur),
 * never per keystroke, and reports the full token sequence INCLUDING the trimmed
 * draft — so moving the caret between chips never churns the underlying value.
 * Tokens are split on the SAME `;:,` separators as the keyword/category groups,
 * so chips, sidebar groups, and search all agree.
 */
function TokenInput({
  initial,
  placeholder,
  onChange,
}: {
  initial: readonly string[];
  placeholder?: string;
  onChange: (tokens: readonly string[]) => void;
}) {
  const t = useT();
  const [before, setBefore] = useState<readonly string[]>(initial);
  const [after, setAfter] = useState<readonly string[]>([]);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const caretTo = (pos: number): void => {
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos, pos));
  };

  // Commit a new (before · draft · after) state and report the full token list,
  // with the trimmed draft folded into its caret position. Called on settle
  // events only, so the draft text never reaches `onChange` mid-keystroke.
  const apply = (b: readonly string[], a: readonly string[], d: string): void => {
    setBefore(b);
    setAfter(a);
    setDraft(d);
    const trimmed = d.trim();
    onChange([...b, ...(trimmed ? [trimmed] : []), ...a]);
  };

  // Split typed/pasted text on the keyword separators; dedup case-insensitively
  // against the chips that already exist on either side and within the batch.
  const settled = (raw: string): readonly string[] => {
    const out: string[] = [];
    for (const k of splitGroupFieldValue(raw)) {
      const dup =
        before.some((c) => c.toLowerCase() === k.toLowerCase()) ||
        after.some((c) => c.toLowerCase() === k.toLowerCase()) ||
        out.some((o) => o.toLowerCase() === k.toLowerCase());
      if (!dup) out.push(k);
    }
    return out;
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === draft.length && el.selectionEnd === draft.length;
    if (e.key === ',' || e.key === 'Enter') {
      e.preventDefault();
      apply([...before, ...settled(draft)], after, '');
    } else if (e.key === 'ArrowLeft' && atStart && (before.length > 0 || draft.trim())) {
      // Step the caret left: settle the draft to the caret's right, then lift the
      // chip now on the left into editable text (caret at its end).
      e.preventDefault();
      const right = [...settled(draft), ...after];
      if (before.length > 0) {
        const lifted = before[before.length - 1]!;
        apply(before.slice(0, -1), right, lifted);
        caretTo(lifted.length);
      } else {
        apply(before, right, '');
      }
    } else if (e.key === 'ArrowRight' && atEnd && (after.length > 0 || draft.trim())) {
      // Symmetric: settle the draft to the caret's left, lift the next chip on the
      // right into editable text (caret at its start).
      e.preventDefault();
      const left = [...before, ...settled(draft)];
      if (after.length > 0) {
        const lifted = after[0]!;
        apply(left, after.slice(1), lifted);
        caretTo(0);
      } else {
        apply(left, after, '');
      }
    } else if (e.key === 'Backspace' && draft === '' && before.length > 0) {
      e.preventDefault();
      apply(before.slice(0, -1), after, ''); // delete the chip before the caret
    } else if (e.key === 'Delete' && draft === '' && after.length > 0) {
      e.preventDefault();
      apply(before, after.slice(1), ''); // delete the chip after the caret
    }
  };

  const chip = (kw: string, key: string, onDel: () => void) => (
    <span key={key} className="bd-kw" style={{ '--kw-h': keywordHue(kw) } as React.CSSProperties}>
      <span className="bd-kw__label">{kw}</span>
      <button
        type="button"
        className="bd-kw__del"
        aria-label={t('detail.removeKeyword', { keyword: kw })}
        onClick={onDel}
      >
        <Icon name="close" />
      </button>
    </span>
  );

  const empty = before.length === 0 && after.length === 0;
  return (
    <div
      className="bd-kwfield"
      onMouseDown={(e) => {
        // A click in the box's empty area (not on a chip) parks the caret at the
        // end, after every chip, and focuses the input.
        if (e.target === e.currentTarget) {
          e.preventDefault();
          if (after.length) apply([...before, ...after], [], draft);
          inputRef.current?.focus();
        }
      }}
    >
      {before.map((kw, i) => chip(kw, `b-${kw}-${i}`, () => apply(before.filter((_, j) => j !== i), after, draft)))}
      <input
        ref={inputRef}
        className={'bd-kw__input' + (after.length ? ' bd-kw__input--mid' : '')}
        // With chips to the right, size the box to the draft (min 1ch) so they
        // abut the caret; with none, the class lets it flex to fill the row.
        size={after.length ? Math.max(draft.length, 1) : undefined}
        value={draft}
        placeholder={empty ? placeholder : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        // On blur always re-settle: a non-empty draft becomes chip(s); an emptied
        // draft (e.g. a lifted chip the user deleted) drops out of the value.
        onBlur={() => apply([...before, ...settled(draft)], after, '')}
      />
      {after.map((kw, i) => chip(kw, `a-${kw}-${i}`, () => apply(before, after.filter((_, j) => j !== i), draft)))}
    </div>
  );
}

/**
 * Keyword token editor (the `Keywords` field) — a {@link TokenInput} whose token
 * list is persisted as the comma-joined `Keywords` value (`Keywords = {a, b, c}`
 * in BibTeX). The no-op guard means navigating between chips never writes.
 */
function KeywordTokens({ itemId, field }: { itemId: string; field: ItemField }) {
  const t = useT();
  const edit = useStore((s) => s.edit);
  return (
    <TokenInput
      initial={splitGroupFieldValue(field.rawValue)}
      placeholder={t('detail.addKeyword')}
      onChange={(tokens) => {
        const value = tokens.join(', ');
        if (value !== field.rawValue) void edit({ kind: 'setField', itemId, field: field.name, value });
      }}
    />
  );
}

/**
 * Fields whose value is unique per entry (titles, identifiers, page ranges) or
 * is free-form prose — completing them against OTHER entries' values is just
 * noise, so they get a plain input with no autocomplete datalist. Shared-
 * vocabulary fields (Journal, Publisher, Series, Editor, Author, Year, Volume…)
 * keep autocomplete. Names are compared lower-cased; tune this set to taste.
 */
const NO_AUTOCOMPLETE_FIELDS = new Set([
  'title',
  'subtitle',
  'abstract',
  'note',
  'annote',
  'doi',
  'url',
  'eprint',
  'pages',
  'isbn',
  'date-added',
  'date-modified',
]);

/** One editable field row (uncontrolled; commits on blur / Enter). `template`
 * marks a not-yet-saved row offered for the entry type (no remove button). */
function FieldRow({ itemId, field, template = false }: { itemId: string; field: ItemField; template?: boolean }) {
  const t = useT();
  const edit = useStore((s) => s.edit);
  const fieldSuggestions = useStore((s) => s.fieldSuggestions);
  const long = field.name.toLowerCase() === 'abstract' || field.rawValue.length > 60;
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  const listId = `dl-${itemId}-${field.name}`;
  // Autocomplete only for shared-vocabulary fields, not unique/free-text ones.
  const completable = !NO_AUTOCOMPLETE_FIELDS.has(field.name.toLowerCase());

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
        ) : field.kind === 'keywords' ? (
          <KeywordTokens key={`${itemId}:${field.name}`} itemId={itemId} field={field} />
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
            list={completable ? listId : undefined}
            defaultValue={field.rawValue}
            onFocus={completable ? loadSuggestions : undefined}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        )}
        {completable && suggestions.length > 0 && (
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
  // When the field being added is `Keywords`, its value gets the full chip editor
  // from the very first keystroke (not a plain box that only upgrades once the
  // field exists). The chip tokens live in a ref so committing the row reads them
  // without forcing a re-render on every settle.
  const isKeyword = name.trim().toLowerCase() === 'keywords';
  const keywordsRef = useRef<readonly string[]>([]);
  const commit = (): void => {
    const n = name.trim();
    const v = isKeyword ? keywordsRef.current.join(', ') : value;
    if (n) void edit({ kind: 'setField', itemId, field: n, value: v });
    onDone();
  };
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') onDone();
  };
  // Commit when focus leaves the whole row — clicking away, tabbing out, or closing
  // the editor — not when moving between the name + value inputs (relatedTarget is
  // still inside the row) and not via the discard button (which runs onDone). Without
  // this, a field typed but not Enter-confirmed was silently lost when the dialog closed.
  const onBlur = (e: React.FocusEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit();
  };
  return (
    <div className="bd-field bd-field--add" style={{ display: 'contents' }} onBlur={onBlur}>
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
        {isKeyword ? (
          <TokenInput
            initial={[]}
            placeholder={t('detail.addKeyword')}
            onChange={(tokens) => {
              keywordsRef.current = tokens;
            }}
          />
        ) : (
          <input
            className="bd-input"
            placeholder={t('detail.valuePlaceholder')}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
          />
        )}
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
  // Live editor content; committed to the Annote field on blur / Done (one undo
  // step per editing session, like the old textarea). Reset on item switch or
  // after a save so we never write one entry's draft onto another.
  const draftRef = useRef(detail.notesRaw);
  useEffect(() => {
    draftRef.current = detail.notesRaw;
  }, [detail.id, detail.notesRaw]);

  const commitNotes = useCallback(() => {
    if (draftRef.current !== detail.notesRaw) {
      void edit({ kind: 'setField', itemId: detail.id, field: 'Annote', value: draftRef.current });
    }
  }, [detail.id, detail.notesRaw, edit]);

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
            onClick={() => {
              if (editing) commitNotes();
              setEditing((v) => !v);
            }}
          >
            {editing ? t('detail.done') : t('detail.edit')}
          </button>
        )}
      </div>
      {editing && !readOnly ? (
        <CodeEditor
          key={`${detail.id}:notes`}
          language="markdown"
          value={detail.notesRaw}
          placeholder={t('detail.notesPlaceholder')}
          minHeight="160px"
          autoFocus
          onChange={(v) => {
            draftRef.current = v;
          }}
          onBlur={commitNotes}
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
  // Live cite-key validation: filter illegal characters as you type, and flag an
  // empty / duplicate / TeX-fragile key. The duplicate check is client-side
  // against the loaded rows — cite keys must be unique within one `.bib`.
  const rows = useStore((s) => s.rows);
  const [keyDraft, setKeyDraft] = useState(detail.citeKey);
  useEffect(() => setKeyDraft(detail.citeKey), [detail.id, detail.citeKey]);
  const trimmedKey = keyDraft.trim();
  const keyDuplicate =
    trimmedKey !== '' && rows.some((r) => r.id !== detail.id && r.citeKey === trimmedKey);
  const keyWarning =
    trimmedKey === ''
      ? t('detail.citeKeyEmpty')
      : keyDuplicate
        ? t('detail.citeKeyDuplicate')
        : citeKeyHasFragileChars(trimmedKey)
          ? t('detail.citeKeyFragile')
          : '';
  const commitCiteKey = (): void => {
    if (trimmedKey && trimmedKey !== detail.citeKey) {
      void edit({ kind: 'setCiteKey', itemId: detail.id, citeKey: trimmedKey });
    } else if (!trimmedKey) {
      setKeyDraft(detail.citeKey); // never commit an empty key — revert to the current one
    }
  };
  return (
    <div className="bd-identity">
      <div className="bd-identity__row">
        <label className="bd-identity__label">{t('column.citeKey')}</label>
        <input
          className={'bd-input bd-input--mono' + (keyWarning ? ' bd-input--warn' : '')}
          value={keyDraft}
          onChange={(e) => setKeyDraft(filterCiteKeyInput(e.target.value))}
          onBlur={commitCiteKey}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        {keyWarning && (
          <span className="bd-identity__warn" role="img" aria-label={keyWarning} title={keyWarning}>
            <Icon name="warning" />
          </span>
        )}
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
