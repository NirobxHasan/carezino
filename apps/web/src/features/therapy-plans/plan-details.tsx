'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Ban,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  ClipboardCheck,
  Ellipsis,
  FilePenLine,
  FileSearch,
  History,
  LineChart,
  ListChecks,
  Lock,
  PencilLine,
  Play,
  Plus,
  Trash2,
  UserRoundCog,
} from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { useBreadcrumbLabel } from '@/components/layout/breadcrumbs';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isApiError } from '@/lib/api/client';
import {
  useDiscardPlan,
  usePlan,
  usePlanProgress,
  type AnyPlanDetail,
} from '@/lib/api/therapy-plans';
import { useSession } from '@/lib/session';
import type {
  GoalProgressEntry,
  PlanGoal,
  PlanHistoryEntry,
  TherapyGoalStatus,
  TherapyPlanDetail,
  TherapyPlanStatusDetail,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { TherapyTypeChip, useCenterFormat } from '../appointments/appointment-display';
import {
  ASSESSMENT_KINDS,
  GOAL_PRIORITIES,
  assessmentLinks,
  useInstant,
} from '../assessments/assessment-display';
import {
  GoalDialog,
  GoalHistoryDialog,
  GoalStatusDialog,
  ProgressDialog,
  ProgressEntryRow,
} from './goal-dialogs';
import {
  ReassignDialog,
  ReviseDialog,
  TransitionDialog,
  type TransitionAction,
} from './plan-dialogs';
import {
  GOAL_STATUSES,
  OVERALL_PROGRESS,
  PERIOD_UNITS,
  PLAN_EVENTS,
  PlanStatusBadge,
  RECOMMENDATIONS,
  ReviewDueBadge,
  describeFrequency,
  describeInterval,
  describeLevel,
  describeMeasurement,
  formatMeasure,
  planLinks,
} from './plan-display';
import { ReviewDialog } from './reviews';

function Detail({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className={cn('grid gap-0.5', className)}>
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className={cn('text-sm whitespace-pre-line', empty && 'text-subtle-foreground')}>
        {empty ? '—' : children}
      </dd>
    </div>
  );
}

const notFound = (
  <Card>
    <EmptyState
      icon={FileSearch}
      title="Therapy plan not found"
      description="It may belong to another center, or you may not have access to it."
      action={
        <Button variant="secondary" size="sm" asChild>
          <Link href={planLinks.list}>Back to therapy plans</Link>
        </Button>
      }
    />
  </Card>
);

/** Loads a plan for a page, with not-found and error states. */
export function usePlanPage() {
  const { id } = useParams<{ id: string }>();
  const query = usePlan(id);
  useBreadcrumbLabel(id, query.data ? `${query.data.code}` : undefined);
  let fallback: React.ReactNode = null;
  if (query.isPending) fallback = <PageSkeleton />;
  else if (query.error) {
    fallback =
      isApiError(query.error, 404) || isApiError(query.error, 400) ? (
        notFound
      ) : (
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      );
  }
  return { id, plan: query.data as AnyPlanDetail | undefined, fallback };
}

type Dialog =
  | { kind: 'transition'; action: TransitionAction }
  | { kind: 'revise' }
  | { kind: 'reassign' }
  | { kind: 'discard' }
  | { kind: 'goal'; goal: PlanGoal | null }
  | { kind: 'status'; goal: PlanGoal; status: TherapyGoalStatus }
  | { kind: 'progress'; goal: PlanGoal; corrects?: GoalProgressEntry }
  | { kind: 'history'; goalId: string }
  | { kind: 'review'; reviewId: string };

function PatientLink({ plan }: { plan: AnyPlanDetail }) {
  const { can } = useSession();
  return can('patients.read') ? (
    <Link
      href={`/patients/${plan.patient.id}?tab=plans`}
      className="font-medium text-foreground hover:underline"
    >
      {plan.patient.fullName}
    </Link>
  ) : (
    <span className="font-medium text-foreground">{plan.patient.fullName}</span>
  );
}

function headerDescription(plan: AnyPlanDetail) {
  return (
    <>
      <PatientLink plan={plan} /> · {plan.patient.code} · {plan.code}
    </>
  );
}

function HeaderMeta({ plan }: { plan: AnyPlanDetail }) {
  const fmt = useCenterFormat();
  return (
    <>
      <PlanStatusBadge status={plan.status} />
      <TherapyTypeChip therapyType={plan.therapyType} full />
      <span className="text-[13px] text-muted-foreground">
        {plan.therapist.fullName}
        {plan.therapist.isYou && ' (you)'}
        {!plan.therapist.isActive && ' · inactive'}
      </span>
      <span className="text-[13px] text-muted-foreground">Started {fmt.date(plan.startDate)}</span>
      {plan.nextReviewDate && (
        <span className="text-[13px] text-muted-foreground">
          Review {fmt.date(plan.nextReviewDate)}
        </span>
      )}
      <ReviewDueBadge state={plan.reviewState} />
    </>
  );
}

function Overview({ plan }: { plan: TherapyPlanDetail }) {
  const fmt = useCenterFormat();
  const instant = useInstant();
  const s = plan.sourceAssessment;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail label="Treatment focus" className="sm:col-span-2">
            {plan.treatmentFocus}
          </Detail>
          <Detail label="Frequency">{describeFrequency(plan.frequency)}</Detail>
          <Detail label="Review interval">
            {describeInterval(plan.reviewInterval.value, plan.reviewInterval.unit)}
          </Detail>
          <Detail label="Treatment period">
            {fmt.date(plan.startDate)}
            {plan.targetEndDate ? ` – ${fmt.date(plan.targetEndDate)}` : ' onwards'}
          </Detail>
          <Detail label="Source assessment">
            {s && (
              <Link href={assessmentLinks.detail(s.id)} className="text-primary hover:underline">
                {ASSESSMENT_KINDS[s.type]} · {s.therapyType.code} · {fmt.date(s.assessmentDate)}
              </Link>
            )}
          </Detail>
          <Detail label="Additional instructions" className="sm:col-span-2">
            {plan.additionalInstructions}
          </Detail>
          <Detail label="Clinical notes" className="sm:col-span-2">
            {plan.clinicalNotes}
          </Detail>
          {plan.status === 'PAUSED' && (
            <Detail label="Paused" className="sm:col-span-2">
              {plan.pausedAt && instant(plan.pausedAt)}
              {plan.statusReason && ` · “${plan.statusReason}”`}
            </Detail>
          )}
          {plan.status === 'COMPLETED' && (
            <Detail label="Completion summary" className="sm:col-span-2">
              {plan.completionSummary}
              {plan.completedBy && (
                <span className="block text-xs text-muted-foreground">
                  {plan.completedBy.fullName} · {plan.completedAt && instant(plan.completedAt)}
                </span>
              )}
            </Detail>
          )}
          {plan.status === 'DISCONTINUED' && (
            <Detail label="Discontinued" className="sm:col-span-2">
              {plan.statusReason}
              {plan.discontinuedBy && (
                <span className="block text-xs text-muted-foreground">
                  {plan.discontinuedBy.fullName} ·{' '}
                  {plan.discontinuedAt && instant(plan.discontinuedAt)}
                </span>
              )}
            </Detail>
          )}
          <Detail label="Created">
            {plan.createdBy.fullName} · {instant(plan.createdAt)}
          </Detail>
          <Detail label="Activated">
            {plan.activatedBy && `${plan.activatedBy.fullName} · ${instant(plan.activatedAt!)}`}
          </Detail>
        </dl>
      </CardContent>
    </Card>
  );
}

