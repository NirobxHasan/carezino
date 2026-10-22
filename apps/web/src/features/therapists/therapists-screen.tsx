'use client';

import * as React from 'react';
import Link from 'next/link';
import { Stethoscope, UserPlus, UserSearch } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable, type ColumnDef, type SortingState } from '@/components/data-table/data-table';
import { FilterBar, SearchInput } from '@/components/data-table/filter-bar';
import { EmptyState } from '@/components/feedback/states';
import { ColorDot } from '@/components/forms/color-picker';
import { PageHeader } from '@/components/layout/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useGeneralSettings } from '@/lib/api/settings';
import {
  useTherapistList,
  type TherapistListParams,
  type TherapistSortField,
} from '@/lib/api/therapists';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { formatPhone } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session';
import type { TherapistListItem } from '@/lib/types';
import {
  AvailabilitySummary,
  EMPLOYMENT_TYPES,
  SpecializationTags,
  TherapistStatusBadge,
} from './therapist-display';
import { TherapistActionsMenu, therapistLinks, useTherapistDialogs } from './therapist-actions';

const PAGE_SIZE = 10;
const SORTABLE = new Set<string>(['code', 'fullName']);

type Filters = Required<
  Pick<TherapistListParams, 'status' | 'therapyTypeId' | 'employmentType'>
> & { search: string };

const NO_FILTERS: Filters = {
  search: '',
  status: 'all',
  therapyTypeId: 'all',
  employmentType: 'all',
};

