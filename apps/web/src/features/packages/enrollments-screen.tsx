'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Ban, Ellipsis, Eye, Plus, RefreshCw, SlidersHorizontal, Ticket } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { FilterBar, SearchInput } from '@/components/data-table/filter-bar';
import { EmptyState } from '@/components/feedback/states';
import { ColorDot } from '@/components/forms/color-picker';
import { DateRangePicker } from '@/components/forms/date-picker';
import { PageHeader } from '@/components/layout/page-header';
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
import {
  useEnrollmentList,
  usePackageList,
  type EnrollmentListParams,
  type EnrollmentSort,
} from '@/lib/api/packages';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session';
import type { EnrollmentItem, EnrollmentStatus } from '@/lib/types';
import { TherapyTypeChip, useCenterFormat } from '../appointments/appointment-display';
import {
  ENROLLMENT_STATUSES,
  EnrollmentStatusBadge,
  SessionMeter,
  formatMoney,
  packageLinks,
} from './package-display';
import { PackagesNav } from './packages-screen';

const PAGE_SIZES = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 20;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A status, or "expiring soon": active and ending within a week. */
type StatusFilter = EnrollmentStatus | 'EXPIRING_SOON' | 'all';

const SORTS: Record<EnrollmentSort, string> = {
  createdAt: 'Recently enrolled',
  endDate: 'Expiring first',
  patientName: 'Patient name',
};

interface ListState {
  q: string;
  packageId: string;
  therapyTypeId: string;
  status: StatusFilter;
  startFrom: string;
  startTo: string;
  endFrom: string;
  endTo: string;
  sort: EnrollmentSort;
  page: number;
  pageSize: number;
}

