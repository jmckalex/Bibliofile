/**
 * Publications table — TanStack Table for column/sort modelling, with rows
 * virtualized by @tanstack/react-virtual so it scales to 10k+ entries.
 *
 * Sorting is server-side: header clicks call the store's setSort (which reloads
 * via the api), so we drive react-table headers manually rather than using its
 * client-side sorted row model.
 */

import { useCallback, useMemo, useRef } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PublicationRow } from '@bibdesk/shared';
import { useStore, visibleRows } from './store.js';

const ROW_HEIGHT = 28;

const col = createColumnHelper<PublicationRow>();

interface ColMeta {
  /** Flex-basis width in px. */
  width: number;
  /** Whether this column absorbs extra horizontal space. */
  grow?: boolean;
  /** Extra className applied to body cells. */
  cellClass?: string;
}

const columns: ColumnDef<PublicationRow, string>[] = [
  col.accessor('citeKey', {
    header: 'Cite Key',
    meta: { width: 160, cellClass: 'bd-td--mono' } satisfies ColMeta,
  }),
  col.accessor('type', {
    header: 'Type',
    meta: { width: 96, cellClass: 'bd-td--type' } satisfies ColMeta,
  }),
  col.accessor('authorsDisplay', {
    header: 'Authors',
    meta: { width: 240, grow: true } satisfies ColMeta,
  }),
  col.accessor('title', {
    header: 'Title',
    meta: { width: 360, grow: true } satisfies ColMeta,
  }),
  col.accessor('year', {
    header: 'Year',
    meta: { width: 72, cellClass: 'bd-td--year' } satisfies ColMeta,
  }),
];

function flexFor(meta: ColMeta | undefined): string {
  const width = meta?.width ?? 120;
  // Only Authors/Title grow; fixed columns keep their basis (no shrink) so the
  // narrow Year/Type columns never collapse or truncate their headers.
  return meta?.grow ? `1 1 ${width}px` : `0 0 ${width}px`;
}

export function PublicationsTable() {
  const rows = useStore((s) => s.rows);
  const query = useStore((s) => s.query);
  const ftsIds = useStore((s) => s.ftsIds);
  const selectedItemId = useStore((s) => s.selectedItemId);
  const sort = useStore((s) => s.sort);
  const selectItem = useStore((s) => s.selectItem);
  const setSort = useStore((s) => s.setSort);
  const loading = useStore((s) => s.loading);

  const data = useMemo(() => visibleRows(rows, query, ftsIds), [rows, query, ftsIds]);

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
          const active = sort.key === header.column.id;
          return (
            <div
              key={header.id}
              className="bd-th"
              role="columnheader"
              style={{ flex: flexFor(header.column.columnDef.meta as ColMeta | undefined) }}
              onClick={() => onHeaderClick(header.column.id)}
              aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
              {flexRender(header.column.columnDef.header, header.getContext())}
              {active && (
                <span className="bd-th__sort" aria-hidden="true">
                  {sort.direction === 'asc' ? '▲' : '▼'}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="bd-table__body" ref={scrollRef}>
        {tableRows.length === 0 ? (
          <div className="bd-empty-state">{loading ? 'Loading…' : 'No publications'}</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualItems.map((vItem) => {
              const row = tableRows[vItem.index];
              if (!row) return null;
              const selected = row.original.id === selectedItemId;
              return (
                <div
                  key={row.id}
                  role="row"
                  className={'bd-tr' + (selected ? ' bd-tr--selected' : '')}
                  style={{ height: ROW_HEIGHT, transform: `translateY(${vItem.start}px)` }}
                  aria-selected={selected}
                  onClick={() => void selectItem(row.original.id)}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as ColMeta | undefined;
                    return (
                      <div
                        key={cell.id}
                        role="gridcell"
                        className={'bd-td' + (meta?.cellClass ? ' ' + meta.cellClass : '')}
                        style={{ flex: flexFor(meta) }}
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
  );
}
