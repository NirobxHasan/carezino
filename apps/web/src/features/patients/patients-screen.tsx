'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { UserPlus, Users } from 'lucide-react';

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
import { usePatientList, type PatientListParams } from '@/lib/api/patients';
import { useGeneralSettings } from '@/lib/api/settings';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { formatCenterDate, formatPhone } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session';
import type { PatientGender, PatientRecordStatus, PatientSummary } from '@/lib/types';
import { PatientActionsMenu, patientLinks, usePatientDialogs } from './patient-actions';
import {
  PATIENT_GENDERS,
  PATIENT_STATUSES,
  PatientAgeText,
  PatientAvatar,
  PatientStatusBadge,
  TherapyInterestTags,
  relationshipLabel,
} from './patient-display';

const PAGE_SIZES = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 20;

const SORTS = {
  newest: { label: 'Newest registered', sortBy: 'registeredAt', sortOrder: 'desc' },
  oldest: { label: 'Oldest registered', sortBy: 'registeredAt', sortOrder: 'asc' },
  'name-asc': { label: 'Name A–Z', sortBy: 'fullName', sortOrder: 'asc' },
  'name-desc': { label: 'Name Z–A', sortBy: 'fullName', sortOrder: 'desc' },
} as const satisfies Record<
  string,
  { label: string } & Required<Pick<PatientListParams, 'sortBy' | 'sortOrder'>>
>;
type Sort = keyof typeof SORTS;