function GoalCard({
  plan,
  goal,
  open,
}: {
  plan: TherapyPlanDetail;
  goal: PlanGoal;
  open: (d: Dialog) => void;
}) {
  const fmt = useCenterFormat();
  const { actions } = plan;
  const baseline = describeLevel(goal.measurementType, goal.measurementConfig, goal.baseline);
  const target = describeLevel(goal.measurementType, goal.measurementConfig, goal.target);
  const latest = goal.latestProgress;
  const latestValue =
    latest && formatMeasure(goal.measurementType, goal.measurementConfig, latest.measuredValue);
  const canChange = actions.manageGoals && plan.status !== 'DRAFT';
  const canStatus = canChange || actions.recordProgress;
  const closed = goal.status === 'ACHIEVED' || goal.status === 'DISCONTINUED';
  return (
    <li
      className={cn(
        'rounded-xl border border-border bg-surface p-4',
        goal.status === 'DISCONTINUED' && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{goal.title}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={GOAL_STATUSES[goal.status].tone}>{GOAL_STATUSES[goal.status].label}</Badge>
            {goal.priority && (
              <Badge tone={goal.priority === 'HIGH' ? 'danger' : 'outline'}>
                {GOAL_PRIORITIES[goal.priority]} priority
              </Badge>
            )}
            {goal.category && (
              <span className="text-xs text-muted-foreground">{goal.category.name}</span>
            )}
            <span className="text-xs text-muted-foreground">
              {describeMeasurement(goal.measurementType, goal.measurementConfig)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {actions.recordProgress && goal.status !== 'DISCONTINUED' && (
            <Button size="sm" variant="secondary" onClick={() => open({ kind: 'progress', goal })}>
              <LineChart /> Record progress
            </Button>
          )}
          {(canStatus || goal.progressCount > 0) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`More for ${goal.title}`}>
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => open({ kind: 'history', goalId: goal.id })}>
                  <History /> Progress history
                </DropdownMenuItem>
                {canChange && (
                  <DropdownMenuItem onSelect={() => open({ kind: 'goal', goal })}>
                    <PencilLine /> Change goal
                  </DropdownMenuItem>
                )}
                {canStatus && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Set status</DropdownMenuLabel>
                    {(Object.keys(GOAL_STATUSES) as TherapyGoalStatus[])
                      .filter((s) => s !== goal.status && s !== 'NOT_STARTED')
                      .map((s) => (
                        <DropdownMenuItem
                          key={s}
                          onSelect={() => open({ kind: 'status', goal, status: s })}
                        >
                          {GOAL_STATUSES[s].label}
                        </DropdownMenuItem>
                      ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {goal.description && (
        <p className="mt-2 whitespace-pre-line text-[13px] text-muted-foreground">
          {goal.description}
        </p>
      )}
      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        <Detail label="Baseline">{baseline}</Detail>
        <Detail label="Target">
          {target}
          {goal.targetDate && (
            <span className="block text-xs text-muted-foreground">
              by {fmt.date(goal.targetDate)}
            </span>
          )}
        </Detail>
        <Detail label={`Latest progress${goal.progressCount ? ` (${goal.progressCount})` : ''}`}>
          {latest ? (
            <>
              {[fmt.date(latest.observationDate), latestValue].filter(Boolean).join(' · ')}
              {latest.observation && (
                <span className="block text-xs text-muted-foreground">{latest.observation}</span>
              )}
            </>
          ) : closed ? null : (
            'Nothing recorded yet'
          )}
        </Detail>
      </dl>
    </li>
  );
}

function Goals({ plan, open }: { plan: TherapyPlanDetail; open: (d: Dialog) => void }) {
  const canAdd = plan.actions.manageGoals && plan.status !== 'DRAFT';
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle>Goals</CardTitle>
          <CardDescription>
            Statuses are set by the therapist; reaching a target doesn’t change them.
          </CardDescription>
        </div>
        {canAdd && (
          <Button size="sm" variant="secondary" onClick={() => open({ kind: 'goal', goal: null })}>
            <Plus /> Add goal
          </Button>
        )}
        {plan.actions.edit && (
          <Button size="sm" variant="secondary" asChild>
            <Link href={planLinks.edit(plan.id)}>
              <FilePenLine /> Edit goals
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {plan.goals.length ? (
          <ul className="grid gap-3">
            {plan.goals.map((g) => (
              <GoalCard key={g.id} plan={plan} goal={g} open={open} />
            ))}
          </ul>
        ) : (
          <EmptyState compact icon={ListChecks} title="No goals yet." />
        )}
      </CardContent>
    </Card>
  );
}

function ProgressTab({ plan, open }: { plan: TherapyPlanDetail; open: (d: Dialog) => void }) {
  const progress = usePlanProgress(plan.id);
  const goals = new Map(plan.goals.map((g) => [g.id, g]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Progress history</CardTitle>
        <CardDescription>Every observation of every goal, oldest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {progress.isPending ? (
          <div className="grid gap-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : progress.error ? (
          <ErrorState error={progress.error} onRetry={() => void progress.refetch()} />
        ) : progress.data.items.length === 0 ? (
          <EmptyState compact icon={LineChart} title="No progress recorded yet." />
        ) : (
          <ol className="grid gap-4 border-l border-border pl-4">
            {progress.data.items.map((entry) => {
              const goal = goals.get(entry.goalId)!;
              return (
                <ProgressEntryRow
                  key={entry.id}
                  goal={goal}
                  entry={entry}
                  onCorrect={
                    plan.actions.recordProgress
                      ? () => open({ kind: 'progress', goal, corrects: entry })
                      : undefined
                  }
                />
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewsTab({ plan, open }: { plan: TherapyPlanDetail; open: (d: Dialog) => void }) {
  const fmt = useCenterFormat();
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle>Reviews</CardTitle>
          <CardDescription>
            {plan.nextReviewDate
              ? `Next review ${fmt.date(plan.nextReviewDate)}.`
              : 'No next review date set.'}
          </CardDescription>
        </div>
        {plan.actions.review && (
          <Button size="sm" asChild>
            <Link href={planLinks.review(plan.id)}>
              <ClipboardCheck /> Start review
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {plan.reviews.length === 0 ? (
          <EmptyState compact icon={ClipboardCheck} title="No reviews yet." />
        ) : (
          <ul className="divide-y divide-border">
            {plan.reviews.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    Review {r.number} · {fmt.date(r.reviewDate)}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    {OVERALL_PROGRESS[r.overallProgress]} · {RECOMMENDATIONS[r.recommendation]}
                    {r.amendmentCount > 0 &&
                      ` · ${r.amendmentCount} correction${r.amendmentCount === 1 ? '' : 's'}`}
                  </p>
                  <p className="text-xs text-subtle-foreground">{r.therapist.fullName}</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => open({ kind: 'review', reviewId: r.id })}
                >
                  View
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const SNAPSHOT_LABELS: Record<string, string> = {
  title: 'Title',
  treatmentFocus: 'Treatment focus',
  clinicalNotes: 'Clinical notes',
  sessionsPerPeriod: 'Sessions',
  frequencyUnit: 'Per',
  durationMinutes: 'Duration (min)',
  reviewIntervalValue: 'Review every',
  reviewIntervalUnit: 'Review unit',
  additionalInstructions: 'Additional instructions',
  startDate: 'Start date',
  targetEndDate: 'Target end date',
  nextReviewDate: 'Next review date',
  status: 'Status',
  description: 'Description',
  baselineValue: 'Baseline value',
  baselineText: 'Baseline',
  targetValue: 'Target value',
  targetText: 'Target',
  targetDate: 'Target date',
  priority: 'Priority',
  notes: 'Notes',
};

function show(value: unknown, fmt: ReturnType<typeof useCenterFormat>) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return fmt.date(value);
  if (typeof value === 'string' && value in PERIOD_UNITS) {
    return PERIOD_UNITS[value as keyof typeof PERIOD_UNITS].per;
  }
  if (typeof value === 'string' && value in GOAL_STATUSES) {
    return GOAL_STATUSES[value as TherapyGoalStatus].label;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Before → after for the simple values that changed, e.g. "Sessions: 3 → 2". */
function Changes({ entry }: { entry: PlanHistoryEntry }) {
  const fmt = useCenterFormat();
  const before = entry.previousSnapshot ?? {};
  const after = entry.newSnapshot ?? {};
  if (entry.event === 'THERAPIST_REASSIGNED') {
    const name = (s: Record<string, unknown>) =>
      (s.therapist as { fullName?: string } | undefined)?.fullName ?? '—';
    return (
      <p className="text-[13px] text-muted-foreground">
        {name(before)} → {name(after)}
      </p>
    );
  }
  if (entry.event !== 'REVISED' && entry.event !== 'GOAL_UPDATED') return null;
  const keys = Object.keys(SNAPSHOT_LABELS).filter(
    (k) => k in after && JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null),
  );
  if (!keys.length) return null;
  return (
    <ul className="mt-1 grid gap-0.5 text-[13px] text-muted-foreground">
      {keys.map((k) => (
        <li key={k}>
          {SNAPSHOT_LABELS[k]}: <span className="line-through">{show(before[k], fmt)}</span> →{' '}
          <span className="text-foreground">{show(after[k], fmt)}</span>
        </li>
      ))}
    </ul>
  );
}

function HistoryTab({ plan }: { plan: TherapyPlanDetail }) {
  const instant = useInstant();
  const goals = new Map(plan.goals.map((g) => [g.id, g.title]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Revision history</CardTitle>
        <CardDescription>
          Every change since activation: status, revisions, goals and reassignments. Nothing here is
          ever edited or removed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {plan.history.length === 0 ? (
          <EmptyState
            compact
            icon={History}
            title="No history yet."
            description="History starts when the plan is activated."
          />
        ) : (
          <ol className="relative grid gap-4 border-l border-border pl-5">
            {plan.history.map((h) => (
              <li key={h.number} className="relative">
                <span
                  className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-primary"
                  aria-hidden
                />
                <p className="text-sm">
                  {PLAN_EVENTS[h.event]}
                  {h.goalId && goals.get(h.goalId) && (
                    <span className="text-muted-foreground"> · {goals.get(h.goalId)}</span>
                  )}
                  {h.changedFields.length > 0 && h.event !== 'GOAL_ADDED' && (
                    <span className="text-muted-foreground">: {h.changedFields.join(', ')}</span>
                  )}
                </p>
                {h.reason && <p className="text-[13px] text-muted-foreground">“{h.reason}”</p>}
                <Changes entry={h} />
                <p className="text-xs text-subtle-foreground">
                  {h.revisedBy.fullName} · {instant(h.revisedAt)}
                  {h.reviewId && ' · after a review'}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** For staff who may see that a plan exists and its schedule, not its clinical content. */
function StatusOnlyView({ plan }: { plan: TherapyPlanStatusDetail }) {
  const fmt = useCenterFormat();
  const [reassigning, setReassigning] = React.useState(false);
  return (
    <>
      <PageHeader
        back={{ href: planLinks.list, label: 'Therapy plans' }}
        title={plan.title}
        description={headerDescription(plan)}
        meta={<HeaderMeta plan={plan} />}
        actions={
          plan.actions.reassign && (
            <Button variant="secondary" onClick={() => setReassigning(true)}>
              <UserRoundCog /> Reassign
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="grid gap-6 pt-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail label="Frequency">{describeFrequency(plan.frequency)}</Detail>
            <Detail label="Review interval">
              {describeInterval(plan.reviewInterval.value, plan.reviewInterval.unit)}
            </Detail>
            <Detail label="Start date">{fmt.date(plan.startDate)}</Detail>
            <Detail label="Target end date">
              {plan.targetEndDate && fmt.date(plan.targetEndDate)}
            </Detail>
            <Detail label="Next review">
              {plan.nextReviewDate && fmt.date(plan.nextReviewDate)}
            </Detail>
            <Detail label="Responsible therapist">{plan.therapist.fullName}</Detail>
          </dl>
          <EmptyState
            compact
            icon={Lock}
            title="Clinical content is private"
            description="Goals, progress and reviews are visible to the therapists caring for this patient and staff with clinical access."
          />
        </CardContent>
      </Card>
      <ReassignDialog plan={plan} open={reassigning} onClose={() => setReassigning(false)} />
    </>
  );
}

type Tab = 'overview' | 'progress' | 'reviews' | 'history';
const TABS: Tab[] = ['overview', 'progress', 'reviews', 'history'];

function PlanView({ plan }: { plan: TherapyPlanDetail }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { actions } = plan;
  const tab: Tab = (TABS as string[]).includes(search.get('tab') ?? '')
    ? (search.get('tab') as Tab)
    : 'overview';
  const reviewId = search.get('review') ?? undefined;

  // ?action=… from lists and after a review opens the matching dialog, if allowed. It's
  // read whenever it changes, not just on mount: visited routes keep their state.
  const requested = search.get('action');
  const [dialog, setDialog] = React.useState<Dialog | null>(null);
  const requestKey = requested ? `${requested}:${reviewId ?? ''}` : null;
  const [handled, setHandled] = React.useState<string | null>(null);
  if (requestKey !== handled) {
    setHandled(requestKey);
    const asked: Dialog | null =
      requested === 'revise' && actions.revise
        ? { kind: 'revise' }
        : requested &&
            ['pause', 'resume', 'complete', 'discontinue'].includes(requested) &&
            actions[requested as 'pause']
          ? { kind: 'transition', action: requested as TransitionAction }
          : null;
    if (asked) setDialog(asked);
  }
  const replace = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  const close = () => {
    setDialog(null);
    if (requested || reviewId) replace({ action: null, review: null });
  };

  // Dialogs are transient: close them when the page is hidden by a navigation.
  React.useLayoutEffect(() => () => setDialog(null), []);

  const discard = useDiscardPlan();
  const lifecycle = actions.pause || actions.resume || actions.complete || actions.discontinue;

  return (
    <>
      <PageHeader
        back={{ href: planLinks.list, label: 'Therapy plans' }}
        title={plan.title}
        description={headerDescription(plan)}
        meta={<HeaderMeta plan={plan} />}
        actions={
          <>
            {actions.edit && (
              <Button variant="secondary" asChild>
                <Link href={planLinks.edit(plan.id)}>
                  <FilePenLine /> Edit draft
                </Link>
              </Button>
            )}
            {actions.activate && (
              <Button onClick={() => setDialog({ kind: 'transition', action: 'activate' })}>
                <Play /> Activate
              </Button>
            )}
            {actions.review && (
              <Button asChild>
                <Link href={planLinks.review(plan.id)}>
                  <ClipboardCheck /> Review plan
                </Link>
              </Button>
            )}
            {actions.revise && (
              <Button variant="secondary" onClick={() => setDialog({ kind: 'revise' })}>
                <PencilLine /> Revise
              </Button>
            )}
            {(lifecycle || actions.reassign || actions.discard) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="icon" aria-label="More actions">
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {actions.pause && (
                    <DropdownMenuItem
                      onSelect={() => setDialog({ kind: 'transition', action: 'pause' })}
                    >
                      <CirclePause /> Pause
                    </DropdownMenuItem>
                  )}
                  {actions.resume && (
                    <DropdownMenuItem
                      onSelect={() => setDialog({ kind: 'transition', action: 'resume' })}
                    >
                      <CirclePlay /> Resume
                    </DropdownMenuItem>
                  )}
                  {actions.complete && (
                    <DropdownMenuItem
                      onSelect={() => setDialog({ kind: 'transition', action: 'complete' })}
                    >
                      <CheckCircle2 /> Complete
                    </DropdownMenuItem>
                  )}
                  {actions.reassign && (
                    <DropdownMenuItem onSelect={() => setDialog({ kind: 'reassign' })}>
                      <UserRoundCog /> Reassign therapist
                    </DropdownMenuItem>
                  )}
                  {(actions.discontinue || actions.discard) && <DropdownMenuSeparator />}
                  {actions.discontinue && (
                    <DropdownMenuItem
                      tone="danger"
                      onSelect={() => setDialog({ kind: 'transition', action: 'discontinue' })}
                    >
                      <Ban /> Discontinue
                    </DropdownMenuItem>
                  )}
                  {actions.discard && (
                    <DropdownMenuItem tone="danger" onSelect={() => setDialog({ kind: 'discard' })}>
                      <Trash2 /> Discard draft
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />
      {plan.status === 'DRAFT' && (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning-subtle p-3 text-sm text-warning-foreground">
          This is a draft. Review the details and goals, then activate it to start treatment under
          this plan.
        </p>
      )}
      <Tabs
        value={tab}
        onValueChange={(next) => replace({ tab: next === 'overview' ? null : next })}
      >
        <TabsList>
          <TabsTrigger value="overview">Overview & goals</TabsTrigger>
          <TabsTrigger value="progress">
            <LineChart /> Progress
          </TabsTrigger>
          <TabsTrigger value="reviews">
            <ClipboardCheck /> Reviews
            {plan.reviews.length > 0 && (
              <span className="text-xs text-muted-foreground">{plan.reviews.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">
            <History /> History
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
            <Goals plan={plan} open={setDialog} />
            <Overview plan={plan} />
          </div>
        </TabsContent>
        <TabsContent value="progress">
          <ProgressTab plan={plan} open={setDialog} />
        </TabsContent>
        <TabsContent value="reviews">
          <ReviewsTab plan={plan} open={setDialog} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab plan={plan} />
        </TabsContent>
      </Tabs>

      <TransitionDialog
        plan={plan}
        action={dialog?.kind === 'transition' ? dialog.action : null}
        reviewId={reviewId}
        onClose={close}
      />
      <ReviseDialog
        plan={plan}
        open={dialog?.kind === 'revise'}
        reviewId={reviewId}
        onClose={close}
      />
      <ReassignDialog plan={plan} open={dialog?.kind === 'reassign'} onClose={close} />
      <GoalDialog
        plan={plan}
        goal={dialog?.kind === 'goal' ? dialog.goal : null}
        open={dialog?.kind === 'goal'}
        onClose={close}
      />
      <GoalStatusDialog
        plan={plan}
        goal={dialog?.kind === 'status' ? dialog.goal : null}
        status={dialog?.kind === 'status' ? dialog.status : null}
        onClose={close}
      />
      <ProgressDialog
        plan={plan}
        goal={dialog?.kind === 'progress' ? dialog.goal : null}
        corrects={dialog?.kind === 'progress' ? dialog.corrects : null}
        open={dialog?.kind === 'progress'}
        onClose={close}
      />
      <GoalHistoryDialog
        plan={plan}
        goalId={dialog?.kind === 'history' ? dialog.goalId : null}
        onClose={close}
        onCorrect={(goal, entry) => setDialog({ kind: 'progress', goal, corrects: entry })}
      />
      <ReviewDialog
        plan={plan}
        reviewId={dialog?.kind === 'review' ? dialog.reviewId : null}
        onClose={close}
      />
      <ConfirmDialog
        open={dialog?.kind === 'discard'}
        onOpenChange={(o) => !o && close()}
        title="Discard this draft?"
        description="The draft and its goals are deleted. Plans that were ever active are always kept."
        confirmLabel="Discard draft"
        tone="danger"
        loading={discard.isPending}
        onConfirm={() =>
          discard.mutate(plan.id, {
            onSuccess: () => {
              toast.success('Draft discarded');
              router.push(planLinks.list);
            },
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </>
  );
}

function PlanPage() {
  const { plan, fallback } = usePlanPage();
  if (!plan) return fallback;
  if (!plan.clinicalAccess) return <StatusOnlyView plan={plan} />;
  return <PlanView key={plan.id} plan={plan} />;
}

export function PlanDetailsScreen() {
  return (
    <RequirePermission permission="therapy_plans.read_own">
      <div className="animate-in">
        <PlanPage />
      </div>
    </RequirePermission>
  );
}