function TherapistTable() {
  const { can } = useSession();
  const seesEveryone = can('therapists.read');
  const [filters, setFilters] = React.useState<Filters>(NO_FILTERS);
  const [page, setPage] = React.useState(1);
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'fullName', desc: false }]);
  // A new filter starts from the first page.
  const update = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const search = useDebounced(filters.search);
  const sort = sorting[0];
  const params: TherapistListParams = {
    ...filters,
    search,
    page,
    pageSize: PAGE_SIZE,
    sortBy: (sort?.id ?? 'fullName') as TherapistSortField,
    sortOrder: sort?.desc ? 'desc' : 'asc',
  };
  const { data, isFetching, error, refetch } = useTherapistList(params);
  const types = useTherapyTypeList();
  const general = useGeneralSettings();
  const weekStartsOn = general.data?.weekStartsOn ?? 6;
  const { changeStatus, remove, dialogs } = useTherapistDialogs();
  const filtered =
    Boolean(search) ||
    filters.status !== 'all' ||
    filters.therapyTypeId !== 'all' ||
    filters.employmentType !== 'all';

  const columns = React.useMemo<ColumnDef<TherapistListItem, unknown>[]>(
    () =>
      (
        [
          {
            accessorKey: 'code',
            header: 'ID',
            meta: { className: 'hidden sm:table-cell w-24 tabular whitespace-nowrap' },
            cell: ({ row }) => <span className="text-muted-foreground">{row.original.code}</span>,
          },
          {
            accessorKey: 'fullName',
            header: 'Therapist',
            cell: ({ row }) => {
              const t = row.original;
              return (
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={t.fullName} size="sm" className="hidden sm:inline-grid" />
                  <div className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2">
                      <Link
                        href={therapistLinks.profile(t.id)}
                        className="truncate font-medium hover:underline focus-ring rounded"
                      >
                        {t.fullName}
                      </Link>
                      {t.isYou && <Badge tone="primary">You</Badge>}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      <span className="sm:hidden">{t.code} · </span>
                      {t.designation ?? formatPhone(t.mobile)}
                    </span>
                  </div>
                </div>
              );
            },
          },
          {
            accessorKey: 'mobile',
            header: 'Mobile',
            meta: { className: 'hidden xl:table-cell tabular whitespace-nowrap' },
            cell: ({ row }) => formatPhone(row.original.mobile),
          },
          {
            id: 'specializations',
            header: 'Specializations',
            meta: { className: 'hidden md:table-cell' },
            cell: ({ row }) => (
              <SpecializationTags specializations={row.original.specializations} />
            ),
          },
          {
            accessorKey: 'employmentType',
            header: 'Employment',
            meta: { className: 'hidden 2xl:table-cell whitespace-nowrap' },
            cell: ({ row }) =>
              row.original.employmentType ? (
                EMPLOYMENT_TYPES[row.original.employmentType]
              ) : (
                <span className="text-subtle-foreground">—</span>
              ),
          },
          {
            id: 'availability',
            header: 'Availability',
            meta: { className: 'hidden lg:table-cell' },
            cell: ({ row }) => (
              <AvailabilitySummary
                summary={row.original.availabilitySummary}
                weekStartsOn={weekStartsOn}
              />
            ),
          },
          {
            accessorKey: 'status',
            header: 'Status',
            cell: ({ row }) => <TherapistStatusBadge status={row.original.status} />,
          },
          {
            id: 'actions',
            header: () => <span className="sr-only">Actions</span>,
            meta: { className: 'w-12 text-right' },
            cell: ({ row }) => (
              <TherapistActionsMenu
                therapist={row.original}
                onChangeStatus={changeStatus}
                onDelete={remove}
              />
            ),
          },
        ] satisfies ColumnDef<TherapistListItem, unknown>[]
      ).map((column) => ({
        ...column,
        // Sorted on the server, which knows the whole list.
        enableSorting: SORTABLE.has(('accessorKey' in column && column.accessorKey) || ''),
      })),
    [changeStatus, remove, weekStartsOn],
  );

  return (
    <>
      <PageHeader
        title="Therapists"
        description={
          seesEveryone
            ? data
              ? `${data.total} ${data.total === 1 ? 'therapist' : 'therapists'}${filtered ? ' match' : ''}`
              : 'Your therapy team, their specializations and working hours.'
            : 'Your professional profile at this center.'
        }
        actions={
          can('therapists.create') && (
            <Button asChild>
              <Link href="/therapists/new">
                <UserPlus /> Add therapist
              </Link>
            </Button>
          )
        }
      />
      <DataTable
        label="Therapists"
        columns={columns}
        data={data?.items}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(t) => t.id}
        rowHref={(t) => therapistLinks.profile(t.id)}
        sorting={sorting}
        onSortingChange={(next) => {
          setSorting(next.length ? next : [{ id: 'fullName', desc: false }]);
          setPage(1);
        }}
        pagination={
          data
            ? { page: data.page, pageSize: data.pageSize, total: data.total, onPageChange: setPage }
            : undefined
        }
        toolbar={
          seesEveryone && (
            <FilterBar>
              <SearchInput
                value={filters.search}
                onChange={(search) => update({ search })}
                label="Search therapists"
                placeholder="Search name, ID, mobile or email…"
              />
              <Select
                value={filters.therapyTypeId}
                onValueChange={(therapyTypeId) => update({ therapyTypeId })}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-52"
                  aria-label="Filter by specialization"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All specializations</SelectItem>
                  {types.data?.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <ColorDot color={t.color} />
                        {t.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.status}
                onValueChange={(status) => update({ status: status as Filters['status'] })}
              >
                <SelectTrigger size="sm" className="w-full sm:w-36" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any status</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filters.employmentType}
                onValueChange={(v) => update({ employmentType: v as Filters['employmentType'] })}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-44"
                  aria-label="Filter by employment type"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any employment</SelectItem>
                  {Object.entries(EMPLOYMENT_TYPES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filtered && (
                <Button variant="ghost" size="sm" onClick={() => update(NO_FILTERS)}>
                  Clear filters
                </Button>
              )}
            </FilterBar>
          )
        }
        empty={
          !seesEveryone ? (
            <EmptyState
              icon={UserSearch}
              title="Your therapist profile isn’t linked yet"
              description="Ask a center administrator to link your staff account to your therapist profile."
            />
          ) : filtered ? (
            <EmptyState
              title="No therapists match these filters"
              action={
                <Button variant="secondary" size="sm" onClick={() => update(NO_FILTERS)}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Stethoscope}
              title="No therapists yet"
              description="Add your therapists, the therapies they provide and when they work."
              action={
                can('therapists.create') && (
                  <Button size="sm" asChild>
                    <Link href="/therapists/new">
                      <UserPlus /> Add therapist
                    </Link>
                  </Button>
                )
              }
            />
          )
        }
      />
      {dialogs}
    </>
  );
}

export function TherapistsScreen() {
  return (
    <RequirePermission permission="therapists.read_own">
      <div className="animate-in">
        <TherapistTable />
      </div>
    </RequirePermission>
  );
}
