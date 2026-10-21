'use client';

import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Ban,
  CheckCircle2,
  CircleSlash,
  Clock,
  Ellipsis,
  HeartHandshake,
  Pencil,
  Plus,
  Power,
  Sparkles,
  Trash2,
} from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { StatusBadge } from '@/components/domain/status-badges';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { FilterBar, SearchInput } from '@/components/data-table/filter-bar';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState } from '@/components/feedback/states';
import { ColorDot } from '@/components/forms/color-picker';
import { SectionHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { isApiError } from '@/lib/api/client';
import {
  useAddDefaultTherapyTypes,
  useDeleteTherapyType,
  useReorderTherapyTypes,
  useSetTherapyTypeStatus,
  useTherapyTypeList,
  type TherapyTypeListParams,
} from '@/lib/api/therapy-types';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { formatMinutes } from '@/lib/settings-limits';
import { useSession } from '@/lib/session';
import type { CenterTherapyType } from '@/lib/types';
import { DurationsDialog } from './durations-dialog';
import { TherapyTypeSheet } from './therapy-type-sheet';

export function TherapyTypeStatusBadge({ active }: { active: boolean }) {
  return (
    <StatusBadge
      def={
        active
          ? { label: 'Active', tone: 'success', icon: CheckCircle2 }
          : { label: 'Inactive', tone: 'neutral', icon: CircleSlash }
      }
    />
  );
}

function DurationSummary({ type }: { type: CenterTherapyType }) {
  const active = type.durationOptions.filter((o) => o.isActive);
  if (active.length <= 1) return <span className="text-subtle-foreground">Default only</span>;
  return <span className="tabular">{active.map((o) => o.durationMinutes).join(' · ')} min</span>;
}

type Dialog =
  | { kind: 'edit'; type: CenterTherapyType }
  | { kind: 'durations'; id: string }
  | { kind: 'deactivate'; type: CenterTherapyType }
  | { kind: 'delete'; type: CenterTherapyType }
  | null;

export function TherapyTypesScreen() {
  const { can } = useSession();
  const canCreate = can('therapy_types.create');
  const canUpdate = can('therapy_types.update');
  const canDelete = can('therapy_types.delete');

  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<NonNullable<TherapyTypeListParams['status']>>('all');
  const debouncedSearch = useDebounced(search);
  const filtered = Boolean(debouncedSearch || status !== 'all');
  const { data, isFetching, error, refetch } = useTherapyTypeList({
    search: debouncedSearch,
    status,
  });

  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const setStatusMutation = useSetTherapyTypeStatus();
  const remove = useDeleteTherapyType();
  const reorder = useReorderTherapyTypes();
  const addDefaults = useAddDefaultTherapyTypes();

  // Reordering needs the whole list, so it's offered only when nothing is filtered out.
  const canReorder = canUpdate && !filtered && (data?.length ?? 0) > 1;
  const move = React.useCallback(
    (index: number, delta: number) => {
      if (!data) return;
      const ids = data.map((t) => t.id);
      const [moved] = ids.splice(index, 1);
      ids.splice(index + delta, 0, moved);
      reorder.mutate(ids, { onError: (e) => toast.error(e.message) });
    },
    [data, reorder],
  );

  const changeStatus = React.useCallback(
    (type: CenterTherapyType, isActive: boolean) =>
      setStatusMutation.mutate(
        { id: type.id, isActive },
        {
          onSuccess: () => {
            toast.success(`${type.name} ${isActive ? 'activated' : 'deactivated'}`);
            setDialog(null);
          },
          onError: (e) => toast.error(e.message),
        },
      ),
    [setStatusMutation],
  );

  const columns = React.useMemo<ColumnDef<CenterTherapyType, unknown>[]>(
    () =>
      (
        [
          ...(canReorder
            ? [
                {
                  id: 'order',
                  header: () => <span className="sr-only">Order</span>,
                  meta: { className: 'w-16' },
                  cell: ({ row }) => (
                    <div className="flex items-center">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-7"
                        disabled={row.index === 0 || reorder.isPending}
                        onClick={() => move(row.index, -1)}
                        aria-label={`Move ${row.original.name} up`}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-7"
                        disabled={row.index === (data?.length ?? 0) - 1 || reorder.isPending}
                        onClick={() => move(row.index, 1)}
                        aria-label={`Move ${row.original.name} down`}
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                  ),
                } satisfies ColumnDef<CenterTherapyType, unknown>,
              ]
            : []),
          {
            accessorKey: 'name',
            header: 'Therapy type',
            cell: ({ row }) => (
              <div className="flex min-w-0 items-start gap-2.5">
                <ColorDot color={row.original.color} className="mt-1.5" />
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium break-words sm:truncate">{row.original.name}</span>
                  {/* Code and length move here on phones, where those columns are hidden. */}
                  <span className="text-xs text-muted-foreground tabular sm:hidden">
                    {row.original.code} · {formatMinutes(row.original.defaultDurationMinutes)}
                    {!row.original.isActive && ' · Inactive'}
                  </span>
                  {row.original.description && (
                    <span className="line-clamp-1 hidden text-xs text-muted-foreground sm:block">
                      {row.original.description}
                    </span>
                  )}
                </div>
              </div>
            ),
          },
          {
            accessorKey: 'code',
            header: 'Code',
            meta: { className: 'hidden sm:table-cell' },
            cell: ({ row }) => (
              <Badge tone="outline" className="font-mono">
                {row.original.code}
              </Badge>
            ),
          },
          {
            accessorKey: 'defaultDurationMinutes',
            header: 'Default',
            meta: { className: 'hidden sm:table-cell tabular whitespace-nowrap' },
            cell: ({ row }) => formatMinutes(row.original.defaultDurationMinutes),
          },
          {
            id: 'durations',
            header: 'Durations offered',
            meta: { className: 'hidden md:table-cell whitespace-nowrap' },
            cell: ({ row }) => <DurationSummary type={row.original} />,
          },
          {
            accessorKey: 'isActive',
            header: 'Status',
            meta: { className: 'hidden sm:table-cell' },
            cell: ({ row }) => <TherapyTypeStatusBadge active={row.original.isActive} />,
          },
          {
            id: 'actions',
            header: () => <span className="sr-only">Actions</span>,
            meta: { className: 'w-12 text-right' },
            cell: ({ row }) => {
              const type = row.original;
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${type.name}`}>
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {canUpdate && (
                      <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit', type })}>
                        <Pencil /> Edit
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onSelect={() => setDialog({ kind: 'durations', id: type.id })}
                    >
                      <Clock /> {canUpdate ? 'Manage durations' : 'View durations'}
                    </DropdownMenuItem>
                    {canUpdate &&
                      (type.isActive ? (
                        <DropdownMenuItem onSelect={() => setDialog({ kind: 'deactivate', type })}>
                          <Ban /> Deactivate
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => changeStatus(type, true)}>
                          <Power /> Activate
                        </DropdownMenuItem>
                      ))}
                    {canDelete && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          tone="danger"
                          onSelect={() => setDialog({ kind: 'delete', type })}
                        >
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            },
          },
        ] satisfies ColumnDef<CenterTherapyType, unknown>[]
      ).map((column) => ({ ...column, enableSorting: false })),
    [canReorder, canUpdate, canDelete, data?.length, move, reorder.isPending, changeStatus],
  );

  const durationsType =
    dialog?.kind === 'durations' ? (data?.find((t) => t.id === dialog.id) ?? null) : null;

  return (
    <RequirePermission permission="therapy_types.read">
      <SectionHeader
        title="Therapy types"
        description="The services your center offers. Each center sets up its own."
        actions={
          canCreate && (
            <Button onClick={() => setSheetOpen(true)}>
              <Plus /> Add therapy type
            </Button>
          )
        }
      />
      <DataTable
        label="Therapy types"
        columns={columns}
        data={data}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(t) => t.id}
        pageSize={100}
        toolbar={
          <FilterBar>
            <SearchInput
              value={search}
              onChange={setSearch}
              label="Search therapy types"
              placeholder="Search name or code…"
            />
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger size="sm" className="w-full sm:w-36" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </FilterBar>
        }
        empty={
          filtered ? (
            <EmptyState
              title="No therapy types match these filters"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearch('');
                    setStatus('all');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={HeartHandshake}
              title="No therapy types yet"
              description="Add the services your center offers. You need at least one before patients can be booked."
              action={
                canCreate && (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button size="sm" onClick={() => setSheetOpen(true)}>
                      <Plus /> Add therapy type
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={addDefaults.isPending}
                      onClick={() =>
                        addDefaults.mutate(undefined, {
                          onSuccess: ({ created }) =>
                            toast.success(`Added ${created} therapy types`, {
                              description: 'Rename, retime or deactivate them as you need.',
                            }),
                          onError: (e) => toast.error(e.message),
                        })
                      }
                    >
                      <Sparkles /> Start with OT, ABA and SLT
                    </Button>
                  </div>
                )
              }
            />
          )
        }
      />
      {canReorder && (
        <p className="mt-2 text-xs text-muted-foreground">
          The order here is the order staff see when booking.
        </p>
      )}

      {canCreate && (
        <TherapyTypeSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          onCreated={(type) =>
            toast.message('Offer more than one session length?', {
              action: {
                label: 'Manage durations',
                onClick: () => setDialog({ kind: 'durations', id: type.id }),
              },
            })
          }
        />
      )}
      <TherapyTypeSheet
        open={dialog?.kind === 'edit'}
        onOpenChange={(o) => !o && setDialog(null)}
        type={dialog?.kind === 'edit' ? dialog.type : null}
      />
      <DurationsDialog
        type={durationsType}
        editable={canUpdate}
        onOpenChange={(o) => !o && setDialog(null)}
      />
      <ConfirmDialog
        open={dialog?.kind === 'deactivate'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Deactivate ${dialog?.kind === 'deactivate' ? dialog.type.name : ''}?`}
        description="It won’t be offered for new patients or bookings. Existing records keep it, and you can activate it again at any time."
        confirmLabel="Deactivate"
        loading={setStatusMutation.isPending}
        onConfirm={() => {
          if (dialog?.kind === 'deactivate') changeStatus(dialog.type, false);
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Delete ${dialog?.kind === 'delete' ? dialog.type.name : ''} permanently?`}
        description="This can’t be undone. Therapy types already used by patients, bookings or packages can’t be deleted; deactivate those instead."
        confirmLabel="Delete"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (dialog?.kind !== 'delete') return;
          const { type } = dialog;
          remove.mutate(type.id, {
            onSuccess: () => {
              toast.success(`${type.name} deleted`);
              setDialog(null);
            },
            onError: (e) => {
              if (isApiError(e, 409)) {
                toast.error('This therapy type is in use', {
                  description: e.message,
                  action: canUpdate
                    ? { label: 'Deactivate', onClick: () => changeStatus(type, false) }
                    : undefined,
                });
                setDialog(null);
              } else {
                toast.error(e.message);
              }
            },
          });
        }}
      />
    </RequirePermission>
  );
}
