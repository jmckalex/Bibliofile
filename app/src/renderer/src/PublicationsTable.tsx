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
import { useStore } from './store.js';

const ROW_HEIGHT = 28;

const col = createColumnHelper<PublicationRow>();

interface ColMeta {
  /** Flex-basis width in px. */
  width: number;
  /** Extra className applied to body cells. */
  cellClass?: string;
}

const columns: ColumnDef<PublicationRow, string>[] = [
  col.accessor('citeKey', {
    header: 'Cite Key',
    meta: { width: 150, cellClass: 'bd-td--mono' } satisfies ColMeta,
  }),
  col.accessor('type', {
    header: 'Type',
    meta: { width: 90, cellClass: 'bd-td--type' } satisfies ColMeta,
  }),
  col.accessor('authorsDisplay', {
    header: 'Authors',
    meta: { width: 220 } satisfies ColMeta,
  }),
  col.accessor('title', {
    header: 'Title',
    meta: { width: 320 } satisfies ColMeta,
  }),
  col.accessor('year', {
    header: 'Year',
    meta: { width: 64, cellClass: 'bd-td--year' } satisfies ColMeta,
  }),
];

function flexFor(width: number): string {
  // grow, shrink, basis — let Title stretch a bit more.
  return `1 1 ${width}px`;
}

export function PublicationsTable() {
  const rows = useStore((s) => s.rows);
  const selectedItemId = useStore((s) => s.selectedItemId);
  const sort = useStore((s) => s.sort);
  const selectItem = useStore((s) => s.selectItem);
  const setSort = useStore((s) => s.setSort);
  const loading = useStore((s) => s.loading);

  const table = useReactTable({
    data: rows,
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

  const metaWidths = useMemo(
    () =>
      table.getAllColumns().map((c) => (c.columnDef.meta as ColMeta | undefined)?.width ?? 120),
    [table],
  );

  return (
    <div className="bd-table">
      <div className="bd-table__head" role="row">
        {headerGroups[0]?.headers.map((header, i) => {
          const active = sort.key === header.column.id;
          return (
            <div
              key={header.id}
              className="bd-th"
              role="columnheader"
              style={{ flex: flexFor(metaWidths[i] ?? 120) }}
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
                  {row.getVisibleCells().map((cell, i) => {
                    const meta = cell.column.columnDef.meta as ColMeta | undefined;
                    return (
                      <div
                        key={cell.id}
                        role="gridcell"
                        className={'bd-td' + (meta?.cellClass ? ' ' + meta.cellClass : '')}
                        style={{ flex: flexFor(metaWidths[i] ?? 120) }}
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
