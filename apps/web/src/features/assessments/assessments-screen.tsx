'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ClipboardList,
  ClipboardPlus,
  Ellipsis,
  Eye,
  FilePenLine,
  History,
  Printer,
} from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { FilterBar, SearchInput } from '@/components/data-table/filter-bar';
import { EmptyState } from '@/components/feedback/states';
import { ColorDot } from '@/components/forms/color-picker';
import { DateRangePicker } from '@/components/forms/date-picker';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAssessmentList, type AssessmentListParams } from '@/lib/api/assessments';
import { useTherapistList } from '@/lib/api/therapists';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session';
import type { AssessmentItem, AssessmentKind, AssessmentRecordStatus } from '@/lib/types';
import { TherapyTypeChip, useCenterFormat } from '../appointments/appointment-display';
import {
  ASSESSMENT_KINDS,
  ASSESSMENT_STATUSES,
  AssessmentStatusBadge,
  TemplateLabel,
  assessmentLinks,
} from './assessment-display';

const PAGE_SIZES = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 20;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The list's state, kept in the URL so it survives reloads and can be shared. */
interface ListState {
  q: string;
  therapistId: string;
  therapyTypeId: string;
  type: AssessmentKind | 'all';
  status: AssessmentRecordStatus | 'all';
  from: string;
  to: string;
  page: number;
  pageSize: number;
}

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
    type: oneOf(
      params.get('type'),
      Object.keys(ASSESSMENT_KINDS) as AssessmentKind[],
      'all' as const,
    ),
    status: oneOf(
      params.get('status'),
      Object.keys(ASSESSMENT_STATUSES) as AssessmentRecordStatus[],
      'all' as const,
    ),
    from: range ? from : '',
    to: range ? to : '',
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
      const next = { ...state, ...('page' in patch ? {} : { page: 1 }), ...patch };
      const q = writeState(next);
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [state, router, pathname],
  );
  return [state, set] as const;
}