function readState(params: URLSearchParams): ListState {
  const page = Number(params.get('page'));
  const size = Number(params.get('size'));
  const range = (a: string, b: string) => {
    const from = params.get(a) ?? '';
    const to = params.get(b) ?? '';
    return ISO_DATE.test(from) && ISO_DATE.test(to) ? [from, to] : ['', ''];
  };
  const [startFrom, startTo] = range('startFrom', 'startTo');
  const [endFrom, endTo] = range('endFrom', 'endTo');
  const status = params.get('status') ?? '';
  const sort = params.get('sort') ?? '';
  return {
    q: params.get('q') ?? '',
    packageId: params.get('package') ?? 'all',
    therapyTypeId: params.get('therapy') ?? 'all',
    status:
      status in ENROLLMENT_STATUSES || status === 'EXPIRING_SOON'
        ? (status as StatusFilter)
        : 'all',
    startFrom,
    startTo,
    endFrom,
    endTo,
    sort: sort in SORTS ? (sort as EnrollmentSort) : 'createdAt',
    page: Number.isInteger(page) && page > 1 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

function writeState(s: ListState) {
  const q = new URLSearchParams();
  if (s.q.trim()) q.set('q', s.q.trim());
  if (s.packageId !== 'all') q.set('package', s.packageId);
  if (s.therapyTypeId !== 'all') q.set('therapy', s.therapyTypeId);
  if (s.status !== 'all') q.set('status', s.status);
  if (s.startFrom) {
    q.set('startFrom', s.startFrom);
    q.set('startTo', s.startTo);
  }
  if (s.endFrom) {
    q.set('endFrom', s.endFrom);
    q.set('endTo', s.endTo);
  }
  if (s.sort !== 'createdAt') q.set('sort', s.sort);
  if (s.page > 1) q.set('page', String(s.page));
  if (s.pageSize !== DEFAULT_PAGE_SIZE) q.set('size', String(s.pageSize));
  return q.toString();
}

function useListState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = React.useMemo(() => readState(new URLSearchParams(searchParams)), [searchParams]);
  const set = React.useCallback(
    (patch: Partial<ListState>) => {
      const next = { ...state, ...('page' in patch ? {} : { page: 1 }), ...patch };
      const q = writeState(next);
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [state, router, pathname],
  );
  return [state, set] as const;
}

/** What the caller may do with an enrollment from a list. */
export function EnrollmentActionsMenu({ enrollment: e }: { enrollment: EnrollmentItem }) {
  const { actions } = e;
  const go = (action: string) => `${packageLinks.enrollment(e.id)}?action=${action}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${e.code}`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={packageLinks.enrollment(e.id)}>
            <Eye /> View enrollment
          </Link>
        </DropdownMenuItem>
        {actions.renew && (
          <DropdownMenuItem asChild>
            <Link href={packageLinks.enroll({ renew: e.id })}>
              <RefreshCw /> Renew package
            </Link>
          </DropdownMenuItem>
        )}
        {actions.adjust && (
          <DropdownMenuItem asChild>
            <Link href={go('adjust')}>
              <SlidersHorizontal /> Adjust sessions
            </Link>
          </DropdownMenuItem>
        )}
        {actions.cancel && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild tone="danger">
              <Link href={go('cancel')}>
                <Ban /> Cancel enrollment
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "12 Nov 2026" with "5 days left" or "Expired" under it. */
export function ExpiryCell({
  enrollment: e,
  date,
}: {
  enrollment: EnrollmentItem;
  date: (d: string) => string;
}) {
  if (!e.endDate) {
    return <span className="text-[13px] text-subtle-foreground">From first session</span>;
  }
  const open = e.status === 'ACTIVE' || e.status === 'PENDING';
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="tabular">{date(e.endDate)}</span>
      {e.expiringSoon ? (
        <Badge tone="warning">
          {e.daysLeft === 0 ? 'Last day' : `${e.daysLeft} day${e.daysLeft === 1 ? '' : 's'} left`}
        </Badge>
      ) : open && e.daysLeft !== null && e.status === 'ACTIVE' ? (
        <span className="text-xs text-muted-foreground">{e.daysLeft} days left</span>
      ) : null}
    </span>
  );
}

export function enrollmentColumns({
  fmt,
  showPatient = true,
}: {
  fmt: ReturnType<typeof useCenterFormat>;
  showPatient?: boolean;
}): ColumnDef<EnrollmentItem, unknown>[] {
  return [
    {
      id: 'enrollment',
      header: 'Enrollment',
      cell: ({ row }) => {
        const e = row.original;
        return (
          <span className="flex min-w-0 flex-col">
            <Link
              href={packageLinks.enrollment(e.id)}
              className="truncate rounded font-medium hover:underline focus-ring"
            >
              {e.package.name}
            </Link>
            <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              <span className="tabular">{e.code}</span>
              <span className="tabular">{formatMoney(e.finalPrice, e.currency)}</span>
            </span>
          </span>
        );
      },
    },
    ...(showPatient
      ? [
          {
            id: 'patient',
            header: 'Patient',
            cell: ({ row }) => (
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{row.original.patient.fullName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {row.original.patient.code}
                </span>
              </span>
            ),
          } satisfies ColumnDef<EnrollmentItem, unknown>,
        ]
      : []),
    {
      id: 'therapies',
      header: 'Therapies',
      meta: { className: 'hidden lg:table-cell' },
      cell: ({ row }) => (
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {row.original.therapyTypes.map((t) => (
            <TherapyTypeChip key={t.id} therapyType={t} />
          ))}
        </span>
      ),
    },
    {
      id: 'start',
      header: 'Start',
      meta: { className: 'hidden xl:table-cell whitespace-nowrap tabular' },
      cell: ({ row }) =>
        row.original.startDate ? (
          fmt.date(row.original.startDate)
        ) : (
          <span className="text-subtle-foreground">—</span>
        ),
    },
    {
      id: 'expires',
      header: 'Expires',
      meta: { className: 'whitespace-nowrap' },
      cell: ({ row }) => <ExpiryCell enrollment={row.original} date={fmt.date} />,
    },
    {
      id: 'sessions',
      header: 'Sessions',
      cell: ({ row }) => {
        const s = row.original.sessions;
        return (
          <span className="flex flex-col gap-1">
            <SessionMeter sessions={s} />
            <span className="text-xs text-muted-foreground tabular">
              {s.consumed} used{s.reserved ? ` · ${s.reserved} booked` : ''}
            </span>
          </span>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <EnrollmentStatusBadge status={row.original.status} />,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: { className: 'w-12 text-right' },
      cell: ({ row }) => <EnrollmentActionsMenu enrollment={row.original} />,
    },
  ];
}

function EnrollmentTable() {
  const { can } = useSession();
  const fmt = useCenterFormat();
  const [state, set] = useListState();
  const [search, setSearch] = React.useState(state.q);
  const debounced = useDebounced(search, 300);
  React.useEffect(() => {
    if (debounced.trim() !== state.q.trim()) set({ q: debounced });
    // Only when the typed value settles, not when the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const params: EnrollmentListParams = {
    search: state.q,
    packageId: state.packageId === 'all' ? undefined : state.packageId,
    therapyTypeId: state.therapyTypeId === 'all' ? undefined : state.therapyTypeId,
    status: state.status === 'all' || state.status === 'EXPIRING_SOON' ? undefined : [state.status],
    expiringSoon: state.status === 'EXPIRING_SOON' || undefined,
    startFrom: state.startFrom || undefined,
    startTo: state.startTo || undefined,
    endFrom: state.endFrom || undefined,
    endTo: state.endTo || undefined,
    sortBy: state.sort,
    page: state.page,
    pageSize: state.pageSize,
  };
  const { data, isFetching, error, refetch } = useEnrollmentList(params);
  const packages = usePackageList({ status: 'all', pageSize: 100, sortBy: 'name' });
  const types = useTherapyTypeList({ status: 'all' });

  const filtered =
    Boolean(state.q) ||
    state.packageId !== 'all' ||
    state.therapyTypeId !== 'all' ||
    state.status !== 'all' ||
    Boolean(state.startFrom) ||
    Boolean(state.endFrom);
  const clear = () => {
    setSearch('');
    set({
      q: '',
      packageId: 'all',
      therapyTypeId: 'all',
      status: 'all',
      startFrom: '',
      startTo: '',
      endFrom: '',
      endTo: '',
    });
  };
  const columns = React.useMemo(() => enrollmentColumns({ fmt }), [fmt]);
  const create = can('package_enrollments.create') && (
    <Button asChild>
      <Link href={packageLinks.enroll()}>
        <Plus /> Enroll patient
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Therapy packages"
        description={
          data
            ? `${data.total} ${data.total === 1 ? 'enrollment' : 'enrollments'}${filtered ? ' match' : ''}`
            : 'Packages patients have bought, with what’s left of them.'
        }
        actions={create}
      />
      <PackagesNav current="enrollments" />
      <DataTable
        label="Package enrollments"
        columns={columns}
        data={data?.items}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(e) => e.id}
        rowHref={(e) => packageLinks.enrollment(e.id)}
        pagination={
          data
            ? {
                page: data.page,
                pageSize: data.pageSize,
                total: data.total,
                onPageChange: (page) => set({ page }),
                pageSizeOptions: PAGE_SIZES,
                onPageSizeChange: (pageSize) => set({ pageSize }),
              }
            : undefined
        }
        toolbar={
          <FilterBar>
            <SearchInput
              value={search}
              onChange={setSearch}
              label="Search enrollments"
              placeholder="Patient, patient ID, guardian mobile, package or enrollment ID…"
            />
            <Select value={state.packageId} onValueChange={(packageId) => set({ packageId })}>
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Filter by package">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All packages</SelectItem>
                {packages.data?.items.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={state.therapyTypeId}
              onValueChange={(therapyTypeId) => set({ therapyTypeId })}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Filter by therapy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All therapies</SelectItem>
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
            <Select value={state.status} onValueChange={(v) => set({ status: v as StatusFilter })}>
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="EXPIRING_SOON">Expiring within a week</SelectItem>
                {Object.entries(ENROLLMENT_STATUSES).map(([value, s]) => (
                  <SelectItem key={value} value={value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DateRangePicker
              value={state.startFrom ? { from: state.startFrom, to: state.startTo } : null}
              onChange={(r) => set({ startFrom: r.from, startTo: r.to })}
              placeholder="Any start date"
            />
            <DateRangePicker
              value={state.endFrom ? { from: state.endFrom, to: state.endTo } : null}
              onChange={(r) => set({ endFrom: r.from, endTo: r.to })}
              placeholder="Any expiry date"
            />
            <Select value={state.sort} onValueChange={(v) => set({ sort: v as EnrollmentSort })}>
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Sort by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SORTS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filtered && (
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear filters
              </Button>
            )}
          </FilterBar>
        }
        empty={
          filtered ? (
            <EmptyState
              title="No enrollments match these filters"
              action={
                <Button variant="secondary" size="sm" onClick={clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Ticket}
              title="No patients enrolled yet"
              description="Enroll a patient in a package from here or from their profile."
              action={create}
            />
          )
        }
      />
    </>
  );
}

export function EnrollmentsScreen() {
  return (
    <RequirePermission permission="package_enrollments.read">
      <div className="animate-in">
        <EnrollmentTable />
      </div>
    </RequirePermission>
  );
}