/** The list's state, kept in the URL: q, status, type, gender, from, to, sort, page, size. */
interface ListState {
  q: string;
  status: PatientRecordStatus | 'all';
  therapyTypeId: string;
  gender: PatientGender | 'all';
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
    status: oneOf(params.get('status'), ['NEW', 'ACTIVE', 'INACTIVE'] as const, 'all'),
    therapyTypeId: params.get('type') ?? 'all',
    gender: oneOf(
      params.get('gender'),
      Object.keys(PATIENT_GENDERS) as PatientGender[],
      'all' as PatientGender | 'all',
    ),
    from: range ? from : '',
    to: range ? to : '',
    sort: oneOf(params.get('sort'), Object.keys(SORTS) as Sort[], 'newest'),
    page: Number.isInteger(page) && page > 1 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

function writeState(state: ListState) {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.status !== 'all') params.set('status', state.status);
  if (state.therapyTypeId !== 'all') params.set('type', state.therapyTypeId);
  if (state.gender !== 'all') params.set('gender', state.gender);
  if (state.from && state.to) {
    params.set('from', state.from);
    params.set('to', state.to);
  }
  if (state.sort !== 'newest') params.set('sort', state.sort);
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

function PatientTable() {
  const { can } = useSession();
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

  const sort = SORTS[state.sort];
  const params: PatientListParams = {
    search: state.q,
    status: state.status,
    therapyTypeId: state.therapyTypeId,
    gender: state.gender,
    registeredFrom: state.from || undefined,
    registeredTo: state.to || undefined,
    sortBy: sort.sortBy,
    sortOrder: sort.sortOrder,
    page: state.page,
    pageSize: state.pageSize,
  };
  const { data, isFetching, error, refetch } = usePatientList(params);
  const types = useTherapyTypeList();
  const general = useGeneralSettings();
  const dateFormat = general.data?.dateFormat;
  const { changeStatus, remove, dialogs } = usePatientDialogs();
  const filtered =
    Boolean(state.q) ||
    state.status !== 'all' ||
    state.therapyTypeId !== 'all' ||
    state.gender !== 'all' ||
    Boolean(state.from);
  const clear = () => {
    setSearch('');
    set({ q: '', status: 'all', therapyTypeId: 'all', gender: 'all', from: '', to: '' });
  };

  const columns = React.useMemo<ColumnDef<PatientSummary, unknown>[]>(
    () => [
      {
        accessorKey: 'code',
        header: 'ID',
        meta: { className: 'hidden sm:table-cell w-24 tabular whitespace-nowrap' },
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.code}</span>,
      },
      {
        accessorKey: 'fullName',
        header: 'Patient',
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <span className="hidden sm:inline-flex">
                <PatientAvatar patient={p} size="sm" />
              </span>
              <div className="flex min-w-0 flex-col">
                <Link
                  href={patientLinks.profile(p.id)}
                  className="truncate rounded font-medium hover:underline focus-ring"
                >
                  {p.fullName}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  <span className="sm:hidden">{p.code} · </span>
                  <span className="lg:hidden">
                    {[
                      p.age && <PatientAgeText key="age" age={p.age} />,
                      p.gender && PATIENT_GENDERS[p.gender],
                    ]
                      .filter(Boolean)
                      .map((part, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && ' · '}
                          {part}
                        </React.Fragment>
                      ))}
                  </span>
                </span>
              </div>
            </div>
          );
        },
      },
      {
        id: 'age',
        header: 'Age',
        meta: { className: 'hidden lg:table-cell whitespace-nowrap' },
        cell: ({ row }) => <PatientAgeText age={row.original.age} />,
      },
      {
        accessorKey: 'gender',
        header: 'Gender',
        meta: { className: 'hidden xl:table-cell whitespace-nowrap' },
        cell: ({ row }) =>
          row.original.gender ? (
            PATIENT_GENDERS[row.original.gender]
          ) : (
            <span className="text-subtle-foreground">—</span>
          ),
      },
      {
        id: 'contact',
        header: 'Primary contact',
        meta: { className: 'hidden md:table-cell' },
        cell: ({ row }) => {
          const c = row.original.primaryContact;
          if (!c) return <span className="text-subtle-foreground">—</span>;
          return (
            <span className="flex min-w-0 flex-col text-[13px]">
              <span className="truncate">{c.type === 'SELF' ? 'Self' : c.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {c.type === 'SELF' ? 'Patient' : relationshipLabel(c)}
                <span className="xl:hidden tabular">
                  {c.mobile && ` · ${formatPhone(c.mobile)}`}
                </span>
              </span>
            </span>
          );
        },
      },
      {
        id: 'mobile',
        header: 'Mobile',
        meta: { className: 'hidden xl:table-cell tabular whitespace-nowrap' },
        cell: ({ row }) => {
          const mobile = row.original.primaryContact?.mobile;
          return mobile ? formatPhone(mobile) : <span className="text-subtle-foreground">—</span>;
        },
      },
      {
        id: 'interests',
        header: 'Therapy interests',
        meta: { className: 'hidden lg:table-cell' },
        cell: ({ row }) => <TherapyInterestTags interests={row.original.therapyInterests} />,
      },
      {
        accessorKey: 'registeredAt',
        header: 'Registered',
        meta: { className: 'hidden 2xl:table-cell whitespace-nowrap tabular' },
        cell: ({ row }) => formatCenterDate(row.original.registeredAt, dateFormat),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <PatientStatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: 'w-12 text-right' },
        cell: ({ row }) => (
          <PatientActionsMenu
            patient={row.original}
            onChangeStatus={changeStatus}
            onDelete={remove}
          />
        ),
      },
    ],
    [changeStatus, remove, dateFormat],
  );

  return (
    <>
      <PageHeader
        title="Patients"
        description={
          data
            ? `${data.total} ${data.total === 1 ? 'patient' : 'patients'}${filtered ? ' match' : ''}`
            : 'Everyone registered at your center, with their contacts.'
        }
        actions={
          can('patients.create') && (
            <Button asChild>
              <Link href={patientLinks.new}>
                <UserPlus /> Add patient
              </Link>
            </Button>
          )
        }
      />
      <DataTable
        label="Patients"
        columns={columns.map((c) => ({ ...c, enableSorting: false }))}
        data={data?.items}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(p) => p.id}
        rowHref={(p) => patientLinks.profile(p.id)}
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
              label="Search patients"
              placeholder="Name, patient ID, guardian or mobile…"
            />
            <Select
              value={state.status}
              onValueChange={(v) => set({ status: v as ListState['status'] })}
            >
              <SelectTrigger size="sm" className="w-full sm:w-36" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                {Object.entries(PATIENT_STATUSES).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={state.therapyTypeId}
              onValueChange={(therapyTypeId) => set({ therapyTypeId })}
            >
              <SelectTrigger size="sm" className="w-full sm:w-52" aria-label="Filter by therapy">
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
            <Select
              value={state.gender}
              onValueChange={(v) => set({ gender: v as ListState['gender'] })}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Filter by gender">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any gender</SelectItem>
                {Object.entries(PATIENT_GENDERS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DateRangePicker
              value={state.from ? { from: state.from, to: state.to } : null}
              onChange={(range) => set({ from: range.from, to: range.to })}
              placeholder="Registered any time"
            />
            <Select value={state.sort} onValueChange={(v) => set({ sort: v as Sort })}>
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Sort patients">
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
              title="No patients match these filters"
              action={
                <Button variant="secondary" size="sm" onClick={clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No patients yet"
              description="Register your first patient with their guardian or their own contact details."
              action={
                can('patients.create') && (
                  <Button size="sm" asChild>
                    <Link href={patientLinks.new}>
                      <UserPlus /> Add patient
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

export function PatientsScreen() {
  return (
    <RequirePermission permission="patients.read">
      <div className="animate-in">
        <PatientTable />
      </div>
    </RequirePermission>
  );
}
