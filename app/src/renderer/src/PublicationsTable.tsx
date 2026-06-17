/**
 * Publications table — TanStack Table for column/sort modelling, with rows
 * virtualized by @tanstack/react-virtual so it scales to 10k+ entries.
 *
 * Sorting is server-side: header clicks call the store's setSort (which reloads
 * via the api), so we drive react-table headers manually rather than using its
 * client-side sorted row model.
 */

import { useCallback, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faKey, faPaperclip, faSquareCheck } from '@fortawesome/free-solid-svg-icons';
import { faSquare } from '@fortawesome/free-regular-svg-icons';
import type { PublicationRow } from '@bibdesk/shared';
import { formatCiteCommand } from '@bibdesk/shared';
import { useStore, visibleRows } from './store.js';

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
function HeaderIcon({ icon, title }: { icon: IconDefinition; title: string }) {
  return <FontAwesomeIcon icon={icon} title={title} aria-label={title} />;
}

// TanStack types `columns` as `ColumnDef<TData, any>[]`; mixing string accessors
// with display columns means the per-column TValue varies, so `any` is the
// sanctioned widening here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Col = ColumnDef<PublicationRow, any>;

/** The builtin (non-field) columns, keyed by their settings column id. */
const BUILTIN_DEFS: Record<string, Col> = {
  citeKey: col.accessor('citeKey', {
    id: 'citeKey',
    header: 'Cite Key',
    meta: { width: 160, cellClass: 'bd-td--mono' } satisfies ColMeta,
  }),
  type: col.accessor('type', {
    id: 'type',
    header: 'Type',
    meta: { width: 96, cellClass: 'bd-td--type' } satisfies ColMeta,
  }),
  authors: col.accessor('authorsDisplay', {
    id: 'authors',
    header: 'Authors',
    meta: { width: 240, grow: true } satisfies ColMeta,
  }),
  title: col.accessor('title', {
    id: 'title',
    header: 'Title',
    meta: { width: 360, grow: true } satisfies ColMeta,
  }),
  year: col.accessor('year', {
    id: 'year',
    header: 'Year',
    meta: { width: 72, cellClass: 'bd-td--year' } satisfies ColMeta,
  }),
  keywords: col.display({
    id: 'keywords',
    header: () => <HeaderIcon icon={faKey} title="Keywords" />,
    meta: { width: 34, cellClass: 'bd-td--icon' } satisfies ColMeta,
    cell: ({ row }) =>
      row.original.hasKeywords ? (
        <FontAwesomeIcon className="bd-icon bd-icon--key" icon={faKey} title="Has keywords" />
      ) : null,
  }),
  attachments: col.display({
    id: 'attachments',
    header: () => <HeaderIcon icon={faPaperclip} title="Attachments" />,
    meta: { width: 40, cellClass: 'bd-td--icon' } satisfies ColMeta,
    cell: ({ row }) => {
      const n = row.original.attachmentCount;
      if (n <= 0) return null;
      return (
        <span className="bd-icon bd-icon--clip" title={`${n} attachment${n === 1 ? '' : 's'}`}>
          <FontAwesomeIcon icon={faPaperclip} />
          {n > 1 && <span className="bd-icon__count">{n}</span>}
        </span>
      );
    },
  }),
  read: col.display({
    id: 'read',
    header: () => <HeaderIcon icon={faSquareCheck} title="Read" />,
    meta: { width: 40, cellClass: 'bd-td--icon' } satisfies ColMeta,
    // 1 = read (checked), -1 = explicitly unread (empty box), 0 = unset (blank).
    cell: ({ row }) => {
      const r = row.original.read;
      if (r === 0) return null;
      return r === 1 ? (
        <FontAwesomeIcon className="bd-icon bd-icon--checked" icon={faSquareCheck} title="Read" />
      ) : (
        <FontAwesomeIcon className="bd-icon bd-icon--unchecked" icon={faSquare} title="Unread" />
      );
    },
  }),
  rating: col.display({
    id: 'rating',
    header: 'Rating',
    meta: { width: 80, cellClass: 'bd-td--rating' } satisfies ColMeta,
    cell: ({ row }) => {
      const n = row.original.rating;
      return n > 0 ? <span title={`${n}/5`}>{'★'.repeat(n)}</span> : null;
    },
  }),
};

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

/** Build the ordered TanStack column list from the configured column keys. */
function buildColumns(keys: readonly string[]): Col[] {
  return keys.map(
    (key) =>
      BUILTIN_DEFS[key] ??
      // A non-builtin key is a BibTeX field name → text column over row.extra.
      col.display({
        id: key,
        header: key,
        meta: { width: 160, grow: true } satisfies ColMeta,
        cell: ({ row }) => row.original.extra?.[key] ?? '',
      }),
  );
}

