/**
 * Publications table — TanStack Table for column/sort modelling, with rows
 * virtualized by @tanstack/react-virtual so it scales to 10k+ entries.
 *
 * Sorting is server-side: header clicks call the store's setSort (which reloads
 * via the api), so we drive react-table headers manually rather than using its
 * client-side sorted row model.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type UIEvent,
} from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PublicationRow, TFunction } from '@bibdesk/shared';
import { formatCiteCommand } from '@bibdesk/shared';
import { useStore, visibleRows } from './store.js';
import { useT } from './i18n.js';
import { Icon, type IconName } from './icons.js';
import { MathText } from './MathText.js';
import { ColorContextMenu } from './ColorContextMenu.js';

const ROW_HEIGHT = 28;
/** Smallest a column may be drag-resized to (keeps icon headers legible). */
const MIN_COL_WIDTH = 24;
/** DataTransfer type used when drag-reordering a column header. */
const COL_DND = 'application/x-bibdesk-col';

const col = createColumnHelper<PublicationRow>();

interface ColMeta {
  /** Flex-basis width in px. */
  width: number;
  /** Whether this column absorbs extra horizontal space. */
  grow?: boolean;
  /** Extra className applied to body cells. */
  cellClass?: string;
}

/** A FontAwesome glyph used as a column header, with an accessible tooltip. */
function HeaderIcon({ name, title }: { name: IconName; title: string }) {
  return <Icon name={name} title={title} aria-label={title} />;
}

// TanStack types `columns` as `ColumnDef<TData, any>[]`; mixing string accessors
// with display columns means the per-column TValue varies, so `any` is the
// sanctioned widening here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Col = ColumnDef<PublicationRow, any>;

/**
 * The builtin (non-field) columns, keyed by their settings column id. Built per
 * locale (header labels + cell tooltips come from `t`) so the table relabels
 * live when the language changes.
 */
function builtinDefs(t: TFunction): Record<string, Col> {
  return {
    citeKey: col.accessor('citeKey', {
      id: 'citeKey',
      header: t('column.citeKey'),
      meta: { width: 160, cellClass: 'bd-td--mono' } satisfies ColMeta,
    }),
    type: col.accessor('type', {
      id: 'type',
      header: t('column.type'),
      meta: { width: 96, cellClass: 'bd-td--type' } satisfies ColMeta,
    }),
    authors: col.accessor('authorsDisplay', {
      id: 'authors',
      header: t('column.authors'),
      meta: { width: 240, grow: true } satisfies ColMeta,
    }),
    title: col.accessor('title', {
      id: 'title',
      header: t('column.title'),
      meta: { width: 360, grow: true } satisfies ColMeta,
      cell: ({ getValue }) => <MathText text={String(getValue() ?? '')} />,
    }),
    year: col.accessor('year', {
      id: 'year',
      header: t('column.year'),
      meta: { width: 72, cellClass: 'bd-td--year' } satisfies ColMeta,
    }),
    keywords: col.display({
      id: 'keywords',
      header: () => <HeaderIcon name="keywords" title={t('column.keywords')} />,
      meta: { width: 28, cellClass: 'bd-td--icon' } satisfies ColMeta,
      cell: ({ row }) =>
        row.original.hasKeywords ? (
          <Icon name="keywords" className="bd-icon bd-icon--key" title={t('table.hasKeywords')} />
        ) : null,
    }),
    attachments: col.display({
      id: 'attachments',
      header: () => <HeaderIcon name="attachment" title={t('column.attachments')} />,
      meta: { width: 32, cellClass: 'bd-td--icon' } satisfies ColMeta,
      cell: ({ row }) => {
        const n = row.original.attachmentCount;
        if (n <= 0) return null;
        return (
          <span
            className="bd-icon bd-icon--clip"
            title={t(n === 1 ? 'table.attachmentTooltip' : 'table.attachmentTooltipPlural', { count: n })}
          >
            <Icon name="attachment" />
            {n > 1 && <span className="bd-icon__count">{n}</span>}
          </span>
        );
      },
    }),
    annotation: col.display({
      id: 'annotation',
      header: () => <HeaderIcon name="annotation" title={t('column.annotation')} />,
      meta: { width: 28, cellClass: 'bd-td--icon' } satisfies ColMeta,
      cell: ({ row }) =>
        row.original.hasAnnotation ? (
          <Icon name="annotation" className="bd-icon bd-icon--note" title={t('table.hasAnnotation')} />
        ) : null,
    }),
    read: col.display({
      id: 'read',
      header: () => <HeaderIcon name="read" title={t('column.read')} />,
      meta: { width: 28, cellClass: 'bd-td--icon' } satisfies ColMeta,
      // 1 = read (checked), -1 = explicitly unread (empty box), 0 = unset (blank).
      cell: ({ row }) => {
        const r = row.original.read;
        if (r === 0) return null;
        return r === 1 ? (
          <Icon name="read" className="bd-icon bd-icon--checked" title={t('column.read')} />
        ) : (
          <Icon name="unread" className="bd-icon bd-icon--unchecked" title={t('table.unread')} />
        );
      },
    }),
    rating: col.display({
      id: 'rating',
      header: t('column.rating'),
      meta: { width: 92, cellClass: 'bd-td--rating' } satisfies ColMeta,
      cell: ({ row }) => {
        const n = row.original.rating;
        if (n <= 0) return null;
        return (
          <span className="bd-rating" title={`${n}/5`} aria-label={`${n}/5`}>
            {Array.from({ length: n }, (_, i) => (
              <Icon key={i} name="starOn" className="bd-icon--star" />
            ))}
          </span>
        );
      },
    }),
  };
}

