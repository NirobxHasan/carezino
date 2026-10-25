'use client';

import * as React from 'react';
import { PencilLine } from 'lucide-react';

import { ErrorState } from '@/components/feedback/states';
import { DatePicker } from '@/components/forms/date-picker';
import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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
import {
  useAddGoal,
  useGoalCategories,
  useGoalProgress,
  useRecordProgress,
  useUpdateGoal,
} from '@/lib/api/therapy-plans';
import { useSession } from '@/lib/session';
import type {
  GoalProgressEntry,
  PlanGoal,
  TherapyGoalStatus,
  TherapyPlanDetail,
} from '@/lib/types';
import { centerToday, useCenterFormat } from '../appointments/appointment-display';
import { useInstant } from '../assessments/assessment-display';
import {
  GoalFields,
  badNumber,
  draftToInput,
  emptyGoal,
  goalErrors,
  goalToDraft,
  type GoalDraft,
} from './goal-fields';
import {
  GOAL_STATUSES,
  GoalStatusBadge,
  MEASUREMENT_TYPES,
  describeLevel,
  formatMeasure,
  measureUnit,
} from './plan-display';

/**
 * Adding a goal to, or changing a goal of, a plan in force. Every change is kept in the
 * plan's history, so it needs a reason.
 */
export function GoalDialog({
  plan,
  goal,
  open,
  onClose,
}: {
  plan: TherapyPlanDetail;
  /** Null adds a new goal */
  goal: PlanGoal | null;
  open: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = React.useState<GoalDraft>(() =>
    goal ? goalToDraft(goal) : emptyGoal(),
  );
  const [reason, setReason] = React.useState('');
  const [localErrors, setLocalErrors] = React.useState<Record<string, string>>({});
  const [shownFor, setShownFor] = React.useState<string | null>(null);
  const key = open ? (goal?.id ?? 'new') : null;
  if (key !== shownFor) {
    setShownFor(key);
    if (open) {
      setDraft(goal ? goalToDraft(goal) : emptyGoal());
      setReason('');
      setLocalErrors({});
    }
  }
  const categories = useGoalCategories({ therapyTypeId: plan.therapyType.id, status: 'all' }, open);
  const add = useAddGoal();
  const update = useUpdateGoal();
  const mutation = goal ? update : add;
  const errors = {
    ...goalErrors(isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {}),
    ...localErrors,
  };
  const close = () => {
    add.reset();
    update.reset();
    onClose();
  };
  const submit = () => {
    const local = badNumber(draft);
    if (!draft.title.trim()) local.title = 'Goal title is required';
    setLocalErrors(local);
    if (Object.keys(local).length) return;
    const { id: _id, sourceAssessmentGoalId, ...input } = draftToInput(draft);
    void _id;
    const options = {
      onSuccess: () => {
        toast.success(goal ? 'Goal updated' : 'Goal added');
        close();
      },
      onError: (e: Error) => {
        if (!(isApiError(e) && e.errors)) toast.error(e.message);
      },
    };
    if (goal) {
      update.mutate(
        { id: plan.id, goalId: goal.id, input: { ...input, reason: reason.trim() } },
        options,
      );
    } else {
      add.mutate(
        {
          id: plan.id,
          input: { ...input, sourceAssessmentGoalId, reason: reason.trim() },
        },
        options,
      );
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{goal ? 'Change goal' : 'Add goal'}</DialogTitle>
          <DialogDescription>
            The plan is in force, so this change is kept in its history with your reason.
          </DialogDescription>
        </DialogHeader>
        <GoalFields
          value={draft}
          onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          errors={errors}
          categories={categories.data ?? []}
          lockMeasurement={Boolean(goal && goal.progressCount > 0)}
        />
        <Field label="Reason" required error={errors.reason}>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              goal ? 'e.g. Target adjusted at review' : 'e.g. New concern raised by school'
            }
          />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending} disabled={reason.trim().length < 3}>
            {goal ? 'Save goal' : 'Add goal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Changing a goal's status by clinical judgement; the reason is optional. */
export function GoalStatusDialog({
  plan,
  goal,
  status,
  onClose,
}: {
  plan: TherapyPlanDetail;
  goal: PlanGoal | null;
  status: TherapyGoalStatus | null;
  onClose: () => void;
}) {
  const [reason, setReason] = React.useState('');
  const mutation = useUpdateGoal();
  const open = Boolean(goal && status);
  const close = () => {
    setReason('');
    mutation.reset();
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        {goal && status && (
          <>
            <DialogHeader>
              <DialogTitle>Mark as {GOAL_STATUSES[status].label.toLowerCase()}?</DialogTitle>
              <DialogDescription>
                “{goal.title}”. The goal stays on the plan and in its history.
              </DialogDescription>
            </DialogHeader>
            <Field label="Reason" optional>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button
                loading={mutation.isPending}
                onClick={() =>
                  mutation.mutate(
                    {
                      id: plan.id,
                      goalId: goal.id,
                      input: { status, ...(reason.trim() && { reason: reason.trim() }) },
                    },
                    {
                      onSuccess: () => {
                        toast.success('Goal status updated');
                        close();
                      },
                      onError: (e) => toast.error(e.message),
                    },
                  )
                }
              >
                Update status
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Records an observation of a goal, or corrects an earlier one (kept, marked as
 * corrected). Values are in the goal's unit; narrative goals take words only.
 */
export function ProgressDialog({
  plan,
  goal,
  corrects,
  open,
  onClose,
}: {
  plan: TherapyPlanDetail;
  goal: PlanGoal | null;
  corrects?: GoalProgressEntry | null;
  open: boolean;
  onClose: () => void;
}) {
  const { activeCenter } = useSession();
  const today = centerToday(activeCenter.timezone);
  const initial = React.useCallback(
    () => ({
      observationDate: corrects?.observationDate ?? today,
      goalStatus: (corrects?.goalStatus ??
        (goal?.status === 'NOT_STARTED' ? 'IN_PROGRESS' : (goal?.status ?? ''))) as
        TherapyGoalStatus | '',
      measuredValue:
        corrects?.measuredValue !== null && corrects?.measuredValue !== undefined
          ? String(corrects.measuredValue)
          : '',
      observation: corrects?.observation ?? '',
      correctionReason: '',
    }),
    [corrects, goal, today],
  );
  const [form, setForm] = React.useState(initial);
  const [shownFor, setShownFor] = React.useState<string | null>(null);
  const key = open ? `${goal?.id}-${corrects?.id ?? 'new'}` : null;
  if (key !== shownFor) {
    setShownFor(key);
    if (open) setForm(initial());
  }
  const set = (patch: Partial<ReturnType<typeof initial>>) => setForm((f) => ({ ...f, ...patch }));
  const mutation = useRecordProgress();
  const errors = isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {};
  if (!goal) return null;
  const numeric = MEASUREMENT_TYPES[goal.measurementType].numeric;
  const unit = measureUnit(goal.measurementType, goal.measurementConfig);
  const close = () => {
    mutation.reset();
    onClose();
  };
  const value = form.measuredValue.trim() ? Number(form.measuredValue) : null;
  const badValue = value !== null && !Number.isFinite(value);
  const empty = value === null && !form.observation.trim() && !form.goalStatus;
  const submit = () =>
    mutation.mutate(
      {
        id: plan.id,
        goalId: goal.id,
        input: {
          observationDate: form.observationDate,
          goalStatus: form.goalStatus || null,
          measuredValue: numeric ? value : null,
          observation: form.observation,
          ...(corrects && {
            correctsId: corrects.id,
            correctionReason: form.correctionReason.trim(),
          }),
        },
      },
      {
        onSuccess: () => {
          toast.success(corrects ? 'Entry corrected' : 'Progress recorded');
          close();
        },
        onError: (e) => {
          if (!(isApiError(e) && e.errors)) toast.error(e.message);
        },
      },
    );
  const baseline = describeLevel(goal.measurementType, goal.measurementConfig, goal.baseline);
  const target = describeLevel(goal.measurementType, goal.measurementConfig, goal.target);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{corrects ? 'Correct entry' : 'Record progress'}</DialogTitle>
          <DialogDescription>
            {goal.title}
            {(baseline || target) && (
              <span className="mt-1 block text-xs">
                {baseline && <>Baseline: {baseline}</>}
                {baseline && target && ' · '}
                {target && <>Target: {target}</>}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Observation date" required error={errors.observationDate}>
            <DatePicker
              value={form.observationDate}
              onChange={(v) => v && set({ observationDate: v })}
              disabledDays={{ after: new Date(`${today}T00:00:00`) }}
            />
          </Field>
          <Field
            label="Goal status"
            optional
            error={errors.goalStatus}
            helper="Your judgement; it also becomes the goal’s status."
          >
            <Select
              value={form.goalStatus || 'none'}
              onValueChange={(v) =>
                set({ goalStatus: v === 'none' ? '' : (v as TherapyGoalStatus) })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Don’t record</SelectItem>
                {Object.entries(GOAL_STATUSES).map(([k, s]) => (
                  <SelectItem key={k} value={k}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {numeric && (
            <Field
              label="Measured value"
              optional
              error={errors.measuredValue ?? (badValue ? 'Enter a number' : undefined)}
              className="sm:col-span-2"
            >
              <div className="flex items-center gap-2">
                <Input
                  inputMode="decimal"
                  className="w-32"
                  value={form.measuredValue}
                  onChange={(e) => set({ measuredValue: e.target.value })}
                />
                {unit && <span className="text-[13px] text-muted-foreground">{unit}</span>}
              </div>
            </Field>
          )}
          <Field label="Observation" optional error={errors.observation} className="sm:col-span-2">
            <Textarea
              rows={3}
              value={form.observation}
              onChange={(e) => set({ observation: e.target.value })}
              placeholder="What you observed"
            />
          </Field>
          {corrects && (
            <Field
              label="Why is it being corrected?"
              required
              error={errors.correctionReason}
              className="sm:col-span-2"
            >
              <Textarea
                rows={2}
                value={form.correctionReason}
                onChange={(e) => set({ correctionReason: e.target.value })}
              />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={mutation.isPending}
            disabled={
              empty || badValue || (Boolean(corrects) && form.correctionReason.trim().length < 3)
            }
          >
            {corrects ? 'Save correction' : 'Record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One progress entry, as shown in histories. */
export function ProgressEntryRow({
  goal,
  entry,
  onCorrect,
}: {
  goal: Pick<PlanGoal, 'measurementType' | 'measurementConfig'> & { title?: string };
  entry: GoalProgressEntry;
  onCorrect?: () => void;
}) {
  const fmt = useCenterFormat();
  const instant = useInstant();
  const value = formatMeasure(goal.measurementType, goal.measurementConfig, entry.measuredValue);
  return (
    <li className={entry.isCorrected ? 'opacity-60' : undefined}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium tabular">{fmt.date(entry.observationDate)}</span>
        {goal.title && <span className="text-muted-foreground">· {goal.title}</span>}
        {value && (
          <span className={entry.isCorrected ? 'line-through' : 'font-medium tabular'}>
            {value}
          </span>
        )}
        {entry.goalStatus && <GoalStatusBadge status={entry.goalStatus} />}
        {entry.isCorrected && <span className="text-xs text-muted-foreground">Corrected</span>}
        {entry.correctsId && (
          <span className="text-xs text-muted-foreground">
            Correction: “{entry.correctionReason}”
          </span>
        )}
      </div>
      {entry.observation && (
        <p
          className={`mt-0.5 whitespace-pre-line text-[13px] text-muted-foreground ${entry.isCorrected ? 'line-through' : ''}`}
        >
          {entry.observation}
        </p>
      )}
      <p className="mt-0.5 flex items-center gap-2 text-xs text-subtle-foreground">
        {entry.recordedBy.fullName} · {instant(entry.createdAt)}
        {onCorrect && !entry.isCorrected && (
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onCorrect}>
            <PencilLine className="size-3" /> Correct
          </Button>
        )}
      </p>
    </li>
  );
}

/** A goal's observations in the order they happened, with corrections. */
export function GoalHistoryDialog({
  plan,
  goalId,
  onClose,
  onCorrect,
}: {
  plan: TherapyPlanDetail;
  goalId: string | null;
  onClose: () => void;
  onCorrect?: (goal: PlanGoal, entry: GoalProgressEntry) => void;
}) {
  const history = useGoalProgress(plan.id, goalId);
  const goal = history.data?.goal ?? plan.goals.find((g) => g.id === goalId);
  return (
    <Dialog open={goalId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{goal?.title ?? 'Goal progress'}</DialogTitle>
          <DialogDescription>Every observation, oldest first.</DialogDescription>
        </DialogHeader>
        {history.isPending ? (
          <div className="grid gap-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : history.error ? (
          <ErrorState error={history.error} onRetry={() => void history.refetch()} />
        ) : history.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No progress recorded yet.</p>
        ) : (
          <ol className="grid gap-4 border-l border-border pl-4">
            {history.data.items.map((entry) => (
              <ProgressEntryRow
                key={entry.id}
                goal={history.data.goal}
                entry={entry}
                onCorrect={
                  onCorrect && plan.actions.recordProgress
                    ? () => onCorrect(history.data.goal, entry)
                    : undefined
                }
              />
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