export function PublicationsTable() {
  const rows = useStore((s) => s.rows);
  const query = useStore((s) => s.query);
  const ftsIds = useStore((s) => s.ftsIds);
  const selectedItemId = useStore((s) => s.selectedItemId);
  const selectedIds = useStore((s) => s.selectedIds);
  const sort = useStore((s) => s.sort);
  const selectItem = useStore((s) => s.selectItem);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const rangeSelectTo = useStore((s) => s.rangeSelectTo);
  const setSort = useStore((s) => s.setSort);
  const loading = useStore((s) => s.loading);
  const citeTemplate = useStore((s) => s.settings.citeCommandTemplate);
  const columnKeys = useStore((s) => s.settings.columns);
  const columnWidths = useStore((s) => s.settings.columnWidths);
  const saveSettings = useStore((s) => s.saveSettings);

  // Live width of the column being drag-resized (persisted to settings on mouseup).
  const [dragWidth, setDragWidth] = useState<{ id: string; width: number } | null>(null);
  // Column-reorder drag-and-drop state (header drag).
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<string | null>(null);
  const resizeRef = useRef<{ id: string; startX: number; startWidth: number } | null>(null);

  const data = useMemo(() => visibleRows(rows, query, ftsIds), [rows, query, ftsIds]);
  const columns = useMemo(() => buildColumns(columnKeys), [columnKeys]);

  // A column's width: live drag value > stored override > its built-in default.
  const widthOf = useCallback(
    (id: string, meta?: ColMeta): number =>
      (dragWidth?.id === id ? dragWidth.width : columnWidths[id]) ?? meta?.width ?? 120,
    [dragWidth, columnWidths],
  );
  // Authors/Title grow to fill — until the user drag-resizes them (then they pin).
  const isGrow = useCallback(
    (id: string, meta?: ColMeta): boolean =>
      !!meta?.grow && columnWidths[id] === undefined && dragWidth?.id !== id,
    [columnWidths, dragWidth],
  );
  const flexFor = useCallback(
    (id: string, meta?: ColMeta): string =>
      isGrow(id, meta) ? `1 1 ${widthOf(id, meta)}px` : `0 0 ${widthOf(id, meta)}px`,
    [isGrow, widthOf],
  );
  // When no column grows, a trailing spacer absorbs slack so rows still fill the width.
  const anyGrow = columns.some((c) => isGrow(c.id as string, c.meta as ColMeta | undefined));

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

  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const onHeaderClick = useCallback((key: string) => void setSort(key), [setSort]);

  const headerGroups = table.getHeaderGroups();
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="bd-table">
      <div className="bd-table__head" role="row">
        {headerGroups[0]?.headers.map((header) => {
          const id = header.column.id;
          const meta = header.column.columnDef.meta as ColMeta | undefined;
          const active = sort.key === id;
          return (
            <div
              key={header.id}
              className={
                'bd-th' + (dropCol === id ? ' bd-th--drop' : '') + (dragCol === id ? ' bd-th--dragging' : '')
              }
              role="columnheader"
              style={{ flex: flexFor(id, meta) }}
              aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
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
                title="Click to sort · drag to reorder"
                onClick={() => onHeaderClick(id)}
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
                {active && (
                  <span className="bd-th__sort" aria-hidden="true">
                    {sort.direction === 'asc' ? '▲' : '▼'}
                  </span>
                )}
              </div>
              <div
                className="bd-th__resize"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize column"
                onMouseDown={(e) => startResize(e, id)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          );
        })}
        {!anyGrow && <div className="bd-th bd-th--spacer" aria-hidden="true" style={{ flex: '1 1 0' }} />}
      </div>

      <div className="bd-table__body" ref={scrollRef}>
        {tableRows.length === 0 ? (
          <div className="bd-empty-state">{loading ? 'Loading…' : 'No publications'}</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
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
                  style={{ height: ROW_HEIGHT, transform: `translateY(${vItem.start}px)` }}
                  aria-selected={selected}
                  draggable
                  onClick={(e) => {
                    // Cmd/Ctrl = toggle; Shift = range; plain = single-select.
                    if (e.metaKey || e.ctrlKey) toggleSelect(row.original.id);
                    else if (e.shiftKey) rangeSelectTo(row.original.id, data.map((r) => r.id));
                    else void selectItem(row.original.id);
                  }}
                  onDragStart={(e) => {
                    // Drag a row into a TeX editor to insert the cite command,
                    // or onto a static group to add it (custom cite-key flavor).
                    const cite = formatCiteCommand(citeTemplate, [row.original.citeKey]);
                    e.dataTransfer.setData('text/plain', cite);
                    e.dataTransfer.setData('application/x-bibdesk-citekeys', row.original.citeKey);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as ColMeta | undefined;
                    return (
                      <div
                        key={cell.id}
                        role="gridcell"
                        className={'bd-td' + (meta?.cellClass ? ' ' + meta.cellClass : '')}
                        style={{ flex: flexFor(cell.column.id, meta) }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    );
                  })}
                  {!anyGrow && <div className="bd-td bd-td--spacer" aria-hidden="true" style={{ flex: '1 1 0' }} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
