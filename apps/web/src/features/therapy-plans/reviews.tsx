'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, History } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorState } from '@/components/feedback/states';
import { DatePicker } from '@/components/forms/date-picker';
import { Field } from '@/components/forms/field';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import { isApiError } from '@/lib/api/client';
import { useAmendReview, useCreateReview, usePlanReview } from '@/lib/api/therapy-plans';
import { useSession } from '@/lib/session';
import type {
  PlanReviewContent,
  ReviewGoalSnapshot,
  ReviewOverallProgress,
  ReviewRecommendation,
  TherapyPlanDetail,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { TherapyTypeChip, centerToday, useCenterFormat } from '../appointments/appointment-display';
import { useInstant } from '../assessments/assessment-display';
import {
  GoalStatusBadge,
  OVERALL_PROGRESS,
  RECOMMENDATIONS,
  describeFrequency,
  describeLevel,
  formatMeasure,
  planLinks,
} from './plan-display';
import { addInterval } from './plan-form';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="grid gap-0.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className={cn('text-sm whitespace-pre-line', empty && 'text-subtle-foreground')}>
        {empty ? '—' : children}
      </dd>
    </div>
  );
}

/** Goals as they stood at a review (or now): status, baseline, target, latest value. */
export function GoalSnapshotTable({ goals }: { goals: ReviewGoalSnapshot[] }) {
  const fmt = useCenterFormat();
  if (!goals.length) return <p className="text-sm text-muted-foreground">No goals.</p>;
  return (
    <ul className="grid gap-3">
      {goals.map((g) => {
        const latest = g.latestProgress;
        const value =
          latest && formatMeasure(g.measurementType, g.measurementConfig, latest.measuredValue);
        return (
          <li key={g.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{g.title}</p>
              <GoalStatusBadge status={g.status} />
            </div>
            <dl className="mt-2 grid gap-2 text-[13px] sm:grid-cols-3">
              <Detail label="Baseline">
                {describeLevel(g.measurementType, g.measurementConfig, g.baseline)}
              </Detail>
              <Detail label="Target">
                {describeLevel(g.measurementType, g.measurementConfig, g.target)}
              </Detail>
              <Detail label="Latest progress">
                {latest
                  ? [fmt.date(latest.observationDate), value, latest.observation]
                      .filter(Boolean)
                      .join(' · ')
                  : `No entries (${g.progressCount})`}
              </Detail>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

const CONTENT_FIELDS: { key: keyof PlanReviewContent; label: string }[] = [
  { key: 'observations', label: 'Clinical observations' },
  { key: 'goalSummary', label: 'Goal review summary' },
  { key: 'notes', label: 'Additional notes' },
];

/** The fields a reviewer fills in, for new reviews and corrections. */
function ReviewFields({
  value,
  onChange,
  errors,
  today,
}: {
  value: PlanReviewContent;
  onChange: (patch: Partial<PlanReviewContent>) => void;
  errors: Record<string, string>;
  today: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Review date" required error={errors.reviewDate}>
        <DatePicker
          value={value.reviewDate}
          onChange={(v) => v && onChange({ reviewDate: v })}
          disabledDays={{ after: new Date(`${today}T00:00:00`) }}
        />
      </Field>
      <Field label="Overall progress" required error={errors.overallProgress}>
        <Select
          value={value.overallProgress}
          onValueChange={(v) => onChange({ overallProgress: v as ReviewOverallProgress })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(OVERALL_PROGRESS).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {CONTENT_FIELDS.map((f) => (
        <Field key={f.key} label={f.label} optional error={errors[f.key]} className="sm:col-span-2">
          <Textarea
            rows={3}
            value={(value[f.key] as string | null) ?? ''}
            onChange={(e) => onChange({ [f.key]: e.target.value })}
          />
        </Field>
      ))}
      <Field
        label="Recommendation"
        required
        error={errors.recommendation}
        helper="Recording it changes nothing; you’ll be offered the matching action next."
      >
        <Select
          value={value.recommendation}
          onValueChange={(v) => onChange({ recommendation: v as ReviewRecommendation })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(RECOMMENDATIONS).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field
        label="Next review date"
        optional
        error={errors.nextReviewDate}
        helper="A follow-up target; nothing is booked."
      >
        <DatePicker
          value={value.nextReviewDate ?? undefined}
          onChange={(v) => onChange({ nextReviewDate: v ?? null })}
          placeholder="None"
        />
      </Field>
    </div>
  );
}

/** A saved review, read-only, with its corrections; its therapist can correct it. */
export function ReviewDialog({
  plan,
  reviewId,
  onClose,
}: {
  plan: TherapyPlanDetail;
  reviewId: string | null;
  onClose: () => void;
}) {
  const review = usePlanReview(plan.id, reviewId);
  const fmt = useCenterFormat();
  const instant = useInstant();
  const { activeCenter } = useSession();
  const today = centerToday(activeCenter.timezone);
  const [amending, setAmending] = React.useState(false);
  const [draft, setDraft] = React.useState<PlanReviewContent | null>(null);
  const [reason, setReason] = React.useState('');
  const amend = useAmendReview();
  const errors = isApiError(amend.error) ? (amend.error.errors ?? {}) : {};
  const r = review.data;
  const close = () => {
    setAmending(false);
    setReason('');
    amend.reset();
    onClose();
  };
  const content = (x: NonNullable<typeof r>): PlanReviewContent => ({
    reviewDate: x.reviewDate,
    overallProgress: x.overallProgress,
    recommendation: x.recommendation,
    observations: x.observations,
    goalSummary: x.goalSummary,
    notes: x.notes,
    nextReviewDate: x.nextReviewDate,
  });
  return (
    <Dialog open={reviewId !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{r ? `Review ${r.number}` : 'Review'}</DialogTitle>
          <DialogDescription>
            {r
              ? `${fmt.date(r.reviewDate)} · ${r.therapist.fullName}. Confirmed ${instant(r.completedAt)}.`
              : 'Loading…'}
          </DialogDescription>
        </DialogHeader>
        {review.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : review.error ? (
          <ErrorState error={review.error} onRetry={() => void review.refetch()} />
        ) : amending && draft ? (
          <div className="grid gap-4">
            <ReviewFields
              value={draft}
              onChange={(patch) => setDraft((d) => ({ ...d!, ...patch }))}
              errors={errors}
              today={today}
            />
            <Field label="Why is it being corrected?" required error={errors.reason}>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <p className="text-xs text-muted-foreground">
              The review as it is now is kept with the correction. Correcting the next review date
              here doesn’t move the plan’s; revise the plan for that.
            </p>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setAmending(false)}>
                Back
              </Button>
              <Button
                loading={amend.isPending}
                disabled={reason.trim().length < 3}
                onClick={() => {
                  const before = content(r!);
                  const changes = Object.fromEntries(
                    Object.entries(draft).filter(
                      ([k, v]) => (v ?? '') !== (before[k as keyof PlanReviewContent] ?? ''),
                    ),
                  );
                  amend.mutate(
                    {
                      id: plan.id,
                      reviewId: r!.id,
                      input: { ...changes, reason: reason.trim() },
                    },
                    {
                      onSuccess: () => {
                        toast.success('Review corrected');
                        setAmending(false);
                        setReason('');
                        void review.refetch();
                      },
                      onError: (e) => {
                        if (!(isApiError(e) && e.errors)) toast.error(e.message);
                      },
                    },
                  );
                }}
              >
                Save correction
              </Button>
            </DialogFooter>
          </div>
        ) : (
          r && (
            <div className="grid gap-5">
              <dl className="grid gap-3 sm:grid-cols-3">
                <Detail label="Overall progress">{OVERALL_PROGRESS[r.overallProgress]}</Detail>
                <Detail label="Recommendation">{RECOMMENDATIONS[r.recommendation]}</Detail>
                <Detail label="Next review">
                  {r.nextReviewDate && fmt.date(r.nextReviewDate)}
                </Detail>
                {CONTENT_FIELDS.map((f) => (
                  <div key={f.key} className="sm:col-span-3">
                    <Detail label={f.label}>{r[f.key as 'observations']}</Detail>
                  </div>
                ))}
              </dl>
              <section className="grid gap-2">
                <h3 className="text-card-title">At the time of the review</h3>
                <p className="text-[13px] text-muted-foreground">
                  {[
                    r.planSnapshot.frequency,
                    r.planSnapshot.durationMinutes && `${r.planSnapshot.durationMinutes} min`,
                    `plan ${r.planSnapshot.status.toLowerCase()}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <GoalSnapshotTable goals={r.goalSnapshot} />
              </section>
              {r.amendments.length > 0 && (
                <section className="grid gap-2">
                  <h3 className="text-card-title">Corrections</h3>
                  <ol className="grid gap-3 border-l border-border pl-4">
                    {r.amendments.map((a) => (
                      <li key={a.number} className="text-sm">
                        <p>
                          Correction {a.number}: {a.changedFields.join(', ')}
                        </p>
                        <p className="text-[13px] text-muted-foreground">“{a.reason}”</p>
                        <p className="text-xs text-subtle-foreground">
                          {a.amendedBy.fullName} · {instant(a.amendedAt)} · before:{' '}
                          {RECOMMENDATIONS[a.previousContent.recommendation]},{' '}
                          {OVERALL_PROGRESS[a.previousContent.overallProgress].toLowerCase()}
                        </p>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {r.actions.amend && (
                <DialogFooter>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setDraft(content(r));
                      setAmending(true);
                    }}
                  >
                    <History /> Correct this review
                  </Button>
                </DialogFooter>
              )}
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Which explicit action a recommendation suggests next. */
const FOLLOW_UP: Partial<Record<ReviewRecommendation, { action: string; label: string }>> = {
  MODIFY: { action: 'revise', label: 'Revise the plan' },
  INCREASE_FREQUENCY: { action: 'revise', label: 'Revise the frequency' },
  DECREASE_FREQUENCY: { action: 'revise', label: 'Revise the frequency' },
  PAUSE: { action: 'pause', label: 'Pause the plan' },
  COMPLETE: { action: 'complete', label: 'Complete the plan' },
};

/**
 * A periodic review: the plan and its goals as they stand, the reviewer's findings and
 * recommendation. Saving confirms it; acting on the recommendation is a separate step.
 */
export function NewReviewScreen({
  plan,
  onSaved,
}: {
  plan: TherapyPlanDetail;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const fmt = useCenterFormat();
  const { activeCenter } = useSession();
  const today = centerToday(activeCenter.timezone);
  const suggestedNext =
    plan.reviewInterval.value && plan.reviewInterval.unit
      ? addInterval(today, plan.reviewInterval.value, plan.reviewInterval.unit)
      : null;
  const [form, setForm] = React.useState<PlanReviewContent>({
    reviewDate: today,
    overallProgress: '' as ReviewOverallProgress,
    recommendation: '' as ReviewRecommendation,
    observations: '',
    goalSummary: '',
    notes: '',
    nextReviewDate: suggestedNext,
  });
  const create = useCreateReview();
  const errors = isApiError(create.error) ? (create.error.errors ?? {}) : {};
  const ready = Boolean(form.reviewDate && form.overallProgress && form.recommendation);
  const goals: ReviewGoalSnapshot[] = plan.goals.map((g) => ({
    id: g.id,
    title: g.title,
    category: g.category?.name ?? null,
    priority: g.priority,
    status: g.status,
    measurementType: g.measurementType,
    measurementConfig: g.measurementConfig,
    baseline: g.baseline,
    target: g.target,
    targetDate: g.targetDate,
    latestProgress: g.latestProgress,
    progressCount: g.progressCount,
  }));

  const submit = () =>
    create.mutate(
      { id: plan.id, input: form },
      {
        onSuccess: (review) => {
          toast.success(`Review ${review.number} saved`);
          const next = FOLLOW_UP[review.recommendation];
          router.push(
            next
              ? `${planLinks.detail(plan.id)}?tab=reviews&action=${next.action}&review=${review.id}`
              : planLinks.detail(plan.id, 'reviews'),
          );
          onSaved?.();
        },
        onError: (e) => {
          if (!(isApiError(e) && e.errors)) toast.error(e.message);
        },
      },
    );

  return (
    <div className="animate-in">
      <PageHeader
        back={{ href: planLinks.detail(plan.id), label: plan.title }}
        title="Review plan"
        description={`${plan.patient.fullName} · ${plan.code} · ${plan.therapyType.name}`}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Current plan</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 sm:grid-cols-2">
                <Detail label="Therapy">
                  <TherapyTypeChip therapyType={plan.therapyType} full />
                </Detail>
                <Detail label="Frequency">{describeFrequency(plan.frequency)}</Detail>
                <Detail label="Started">{fmt.date(plan.startDate)}</Detail>
                <Detail label="Review due">
                  {plan.nextReviewDate && fmt.date(plan.nextReviewDate)}
                </Detail>
                <div className="sm:col-span-2">
                  <Detail label="Treatment focus">{plan.treatmentFocus}</Detail>
                </div>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Goals and latest progress</CardTitle>
              <CardDescription>Saved with the review as they stand now.</CardDescription>
            </CardHeader>
            <CardContent>
              <GoalSnapshotTable goals={goals} />
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Findings</CardTitle>
            {plan.reviews.length > 0 && (
              <CardDescription>
                Last reviewed {fmt.date(plan.reviews[0].reviewDate)}:{' '}
                {RECOMMENDATIONS[plan.reviews[0].recommendation].toLowerCase()}.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="grid gap-4">
            <ReviewFields
              value={form}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
              errors={errors}
              today={today}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" asChild>
                <Link href={planLinks.detail(plan.id)}>Cancel</Link>
              </Button>
              <Button onClick={submit} disabled={!ready} loading={create.isPending}>
                <ClipboardCheck /> Confirm review
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function NewReviewPage({ plan }: { plan: TherapyPlanDetail }) {
  // Visited routes keep their state; each review starts from an empty form.
  const [round, setRound] = React.useState(0);
  return (
    <RequirePermission permission="therapy_plans.review">
      {plan.actions.review ? (
        <NewReviewScreen key={round} plan={plan} onSaved={() => setRound((r) => r + 1)} />
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Only the responsible therapist can review a plan in force.{' '}
            <Link href={planLinks.detail(plan.id)} className="text-primary underline">
              Back to the plan
            </Link>
          </CardContent>
        </Card>
      )}
    </RequirePermission>
  );
}
