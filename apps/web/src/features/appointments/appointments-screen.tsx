'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, CalendarPlus } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { FilterBar, SearchInput } from '@/components/data-table/filter-bar';
import { EmptyState } from '@/components/feedback/states';
import { ColorDot } from '@/components/forms/color-picker';
import { DateRangePicker } from '@/components/forms/date-picker';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAppointmentList, type AppointmentListParams } from '@/lib/api/appointments';
import { useTherapistList } from '@/lib/api/therapists';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session';
import { formatMinutes } from '@/lib/settings-limits';
import type { AppointmentItem, AppointmentRecordStatus, AppointmentType } from '@/lib/types';
import { AppointmentActionsMenu, useAppointmentDialogs } from './appointment-actions';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  AppointmentStatusBadge,
  AppointmentTypeLabel,
  RecurringMark,
  TherapyTypeChip,
  appointmentLinks,
  statusBlockClass,
  useCenterFormat,
} from './appointment-display';

const PAGE_SIZES = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 20;

const SORTS = {
  upcoming: { label: 'Upcoming first' },
  newest: { label: 'Newest first' },
  oldest: { label: 'Oldest first' },
} as const;
type Sort = keyof typeof SORTS;

/** The list's state, kept in the URL so it survives reloads and can be shared. */
interface ListState {
  q: string;
  therapistId: string;
  therapyTypeId: string;
  type: AppointmentType | 'all';
  status: AppointmentRecordStatus | 'all';
  from: string;
  to: string;
  sort: Sort;
  page: number;
  pageSize: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T) {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readState(params: URLSearchParams): ListState {
  const page = Number(params.get('page'));
  const size = Number(params.get('size'));
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const range = ISO_DATE.test(from) && ISO_DATE.test(to);
  return {
    q: params.get('q') ?? '',
    therapistId: params.get('therapist') ?? 'all',
    therapyTypeId: params.get('therapy') ?? 'all',
    type: oneOf(params.get('type'), ['ASSESSMENT', 'THERAPY_SESSION'] as const, 'all'),
    status: oneOf(
      params.get('status'),
      Object.keys(APPOINTMENT_STATUSES) as AppointmentRecordStatus[],
      'all' as AppointmentRecordStatus | 'all',
    ),
    from: range ? from : '',
    to: range ? to : '',
    sort: oneOf(params.get('sort'), Object.keys(SORTS) as Sort[], 'upcoming'),
    page: Number.isInteger(page) && page > 1 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

function writeState(state: ListState) {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.therapistId !== 'all') params.set('therapist', state.therapistId);
  if (state.therapyTypeId !== 'all') params.set('therapy', state.therapyTypeId);
  if (state.type !== 'all') params.set('type', state.type);
  if (state.status !== 'all') params.set('status', state.status);
  if (state.from && state.to) {
    params.set('from', state.from);
    params.set('to', state.to);
  }
  if (state.sort !== 'upcoming') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  if (state.pageSize !== DEFAULT_PAGE_SIZE) params.set('size', String(state.pageSize));
  return params.toString();
}

function useListState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = React.useMemo(() => readState(new URLSearchParams(searchParams)), [searchParams]);
  const set = React.useCallback(
    (patch: Partial<ListState>) => {
      // Any change other than paging starts again from the first page.
      const next = { ...state, ...('page' in patch ? {} : { page: 1 }), ...patch };
      const q = writeState(next);
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [state, router, pathname],
  );
  return [state, set] as const;
}

/** Upcoming first shows what's ahead, soonest first; the others list everything by date. */
function sortParams(sort: Sort): Pick<AppointmentListParams, 'timeframe' | 'sortOrder'> {
  if (sort === 'upcoming') return { timeframe: 'upcoming', sortOrder: 'asc' };
  return { sortOrder: sort === 'newest' ? 'desc' : 'asc' };
}

export function appointmentColumns({
  fmt,
  onAction,
  showPatient = true,
  showTherapist = true,
}: {
  fmt: ReturnType<typeof useCenterFormat>;
  onAction: React.ComponentProps<typeof AppointmentActionsMenu>['onAction'];
  showPatient?: boolean;
  showTherapist?: boolean;
}): ColumnDef<AppointmentItem, unknown>[] {
  return [
    {
      id: 'when',
      header: 'Date & time',
      meta: { className: 'whitespace-nowrap tabular' },
      cell: ({ row }) => {
        const a = row.original;
        return (
          <span className={statusBlockClass(a.status)}>
            <Link
              href={appointmentLinks.detail(a.id)}
              className="inline-flex items-center gap-1.5 rounded font-medium hover:underline focus-ring"
            >
              {fmt.shortDate(a.date)}
              {a.seriesId && <RecurringMark />}
            </Link>
            <span className="block text-xs text-muted-foreground">{fmt.range(a)}</span>
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
          } satisfies ColumnDef<AppointmentItem, unknown>,
        ]
      : []),
    {
      id: 'type',
      header: 'Type',
      meta: { className: 'hidden md:table-cell whitespace-nowrap' },
      cell: ({ row }) => <AppointmentTypeLabel type={row.original.type} />,
    },
    {
      id: 'therapy',
      header: 'Therapy',
      meta: { className: 'hidden sm:table-cell' },
      cell: ({ row }) => <TherapyTypeChip therapyType={row.original.therapyType} />,
    },
    ...(showTherapist
      ? [
          {
            id: 'therapist',
            header: 'Therapist',
            meta: { className: 'hidden lg:table-cell' },
            cell: ({ row }) => (
              <span className="truncate">
                {row.original.therapist.fullName}
                {row.original.therapist.isYou && (
                  <span className="text-muted-foreground"> (you)</span>
                )}
              </span>
            ),
          } satisfies ColumnDef<AppointmentItem, unknown>,
        ]
      : []),
    {
      id: 'duration',
      header: 'Length',
      meta: { className: 'hidden xl:table-cell whitespace-nowrap tabular' },
      cell: ({ row }) => formatMinutes(row.original.durationMinutes),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <span className="flex flex-col items-start gap-1">
          <AppointmentStatusBadge status={row.original.status} />
          {row.original.lateCancellation && (
            <span className="text-xs text-muted-foreground">Late cancellation</span>
          )}
          {/* The patient has arrived for an appointment that's still open. */}
          {row.original.attendance.checkInTime &&
            (row.original.status === 'SCHEDULED' || row.original.status === 'CONFIRMED') && (
              <span className="text-xs font-medium text-success-foreground tabular">
                Arrived {fmt.clock(row.original.attendance.checkInTime)}
              </span>
            )}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: { className: 'w-12 text-right' },
      cell: ({ row }) => <AppointmentActionsMenu appointment={row.original} onAction={onAction} />,
    },
  ];
}

function AppointmentTable() {
  const { can } = useSession();
  const fmt = useCenterFormat();
  const [state, set] = useListState();
  // Typing updates the box at once and the URL (and request) once it settles.
  const [search, setSearch] = React.useState(state.q);
  const debounced = useDebounced(search, 300);
  React.useEffect(() => {
    if (debounced.trim() !== state.q.trim()) set({ q: debounced });
    // Only when the typed value settles, not when the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  // Back/forward or "Clear filters" can change the URL under the box.
  const [shownQ, setShownQ] = React.useState(state.q);
  if (shownQ !== state.q) {
    setShownQ(state.q);
    if (debounced.trim() === search.trim()) setSearch(state.q);
  }

  const params: AppointmentListParams = {
    search: state.q,
    therapistId: state.therapistId === 'all' ? undefined : state.therapistId,
    therapyTypeId: state.therapyTypeId === 'all' ? undefined : state.therapyTypeId,
    type: state.type === 'all' ? undefined : state.type,
    status: state.status === 'all' ? undefined : [state.status],
    from: state.from || undefined,
    to: state.to || undefined,
    ...sortParams(state.sort),
    page: state.page,
    pageSize: state.pageSize,
  };
  const { data, isFetching, error, refetch } = useAppointmentList(params);
  const types = useTherapyTypeList({ status: 'all' });
  const seesTeam = can('appointments.read') && can('therapists.read');
  const therapists = useTherapistList(
    { status: 'all', pageSize: 100, sortBy: 'fullName' },
    seesTeam,
  );
  const { open, dialogs } = useAppointmentDialogs();

  const filtered =
    Boolean(state.q) ||
    state.therapistId !== 'all' ||
    state.therapyTypeId !== 'all' ||
    state.type !== 'all' ||
    state.status !== 'all' ||
    Boolean(state.from);
  const clear = () => {
    setSearch('');
    set({
      q: '',
      therapistId: 'all',
      therapyTypeId: 'all',
      type: 'all',
      status: 'all',
      from: '',
      to: '',
    });
  };

  const columns = React.useMemo(
    () => appointmentColumns({ fmt, onAction: open, showTherapist: seesTeam }),
    [fmt, open, seesTeam],
  );

  return (
    <>
      <PageHeader
        title="Appointments"
        description={
          data
            ? `${data.total} ${data.total === 1 ? 'appointment' : 'appointments'}${
                state.sort === 'upcoming' ? ' coming up' : ''
              }${filtered ? ' match' : ''}`
            : 'Assessments and therapy sessions, booked and past.'
        }
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href={appointmentLinks.calendar}>
                <CalendarDays /> Calendar
              </Link>
            </Button>
            {can('appointments.create') && (
              <Button asChild>
                <Link href={appointmentLinks.book()}>
                  <CalendarPlus /> Book appointment
                </Link>
              </Button>
            )}
          </>
        }
      />
      <DataTable
        label="Appointments"
        columns={columns}
        data={data?.items}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(a) => a.id}
        rowHref={(a) => appointmentLinks.detail(a.id)}
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
              label="Search appointments"
              placeholder="Patient, patient ID, mobile or therapist…"
            />
            {seesTeam && (
              <Select
                value={state.therapistId}
                onValueChange={(therapistId) => set({ therapistId })}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-44"
                  aria-label="Filter by therapist"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All therapists</SelectItem>
                  {therapists.data?.items.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              value={state.therapyTypeId}
              onValueChange={(therapyTypeId) => set({ therapyTypeId })}
            >
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Filter by therapy">
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
            <Select value={state.type} onValueChange={(v) => set({ type: v as ListState['type'] })}>
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Filter by type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any type</SelectItem>
                {Object.entries(APPOINTMENT_TYPES).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={state.status}
              onValueChange={(v) => set({ status: v as ListState['status'] })}
            >
              <SelectTrigger size="sm" className="w-full sm:w-36" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                {Object.entries(APPOINTMENT_STATUSES).map(([value, s]) => (
                  <SelectItem key={value} value={value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DateRangePicker
              value={state.from ? { from: state.from, to: state.to } : null}
              onChange={(range) => set({ from: range.from, to: range.to })}
              placeholder="Any date"
            />
            <Select value={state.sort} onValueChange={(v) => set({ sort: v as Sort })}>
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Sort appointments">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SORTS).map(([value, s]) => (
                  <SelectItem key={value} value={value}>
                    {s.label}
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
              title="No appointments match these filters"
              action={
                <Button variant="secondary" size="sm" onClick={clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={CalendarDays}
              title={state.sort === 'upcoming' ? 'Nothing coming up' : 'No appointments yet'}
              description={
                state.sort === 'upcoming'
                  ? 'Upcoming appointments appear here. Choose “Newest first” to see past ones.'
                  : 'Book an assessment or therapy session to get started.'
              }
              action={
                can('appointments.create') && (
                  <Button size="sm" asChild>
                    <Link href={appointmentLinks.book()}>
                      <CalendarPlus /> Book appointment
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

export function AppointmentsScreen() {
  return (
    <RequirePermission permission="appointments.read_own">
      <div className="animate-in">
        <AppointmentTable />
      </div>
    </RequirePermission>
  );
}
