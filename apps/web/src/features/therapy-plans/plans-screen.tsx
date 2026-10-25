'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Ban,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  ClipboardCheck,
  Ellipsis,
  Eye,
  FilePenLine,
  LineChart,
  ListChecks,
  Plus,
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
  usePlanList,
  type PlanListParams,
  type PlanSort,
  type ReviewDueFilter,
} from '@/lib/api/therapy-plans';
import { useTherapistList } from '@/lib/api/therapists';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session';
import type { TherapyPlanItem, TherapyPlanStatus } from '@/lib/types';
import { TherapyTypeChip, useCenterFormat } from '../appointments/appointment-display';
import {
  PLAN_STATUSES,
  PlanStatusBadge,
  ReviewDueBadge,
  describeFrequency,
  planLinks,
} from './plan-display';

const PAGE_SIZES = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 20;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const REVIEW_DUE: Record<ReviewDueFilter, string> = {
  OVERDUE: 'Review overdue',
  NEXT_7_DAYS: 'Review due in 7 days',
  NEXT_30_DAYS: 'Review due in 30 days',
};

const SORTS: Record<PlanSort, string> = {
  createdAt: 'Recently created',
  updatedAt: 'Recently updated',
  nextReviewDate: 'Upcoming review',
  patientName: 'Patient name',
};