/** View, continue, print and amend, as the API says this caller may. */
export function AssessmentActionsMenu({ assessment: a }: { assessment: AssessmentItem }) {
  const { actions } = a;
  if (!actions.view) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${a.patient.fullName}’s assessment`}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={assessmentLinks.detail(a.id)}>
            {actions.edit ? <FilePenLine /> : <Eye />}
            {actions.edit ? 'Continue draft' : 'View'}
          </Link>
        </DropdownMenuItem>
        {a.status !== 'DRAFT' && (
          <DropdownMenuItem asChild>
            <Link href={assessmentLinks.print(a.id)}>
              <Printer /> Print summary
            </Link>
          </DropdownMenuItem>
        )}
        {actions.amend && (
          <DropdownMenuItem asChild>
            <Link href={`${assessmentLinks.detail(a.id)}?amend=1`}>
              <History /> Amend
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function assessmentColumns({
  fmt,
  showPatient = true,
  showTherapist = true,
}: {
  fmt: ReturnType<typeof useCenterFormat>;
  showPatient?: boolean;
  showTherapist?: boolean;
}): ColumnDef<AssessmentItem, unknown>[] {
  return [
    {
      id: 'date',
      header: 'Date',
      meta: { className: 'whitespace-nowrap tabular' },
      cell: ({ row }) => {
        const a = row.original;
        const date = fmt.date(a.assessmentDate);
        return a.actions.view ? (
          <Link
            href={assessmentLinks.detail(a.id)}
            className="rounded font-medium hover:underline focus-ring"
          >
            {date}
          </Link>
        ) : (
          <span className="font-medium">{date}</span>
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
          } satisfies ColumnDef<AssessmentItem, unknown>,
        ]
      : []),
    {
      id: 'therapy',
      header: 'Therapy',
      cell: ({ row }) => (
        <span className="flex flex-col gap-0.5">
          <TherapyTypeChip therapyType={row.original.therapyType} />
          <span className="text-xs text-muted-foreground">
            {ASSESSMENT_KINDS[row.original.type]}
          </span>
        </span>
      ),
    },
    ...(showTherapist
      ? [
          {
            id: 'therapist',
            header: 'Therapist',
            meta: { className: 'hidden md:table-cell' },
            cell: ({ row }) => (
              <span className="truncate">
                {row.original.therapist.fullName}
                {row.original.therapist.isYou && (
                  <span className="text-muted-foreground"> (you)</span>
                )}
              </span>
            ),
          } satisfies ColumnDef<AssessmentItem, unknown>,
        ]
      : []),
    {
      id: 'template',
      header: 'Template',
      meta: { className: 'hidden lg:table-cell max-w-56' },
      cell: ({ row }) => <TemplateLabel template={row.original.template} />,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <span className="flex flex-col items-start gap-1">
          <AssessmentStatusBadge status={row.original.status} />
          {row.original.amendmentCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {row.original.amendmentCount} amendment
              {row.original.amendmentCount === 1 ? '' : 's'}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: { className: 'w-12 text-right' },
      cell: ({ row }) => <AssessmentActionsMenu assessment={row.original} />,
    },
  ];
}

function AssessmentTable() {
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
  const [shownQ, setShownQ] = React.useState(state.q);
  if (shownQ !== state.q) {
    setShownQ(state.q);
    if (debounced.trim() === search.trim()) setSearch(state.q);
  }

  const params: AssessmentListParams = {
    search: state.q,
    therapistId: state.therapistId === 'all' ? undefined : state.therapistId,
    therapyTypeId: state.therapyTypeId === 'all' ? undefined : state.therapyTypeId,
    type: state.type === 'all' ? undefined : state.type,
    status: state.status === 'all' ? undefined : [state.status],
    from: state.from || undefined,
    to: state.to || undefined,
    page: state.page,
    pageSize: state.pageSize,
  };
  const { data, isFetching, error, refetch } = useAssessmentList(params);
  const types = useTherapyTypeList({ status: 'all' });
  const seesTeam =
    (can('assessments.read') || can('assessments.read_status')) && can('therapists.read');
  const therapists = useTherapistList(
    { status: 'all', pageSize: 100, sortBy: 'fullName' },
    seesTeam,
  );

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
    () => assessmentColumns({ fmt, showTherapist: seesTeam }),
    [fmt, seesTeam],
  );
  const create = can('assessments.create') && (
    <Button asChild>
      <Link href={assessmentLinks.create()}>
        <ClipboardPlus /> New assessment
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Assessments"
        description={
          data
            ? `${data.total} ${data.total === 1 ? 'assessment' : 'assessments'}${filtered ? ' match' : ''}`
            : 'Initial assessments, follow-ups and reassessments.'
        }
        actions={create}
      />
      <DataTable
        label="Assessments"
        columns={columns}
        data={data?.items}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(a) => a.id}
        rowHref={(a) => (a.actions.view ? assessmentLinks.detail(a.id) : null)}
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
              label="Search assessments"
              placeholder="Patient, patient ID or therapist…"
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
              <SelectTrigger size="sm" className="w-full sm:w-48" aria-label="Filter by type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any type</SelectItem>
                {Object.entries(ASSESSMENT_KINDS).map(([value, label]) => (
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
                {Object.entries(ASSESSMENT_STATUSES).map(([value, s]) => (
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
              title="No assessments match these filters"
              action={
                <Button variant="secondary" size="sm" onClick={clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ClipboardList}
              title="No assessments yet"
              description="Start one from an assessment appointment, a patient’s profile or here."
              action={create}
            />
          )
        }
      />
    </>
  );
}

export function AssessmentsScreen() {
  return (
    <RequirePermission permission="assessments.read_own">
      <div className="animate-in">
        <AssessmentTable />
      </div>
    </RequirePermission>
  );
}