/**
 * Move `draggedId` to sit immediately before `targetId` in the column order
 * (the rule used by header drag-and-drop reordering). Pure + order-preserving;
 * returns a copy unchanged if either id is absent or they're identical.
 */
export function reorderColumns(
  columns: readonly string[],
  draggedId: string,
  targetId: string,
): string[] {
  if (draggedId === targetId || !columns.includes(draggedId)) return [...columns];
  const next = columns.filter((k) => k !== draggedId);
  const idx = next.indexOf(targetId);
  if (idx < 0) return [...columns];
  next.splice(idx, 0, draggedId);
  return next;
}

/**
 * Row tint for a color label, mirroring BibDesk's `BDSKColorRowView`: a soft
 * full-row fill when the row is NOT selected (so text stays legible), and a
 * colored left stripe always (which also keeps the color visible over the
 * selection highlight). `hex` is `#rrggbb`; `2e` ≈ 18% alpha.
 */
function rowColorStyle(hex: string | undefined, selected: boolean): CSSProperties {
  if (!hex) return {};
  const stripe = `inset 3px 0 0 0 ${hex}`;
  return selected ? { boxShadow: stripe } : { backgroundColor: `${hex}2e`, boxShadow: stripe };
}

/** Build the ordered TanStack column list from the configured column keys. */
function buildColumns(keys: readonly string[], t: TFunction): Col[] {
  const defs = builtinDefs(t);
  return keys.map(
    (key) =>
      defs[key] ??
      // A non-builtin key is a BibTeX field name → text column over row.extra.
      col.display({
        id: key,
        header: key,
        meta: { width: 160, grow: true } satisfies ColMeta,
        cell: ({ row }) => row.original.extra?.[key] ?? '',
      }),
  );
}

/** Reset window for the table's type-ahead buffer (ms between keystrokes). */
const TYPE_AHEAD_RESET_MS = 700;

/** The text a row contributes to type-select, given the active sort column. */
export function rowSortText(row: PublicationRow, key: string | undefined): string {
  switch (key) {
    case 'type':
      return row.type;
    case 'authors':
      return row.authorsDisplay;
    case 'year':
      return row.year;
    case 'citeKey':
      return row.citeKey;
    case 'title':
    case undefined:
      return row.title;
    default:
      return row.extra?.[key] ?? row.title;
  }
}

/**
 * Index of the next row (searching forward from `from`, wrapping) whose active
 * sort-column text starts with `needle` (already lowercased). -1 if none match.
 */
export function nextTypeMatch(
  rows: readonly PublicationRow[],
  from: number,
  needle: string,
  key: string | undefined,
): number {
  const n = rows.length;
  if (n === 0 || needle === '') return -1;
  const start = ((from % n) + n) % n;
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n;
    if (rowSortText(rows[idx]!, key).toLowerCase().startsWith(needle)) return idx;
  }
  return -1;
}