/** The list's state, kept in the URL so it survives reloads and can be shared. */
interface ListState {
  q: string;
  therapistId: string;
  therapyTypeId: string;
  status: TherapyPlanStatus | 'all';
  reviewDue: ReviewDueFilter | 'all';
  from: string;
  to: string;
  sort: PlanSort;
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
    status: oneOf(
      params.get('status'),
      Object.keys(PLAN_STATUSES) as TherapyPlanStatus[],
      'all' as const,
    ),
    reviewDue: oneOf(
      params.get('review'),
      Object.keys(REVIEW_DUE) as ReviewDueFilter[],
      'all' as const,
    ),
    from: range ? from : '',
    to: range ? to : '',
    sort: oneOf(params.get('sort'), Object.keys(SORTS) as PlanSort[], 'createdAt'),
    page: Number.isInteger(page) && page > 1 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

function writeState(state: ListState) {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.therapistId !== 'all') params.set('therapist', state.therapistId);
  if (state.therapyTypeId !== 'all') params.set('therapy', state.therapyTypeId);
  if (state.status !== 'all') params.set('status', state.status);
  if (state.reviewDue !== 'all') params.set('review', state.reviewDue);
  if (state.from && state.to) {
    params.set('from', state.from);
    params.set('to', state.to);
  }
  if (state.sort !== 'createdAt') params.set('sort', state.sort);
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

/** What the caller may do with a plan from a list, as the API says. */
export function PlanActionsMenu({ plan: p }: { plan: TherapyPlanItem }) {
  const { actions } = p;
  const lifecycle = actions.pause || actions.resume || actions.complete || actions.discontinue;
  if (!actions.view && !actions.reassign) return null;
  const go = (action: string) => `${planLinks.detail(p.id)}?action=${action}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.code}`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={planLinks.detail(p.id)}>
            <Eye /> View plan
          </Link>
        </DropdownMenuItem>
        {actions.edit && (
          <DropdownMenuItem asChild>
            <Link href={planLinks.edit(p.id)}>
              <FilePenLine /> Edit draft
            </Link>
          </DropdownMenuItem>
        )}
        {actions.recordProgress && (
          <DropdownMenuItem asChild>
            <Link href={planLinks.detail(p.id)}>
              <LineChart /> Record progress
            </Link>
          </DropdownMenuItem>
        )}
        {actions.review && (
          <DropdownMenuItem asChild>
            <Link href={planLinks.review(p.id)}>
              <ClipboardCheck /> Review plan
            </Link>
          </DropdownMenuItem>
        )}
        {lifecycle && <DropdownMenuSeparator />}
        {actions.pause && (
          <DropdownMenuItem asChild>
            <Link href={go('pause')}>
              <CirclePause /> Pause
            </Link>
          </DropdownMenuItem>
        )}
        {actions.resume && (
          <DropdownMenuItem asChild>
            <Link href={go('resume')}>
              <CirclePlay /> Resume
            </Link>
          </DropdownMenuItem>
        )}
        {actions.complete && (
          <DropdownMenuItem asChild>
            <Link href={go('complete')}>
              <CheckCircle2 /> Complete
            </Link>
          </DropdownMenuItem>
        )}
        {actions.discontinue && (
          <DropdownMenuItem asChild tone="danger">
            <Link href={go('discontinue')}>
              <Ban /> Discontinue
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Goal counts as "2 of 4 achieved", or nothing without clinical access. */
export function GoalSummary({ summary }: { summary: TherapyPlanItem['goalSummary'] }) {
  if (!summary) return null;
  if (!summary.total) return <span className="text-xs text-subtle-foreground">No goals yet</span>;
  return (
    <span className="text-xs text-muted-foreground tabular">
      {summary.ACHIEVED} of {summary.total} goal{summary.total === 1 ? '' : 's'} achieved
    </span>
  );
}

export function planColumns({
  fmt,
  showPatient = true,
  showTherapist = true,
}: {
  fmt: ReturnType<typeof useCenterFormat>;
  showPatient?: boolean;
  showTherapist?: boolean;
}): ColumnDef<TherapyPlanItem, unknown>[] {
  return [
    {
      id: 'plan',
      header: 'Plan',
      cell: ({ row }) => {
        const p = row.original;
        return (
          <span className="flex min-w-0 flex-col">
            <Link
              href={planLinks.detail(p.id)}
              className="truncate rounded font-medium hover:underline focus-ring"
            >
              {p.title}
            </Link>
            <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              <span className="tabular">{p.code}</span>
              <GoalSummary summary={p.goalSummary} />
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
          } satisfies ColumnDef<TherapyPlanItem, unknown>,
        ]
      : []),
    {
      id: 'therapy',
      header: 'Therapy',
      cell: ({ row }) => <TherapyTypeChip therapyType={row.original.therapyType} />,
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
          } satisfies ColumnDef<TherapyPlanItem, unknown>,
        ]
      : []),
    {
      id: 'frequency',
      header: 'Frequency',
      meta: { className: 'hidden lg:table-cell text-[13px]' },
      cell: ({ row }) =>
        describeFrequency(row.original.frequency) || (
          <span className="text-subtle-foreground">Not set</span>
        ),
    },
    {
      id: 'start',
      header: 'Start',
      meta: { className: 'hidden 2xl:table-cell whitespace-nowrap tabular' },
      cell: ({ row }) => fmt.date(row.original.startDate),
    },
    {
      id: 'review',
      header: 'Next review',
      meta: { className: 'whitespace-nowrap' },
      cell: ({ row }) => {
        const p = row.original;
        if (!p.nextReviewDate) return <span className="text-subtle-foreground">—</span>;
        return (
          <span className="flex flex-col items-start gap-1">
            <span className="tabular">{fmt.date(p.nextReviewDate)}</span>
            <ReviewDueBadge state={p.reviewState} />
          </span>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <PlanStatusBadge status={row.original.status} />,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: { className: 'w-12 text-right' },
      cell: ({ row }) => <PlanActionsMenu plan={row.original} />,
    },
  ];
}

function PlanTable() {
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

  const params: PlanListParams = {
    search: state.q,
    therapistId: state.therapistId === 'all' ? undefined : state.therapistId,
    therapyTypeId: state.therapyTypeId === 'all' ? undefined : state.therapyTypeId,
    status: state.status === 'all' ? undefined : [state.status],
    reviewDue: state.reviewDue === 'all' ? undefined : state.reviewDue,
    startFrom: state.from || undefined,
    startTo: state.to || undefined,
    sortBy: state.sort,
    page: state.page,
    pageSize: state.pageSize,
  };
  const { data, isFetching, error, refetch } = usePlanList(params);
  const types = useTherapyTypeList({ status: 'all' });
  const seesTeam =
    (can('therapy_plans.read') || can('therapy_plans.read_status')) && can('therapists.read');
  const therapists = useTherapistList(
    { status: 'all', pageSize: 100, sortBy: 'fullName' },
    seesTeam,
  );

  const filtered =
    Boolean(state.q) ||
    state.therapistId !== 'all' ||
    state.therapyTypeId !== 'all' ||
    state.status !== 'all' ||
    state.reviewDue !== 'all' ||
    Boolean(state.from);
  const clear = () => {
    setSearch('');
    set({
      q: '',
      therapistId: 'all',
      therapyTypeId: 'all',
      status: 'all',
      reviewDue: 'all',
      from: '',
      to: '',
    });
  };
  const columns = React.useMemo(
    () => planColumns({ fmt, showTherapist: seesTeam }),
    [fmt, seesTeam],
  );
  const create = can('therapy_plans.create') && (
    <Button asChild>
      <Link href={planLinks.create()}>
        <Plus /> New therapy plan
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Therapy plans"
        description={
          data
            ? `${data.total} ${data.total === 1 ? 'plan' : 'plans'}${filtered ? ' match' : ''}`
            : 'Treatment plans, goals and reviews for every service.'
        }
        actions={create}
      />
      <DataTable
        label="Therapy plans"
        columns={columns}
        data={data?.items}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(p) => p.id}
        rowHref={(p) => planLinks.detail(p.id)}
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
              label="Search therapy plans"
              placeholder="Patient, patient ID, plan ID or therapist…"
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
            <Select
              value={state.status}
              onValueChange={(v) => set({ status: v as ListState['status'] })}
            >
              <SelectTrigger size="sm" className="w-full sm:w-36" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                {Object.entries(PLAN_STATUSES).map(([value, s]) => (
                  <SelectItem key={value} value={value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={state.reviewDue}
              onValueChange={(v) => set({ reviewDue: v as ListState['reviewDue'] })}
            >
              <SelectTrigger size="sm" className="w-full sm:w-48" aria-label="Filter by review due">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any review date</SelectItem>
                {Object.entries(REVIEW_DUE).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DateRangePicker
              value={state.from ? { from: state.from, to: state.to } : null}
              onChange={(range) => set({ from: range.from, to: range.to })}
              placeholder="Any start date"
            />
            <Select value={state.sort} onValueChange={(v) => set({ sort: v as PlanSort })}>
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Sort by">
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
              title="No plans match these filters"
              action={
                <Button variant="secondary" size="sm" onClick={clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ListChecks}
              title="No therapy plans yet"
              description="Start one from a completed assessment, a patient’s profile or here."
              action={create}
            />
          )
        }
      />
    </>
  );
}

export function TherapyPlansScreen() {
  return (
    <RequirePermission permission="therapy_plans.read_own">
      <div className="animate-in">
        <PlanTable />
      </div>
    </RequirePermission>
  );
}
