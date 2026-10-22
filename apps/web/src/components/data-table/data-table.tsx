'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { EmptyState, ErrorState, TableSkeleton } from '@/components/feedback/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Pagination } from './pagination';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Applied to both header and cells, e.g. "hidden md:table-cell" or "text-right" */
    className?: string;
  }
}

export type { ColumnDef, SortingState };

interface ServerPagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Offer these page sizes; needs onPageSizeChange */
  pageSizeOptions?: number[];
  onPageSizeChange?: (pageSize: number) => void;
}

export function DataTable<T>({
  columns,
  data,
  loading = false,
  error,
  onRetry,
  empty,
  pagination,
  pageSize = 10,
  sorting,
  onSortingChange,
  rowHref,
  getRowId,
  toolbar,
  className,
  label,
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: React.ReactNode;
  /** Server-side pagination. Omit to paginate in the browser. */
  pagination?: ServerPagination;
  pageSize?: number;
  /** Controlled (server-side) sorting. Omit for client-side sorting. */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  /** Makes the whole row clickable. Keep a real link in the first column for keyboard users. */
  /** Null leaves that row unclickable, e.g. when the caller can't open it */
  rowHref?: (row: T) => string | null;
  getRowId?: (row: T) => string;
  toolbar?: React.ReactNode;
  className?: string;
  /** Accessible name for the table */
  label: string;
}) {
  const router = useRouter();
  const [localSorting, setLocalSorting] = React.useState<SortingState>([]);
  const manual = Boolean(pagination);

  // TanStack Table returns non-memoizable functions; the React Compiler lint flags this.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: data ?? [],
    columns,
    getRowId,
    state: { sorting: sorting ?? localSorting },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting ?? localSorting) : updater;
      if (onSortingChange) onSortingChange(next);
      else setLocalSorting(next);
    },
    manualSorting: Boolean(onSortingChange),
    manualPagination: manual,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: onSortingChange ? undefined : getSortedRowModel(),
    getPaginationRowModel: manual ? undefined : getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const rows = table.getRowModel().rows;
  const showSkeleton = loading && !data;
  const clientTotal = data?.length ?? 0;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-surface shadow-xs',
        className,
      )}
    >
      {toolbar && <div className="border-b border-border p-3">{toolbar}</div>}
      {error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : showSkeleton ? (
        <TableSkeleton columns={Math.min(columns.length, 5)} />
      ) : rows.length === 0 ? (
        (empty ?? <EmptyState title="Nothing here yet" />)
      ) : (
        <Table
          aria-label={label}
          aria-busy={loading || undefined}
          className={cn(loading && 'opacity-60 transition-opacity')}
        >
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const dir = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className={header.column.columnDef.meta?.className}
                      aria-sort={dir ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground focus-ring"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {dir === 'asc' ? (
                            <ArrowUp className="size-3.5" aria-hidden />
                          ) : dir === 'desc' ? (
                            <ArrowDown className="size-3.5" aria-hidden />
                          ) : (
                            <ChevronsUpDown className="size-3.5 opacity-50" aria-hidden />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const href = rowHref?.(row.original);
              return (
                <TableRow
                  key={row.id}
                  onClick={
                    href
                      ? (e) => {
                          // Let buttons, links and menus inside the row handle their own clicks.
                          if ((e.target as HTMLElement).closest('a,button,[role="menuitem"]'))
                            return;
                          router.push(href);
                        }
                      : undefined
                  }
                  className={cn(href && 'cursor-pointer hover:bg-accent/50')}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {!error && !showSkeleton && (pagination ? pagination.total > 0 : clientTotal > 0) && (
        <div className="border-t border-border">
          {pagination ? (
            <Pagination {...pagination} />
          ) : (
            <Pagination
              page={table.getState().pagination.pageIndex + 1}
              pageSize={table.getState().pagination.pageSize}
              total={clientTotal}
              onPageChange={(p) => table.setPageIndex(p - 1)}
            />
          )}
        </div>
      )}
    </div>
  );
}