export function PublicationsTable() {
  const t = useT();
  const rows = useStore((s) => s.rows);
  const query = useStore((s) => s.query);
  const ftsIds = useStore((s) => s.ftsIds);
  const selectedItemId = useStore((s) => s.selectedItemId);
  const selectedIds = useStore((s) => s.selectedIds);
  const sort = useStore((s) => s.sort);
  const selectItem = useStore((s) => s.selectItem);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const rangeSelectTo = useStore((s) => s.rangeSelectTo);
  const extendSelectionTo = useStore((s) => s.extendSelectionTo);
  const selectAll = useStore((s) => s.selectAll);
  const setSort = useStore((s) => s.setSort);
  const openEditor = useStore((s) => s.openEditor);
  const openAnnotation = useStore((s) => s.openAnnotation);
  const deleteSelection = useStore((s) => s.deleteSelection);
  const loading = useStore((s) => s.loading);
  const citeTemplate = useStore((s) => s.settings.citeCommandTemplate);
  const columnKeys = useStore((s) => s.settings.columns);
  const columnWidths = useStore((s) => s.settings.columnWidths);
  const saveSettings = useStore((s) => s.saveSettings);
  const setColor = useStore((s) => s.setColor);

  // Right-click color picker: cursor position + the clicked row's current color.
  const [colorMenu, setColorMenu] = useState<
    { x: number; y: number; current?: string; count: number; itemId: string } | undefined
  >();

  // Live width of the column being drag-resized (persisted to settings on mouseup).
  const [dragWidth, setDragWidth] = useState<{ id: string; width: number } | null>(null);
  // Column-reorder drag-and-drop state (header drag).
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<string | null>(null);
  // Available width of the table viewport (tracked so grow columns fill exactly).
  const [viewportWidth, setViewportWidth] = useState(0);
  const resizeRef = useRef<{ id: string; startX: number; startWidth: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const typeAhead = useRef<{ buffer: string; at: number }>({ buffer: '', at: 0 });

  const data = useMemo(() => visibleRows(rows, query, ftsIds), [rows, query, ftsIds]);
  const columns = useMemo(() => buildColumns(columnKeys, t), [columnKeys, t]);

  // Track the scroll viewport width so the layout can distribute slack to grow columns.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setViewportWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * Resolve every column to an explicit pixel width. Authors/Title (grow) split
   * any slack so the table fills the viewport; once all columns' base widths
   * exceed the viewport the table scrolls horizontally (header + body together).
   */
  const layout = useMemo(() => {
    const base = columns.map((c) => {
      const id = c.id as string;
      const meta = c.meta as ColMeta | undefined;
      const width = (dragWidth?.id === id ? dragWidth.width : columnWidths[id]) ?? meta?.width ?? 120;
      const grow = !!meta?.grow && columnWidths[id] === undefined && dragWidth?.id !== id;
      return { id, width, grow };
    });
    const totalBase = base.reduce((s, c) => s + c.width, 0);
    const growers = base.filter((c) => c.grow);
    const widths: Record<string, number> = {};
    if (growers.length > 0 && viewportWidth > 0 && totalBase < viewportWidth) {
      const extra = (viewportWidth - totalBase) / growers.length;
      for (const c of base) widths[c.id] = c.grow ? c.width + extra : c.width;
    } else {
      for (const c of base) widths[c.id] = c.width;
    }
    const total = base.reduce((s, c) => s + widths[c.id]!, 0);
    return { widths, total };
  }, [columns, columnWidths, dragWidth, viewportWidth]);

  // Keep the (overflow-hidden) header scrolled in lockstep with the body.
  const syncHeaderScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    if (headRef.current) headRef.current.scrollLeft = e.currentTarget.scrollLeft;
  }, []);

  const startResize = useCallback(
    (e: MouseEvent, id: string): void => {
      e.preventDefault();
      e.stopPropagation();
      const cell = (e.currentTarget as HTMLElement).parentElement;
      const startWidth = cell?.offsetWidth ?? 120;
      resizeRef.current = { id, startX: e.clientX, startWidth };
      setDragWidth({ id, width: startWidth });
      const onMove = (ev: globalThis.MouseEvent): void => {
        const r = resizeRef.current;
        if (!r) return;
        setDragWidth({ id: r.id, width: Math.max(MIN_COL_WIDTH, r.startWidth + (ev.clientX - r.startX)) });
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const r = resizeRef.current;
        resizeRef.current = null;
        setDragWidth((dw) => {
          if (r && dw && dw.id === r.id) {
            void saveSettings({ columnWidths: { ...columnWidths, [r.id]: Math.round(dw.width) } });
          }
          return null;
        });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [columnWidths, saveSettings],
  );

  const reorder = useCallback(
    (draggedId: string, targetId: string): void => {
      const next = reorderColumns(columnKeys, draggedId, targetId);
      if (next.join(',') !== columnKeys.join(',')) void saveSettings({ columns: next });
    },
    [columnKeys, saveSettings],
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
  });

  const tableRows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const onHeaderClick = useCallback(
    (key: string, additive: boolean) => void setSort(key, additive),
    [setSort],
  );

  /**
   * Keyboard navigation + type-select for the focused table body. Arrow / Home /
   * End / PageUp / PageDown move the primary selection (Shift extends from the
   * fixed anchor); Cmd/Ctrl+A selects all; Enter opens the editor; a printable
   * key jumps to the next row whose active-sort-column text matches the typed
   * prefix (BibDesk's type-select), cycling on repeat and resetting after a pause.
   */
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>): void => {
      if (data.length === 0) return;
      const ids = data.map((r) => r.id);
      const cur = selectedItemId ? ids.indexOf(selectedItemId) : -1;
      const last = data.length - 1;

      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selectAll(ids);
        return;
      }
      // Delete / Backspace removes the current selection (1 or many). Undoable;
      // the floating delete button was removed in favour of this + the menu.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedItemId || selectedIds.length > 0) {
          e.preventDefault();
          void deleteSelection();
        }
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return; // leave Cmd+C / shortcuts alone

      const pageRows = Math.max(
        1,
        Math.floor((scrollRef.current?.clientHeight ?? ROW_HEIGHT * 10) / ROW_HEIGHT) - 1,
      );
      let target: number | null = null;
      switch (e.key) {
        case 'ArrowDown': target = cur < 0 ? 0 : Math.min(last, cur + 1); break;
        case 'ArrowUp': target = cur < 0 ? last : Math.max(0, cur - 1); break;
        case 'Home': target = 0; break;
        case 'End': target = last; break;
        case 'PageDown': target = cur < 0 ? 0 : Math.min(last, cur + pageRows); break;
        case 'PageUp': target = cur < 0 ? last : Math.max(0, cur - pageRows); break;
        case 'Enter':
          if (selectedItemId) {
            e.preventDefault();
            openEditor(selectedItemId);
          }
          return;
        default:
          break;
      }

      if (target !== null) {
        e.preventDefault();
        const id = ids[target]!;
        if (e.shiftKey) extendSelectionTo(id, ids);
        else void selectItem(id);
        virtualizer.scrollToIndex(target, { align: 'auto' });
        return;
      }

      // Type-select: a single printable character, ignoring key auto-repeat.
      if (e.key.length === 1 && !e.repeat) {
        const now = Date.now();
        const ta = typeAhead.current;
        ta.buffer = now - ta.at > TYPE_AHEAD_RESET_MS ? e.key : ta.buffer + e.key;
        ta.at = now;
        // A fresh single char starts past the current row (so repeats cycle
        // forward); a growing buffer re-checks from the current row.
        const from = ta.buffer.length > 1 ? Math.max(0, cur) : cur + 1;
        const idx = nextTypeMatch(data, from, ta.buffer.toLowerCase(), sort[0]?.key);
        if (idx >= 0) {
          e.preventDefault();
          void selectItem(data[idx]!.id);
          virtualizer.scrollToIndex(idx, { align: 'auto' });
        }
      }
    },
    [data, selectedItemId, selectedIds, sort, selectItem, extendSelectionTo, selectAll, openEditor, deleteSelection, virtualizer],
  );

  // Keep the primary selection in view when it changes programmatically — e.g. a
  // new publication (which sorts in anywhere) or "Select Crossref Parent". Keyed
  // on selectedItemId only, so it doesn't yank the scroll on every sort/filter;
  // align 'auto' is a no-op when the row is already visible.
  useEffect(() => {
    if (!selectedItemId) return;
    const index = tableRows.findIndex((r) => r.original.id === selectedItemId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemId]);

  const headerGroups = table.getHeaderGroups();
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <>
    <div className="bd-table">
      {/* Header clips horizontally; its inner row is scrolled in sync with the body. */}
      <div className="bd-table__head" role="row" ref={headRef}>
        <div className="bd-table__head-inner" style={{ width: layout.total }}>
          {headerGroups[0]?.headers.map((header) => {
            const id = header.column.id;
            const isIcon = (header.column.columnDef.meta as ColMeta | undefined)?.cellClass === 'bd-td--icon';
            const spec = sort.find((s) => s.key === id);
            // Show a priority number only when more than one column is sorted.
            const rank = spec && sort.length > 1 ? sort.indexOf(spec) + 1 : 0;
            const width = layout.widths[id] ?? 120;
            return (
              <div
                key={header.id}
                className={
                  'bd-th' +
                  (isIcon ? ' bd-th--icon' : '') +
                  (dropCol === id ? ' bd-th--drop' : '') +
                  (dragCol === id ? ' bd-th--dragging' : '')
                }
                role="columnheader"
                style={{ flex: `0 0 ${width}px`, width }}
                aria-sort={spec ? (spec.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(COL_DND)) return;
                  e.preventDefault();
                  if (dropCol !== id) setDropCol(id);
                }}
                onDragLeave={() => setDropCol((d) => (d === id ? null : d))}
                onDrop={(e) => {
                  if (!e.dataTransfer.types.includes(COL_DND)) return;
                  e.preventDefault();
                  const dragged = e.dataTransfer.getData(COL_DND);
                  setDropCol(null);
                  setDragCol(null);
                  if (dragged) reorder(dragged, id);
                }}
              >
                <div
                  className="bd-th__label"
                  draggable
                  title={t('table.sortHint')}
                  onClick={(e) => onHeaderClick(id, e.shiftKey)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(COL_DND, id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDragCol(id);
                  }}
                  onDragEnd={() => {
                    setDragCol(null);
                    setDropCol(null);
                  }}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {spec && (
                    <span className="bd-th__sort" aria-hidden="true">
                      <Icon name={spec.direction === 'asc' ? 'sortAsc' : 'sortDesc'} />
                      {rank > 0 && <span className="bd-th__sort-rank">{rank}</span>}
                    </span>
                  )}
                </div>
                <div
                  className="bd-th__resize"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t('table.resizeColumn')}
                  onMouseDown={(e) => startResize(e, id)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="bd-table__body"
        ref={scrollRef}
        onScroll={syncHeaderScroll}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {tableRows.length === 0 ? (
          <div className="bd-empty-state">{loading ? t('common.loading') : t('table.empty')}</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), width: layout.total, position: 'relative' }}>
            {virtualItems.map((vItem) => {
              const row = tableRows[vItem.index];
              if (!row) return null;
              const isPrimary = row.original.id === selectedItemId;
              const selected = isPrimary || selectedIds.includes(row.original.id);
              return (
                <div
                  key={row.id}
                  role="row"
                  className={
                    'bd-tr' +
                    (selected ? ' bd-tr--selected' : '') +
                    (selected && !isPrimary ? ' bd-tr--multi' : '')
                  }
                  style={{
                    height: ROW_HEIGHT,
                    width: layout.total,
                    transform: `translateY(${vItem.start}px)`,
                    ...rowColorStyle(row.original.color, selected),
                  }}
                  aria-selected={selected}
                  draggable
                  onClick={(e) => {
                    // Cmd/Ctrl = toggle; Shift = range; plain = single-select.
                    if (e.metaKey || e.ctrlKey) toggleSelect(row.original.id);
                    else if (e.shiftKey) rangeSelectTo(row.original.id, data.map((r) => r.id));
                    else void selectItem(row.original.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    // Finder-style: a right-click on a row outside the current
                    // selection selects just it first; otherwise act on the selection.
                    if (!selected) void selectItem(row.original.id);
                    // Right-click outside the selection acts on just this row;
                    // inside it acts on the whole selection.
                    const count = selected ? Math.max(1, selectedIds.length) : 1;
                    setColorMenu({
                      x: e.clientX,
                      y: e.clientY,
                      current: row.original.color,
                      count,
                      itemId: row.original.id,
                    });
                  }}
                  onDoubleClick={() => openEditor(row.original.id)}
                  onDragStart={(e) => {
                    // Drag a row into a TeX editor to insert the cite command,
                    // or onto a static group to add it (custom cite-key flavor).
                    // When the dragged row is part of the multi-selection, drag the
                    // whole selection (in visible order); otherwise just this row.
                    const sel = new Set<string>(selectedIds);
                    if (selectedItemId) sel.add(selectedItemId);
                    const dragged = sel.has(row.original.id)
                      ? data.filter((r) => sel.has(r.id))
                      : [row.original];
                    const keys = dragged.map((r) => r.citeKey);
                    const cite = formatCiteCommand(citeTemplate, keys);
                    e.dataTransfer.setData('text/plain', cite);
                    e.dataTransfer.setData('application/x-bibdesk-citekeys', keys.join(','));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as ColMeta | undefined;
                    const width = layout.widths[cell.column.id] ?? 120;
                    return (
                      <div
                        key={cell.id}
                        role="gridcell"
                        className={'bd-td' + (meta?.cellClass ? ' ' + meta.cellClass : '')}
                        style={{ flex: `0 0 ${width}px`, width }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
    {colorMenu && (
      <ColorContextMenu
        x={colorMenu.x}
        y={colorMenu.y}
        current={colorMenu.current}
        count={colorMenu.count}
        onPick={(idx) => void setColor(idx)}
        onEditAnnotation={() => openAnnotation(colorMenu.itemId)}
        onDelete={() => void deleteSelection()}
        onClose={() => setColorMenu(undefined)}
      />
    )}
    </>
  );
}
