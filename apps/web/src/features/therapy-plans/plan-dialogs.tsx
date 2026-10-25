'use client';

import * as React from 'react';

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
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import { isApiError } from '@/lib/api/client';
import { useSchedulingSettings } from '@/lib/api/settings';
import {
  usePlanTransition,
  useReassignPlan,
  useRevisePlan,
  type AnyPlanDetail,
  type PlanTransition,
} from '@/lib/api/therapy-plans';
import { useTherapistList } from '@/lib/api/therapists';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import type { PlanPeriodUnit, TherapyPlanDetail } from '@/lib/types';
import { ScheduleFields, detailsInput } from './plan-form';

export type TransitionAction = PlanTransition['action'];

const STEPS: Record<
  TransitionAction,
  {
    title: string;
    description: string;
    label: string;
    done: string;
    field?: { key: 'reason' | 'note' | 'completionSummary'; label: string; required: boolean };
    tone?: 'danger';
  }
> = {
  activate: {
    title: 'Activate this plan?',
    description:
      'It becomes the patient’s treatment plan for this therapy. From now on, changes are kept in its history with a reason. Nothing is booked.',
    label: 'Activate plan',
    done: 'Plan activated',
  },
  pause: {
    title: 'Pause treatment?',
    description:
      'Progress can’t be recorded while paused. Appointments and packages aren’t changed; manage them separately.',
    label: 'Pause plan',
    done: 'Plan paused',
    field: { key: 'reason', label: 'Reason', required: true },
  },
  resume: {
    title: 'Resume treatment?',
    description: 'The plan becomes active again.',
    label: 'Resume plan',
    done: 'Plan resumed',
    field: { key: 'note', label: 'Note', required: false },
  },
  complete: {
    title: 'Complete this plan?',
    description:
      'A formal conclusion: the plan becomes read-only and stays in the patient’s history. Appointments and packages aren’t changed.',
    label: 'Complete plan',
    done: 'Plan completed',
    field: { key: 'completionSummary', label: 'Completion summary', required: true },
  },
  discontinue: {
    title: 'Discontinue this plan?',
    description:
      'Treatment stops before a formal conclusion. The plan becomes read-only and stays in the patient’s history.',
    label: 'Discontinue plan',
    done: 'Plan discontinued',
    field: { key: 'reason', label: 'Reason', required: true },
    tone: 'danger',
  },
};

/** Activate, pause, resume, complete or discontinue, with the reason each needs. */
export function TransitionDialog({
  plan,
  action,
  reviewId,
  onClose,
}: {
  plan: TherapyPlanDetail;
  action: TransitionAction | null;
  reviewId?: string;
  onClose: () => void;
}) {
  const mutation = usePlanTransition();
  const [text, setText] = React.useState('');
  const step = action ? STEPS[action] : null;
  const errors = isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {};
  const close = () => {
    setText('');
    mutation.reset();
    onClose();
  };
  const submit = () => {
    if (!action) return;
    const base = {
      revision: plan.revision,
      ...(reviewId && action !== 'activate' && { reviewId }),
    };
    const change: PlanTransition =
      action === 'activate'
        ? { action, revision: plan.revision }
        : action === 'resume'
          ? { action, ...base, ...(text.trim() && { note: text.trim() }) }
          : action === 'complete'
            ? { action, ...base, completionSummary: text.trim() }
            : { action, ...base, reason: text.trim() };
    mutation.mutate(
      { id: plan.id, change },
      {
        onSuccess: () => {
          toast.success(step!.done);
          close();
        },
        onError: (e) => {
          if (!(isApiError(e) && e.errors && step?.field && e.errors[step.field.key])) {
            toast.error(e.message);
          }
        },
      },
    );
  };
  return (
    <Dialog open={action !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        {step && (
          <>
            <DialogHeader>
              <DialogTitle>{step.title}</DialogTitle>
              <DialogDescription>{step.description}</DialogDescription>
            </DialogHeader>
            {step.field && (
              <Field
                label={step.field.label}
                required={step.field.required}
                optional={!step.field.required}
                error={errors[step.field.key]}
              >
                <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
            )}
            {isApiError(mutation.error) && !mutation.error.errors && (
              <p className="text-sm text-danger-foreground">{mutation.error.message}</p>
            )}
            <DialogFooter>
              <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button
                variant={step.tone === 'danger' ? 'danger' : 'primary'}
                onClick={submit}
                loading={mutation.isPending}
                disabled={Boolean(step.field?.required && text.trim().length < 3)}
              >
                {step.label}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A formal revision of an active plan: any of its details, with a reason. The values
 * before are kept in the plan's history.
 */
export function ReviseDialog({
  plan,
  open,
  reviewId,
  onClose,
}: {
  plan: TherapyPlanDetail;
  open: boolean;
  reviewId?: string;
  onClose: () => void;
}) {
  const initial = React.useMemo(
    () => ({
      title: plan.title,
      treatmentFocus: plan.treatmentFocus ?? '',
      clinicalNotes: plan.clinicalNotes ?? '',
      sessionsPerPeriod: plan.frequency.sessionsPerPeriod
        ? String(plan.frequency.sessionsPerPeriod)
        : '',
      frequencyUnit: (plan.frequency.unit ?? '') as PlanPeriodUnit | '',
      durationMinutes: plan.frequency.durationMinutes ? String(plan.frequency.durationMinutes) : '',
      additionalInstructions: plan.additionalInstructions ?? '',
      startDate: plan.startDate,
      targetEndDate: plan.targetEndDate ?? '',
      reviewIntervalValue: plan.reviewInterval.value ? String(plan.reviewInterval.value) : '',
      reviewIntervalUnit: (plan.reviewInterval.unit ?? '') as PlanPeriodUnit | '',
      nextReviewDate: plan.nextReviewDate ?? '',
    }),
    [plan],
  );
  const [form, setForm] = React.useState(initial);
  const [reason, setReason] = React.useState('');
  const [shownFor, setShownFor] = React.useState(open);
  if (open !== shownFor) {
    setShownFor(open);
    if (open) {
      setForm(initial);
      setReason('');
    }
  }
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const types = useTherapyTypeList({ status: 'all' });
  const scheduling = useSchedulingSettings();
  const durations = (types.data?.find((t) => t.id === plan.therapyType.id)?.durationOptions ?? [])
    .filter((o) => o.isActive)
    .map((o) => o.durationMinutes);
  const mutation = useRevisePlan();
  const errors = isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {};

  const submit = () => {
    const before = detailsInput(initial);
    const after = detailsInput(form);
    // Only what changed is sent, so the history names just that.
    const changes = Object.fromEntries(
      Object.entries(after).filter(
        ([k, v]) => (v ?? '') !== (before[k as keyof typeof before] ?? ''),
      ),
    );
    mutation.mutate(
      {
        id: plan.id,
        input: { ...changes, revision: plan.revision, reason: reason.trim(), reviewId },
      },
      {
        onSuccess: () => {
          toast.success('Plan revised');
          mutation.reset();
          onClose();
        },
        onError: (e) => {
          if (!(isApiError(e) && e.errors)) toast.error(e.message);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Revise plan</DialogTitle>
          <DialogDescription>
            Change what the treatment should be from now on. The earlier values stay in the plan’s
            history. Goals are changed from their own cards.
          </DialogDescription>
        </DialogHeader>
        {errors.reason === undefined && isApiError(mutation.error) && !mutation.error.errors && (
          <p className="text-sm text-danger-foreground">{mutation.error.message}</p>
        )}
        <div className="grid gap-4">
          <Field label="Plan title" required error={errors.title}>
            <Input value={form.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <ScheduleFields
            value={form}
            onChange={(patch) => set(patch as Partial<typeof form>)}
            errors={errors}
            durations={durations}
            allowCustomDuration={scheduling.data?.allowCustomDuration ?? false}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Start date" error={errors.startDate}>
              <DatePicker value={form.startDate} onChange={(v) => v && set({ startDate: v })} />
            </Field>
            <Field label="Target end date" optional error={errors.targetEndDate}>
              <DatePicker
                value={form.targetEndDate || undefined}
                onChange={(v) => set({ targetEndDate: v ?? '' })}
                placeholder="None"
              />
            </Field>
            <Field label="Next review date" optional error={errors.nextReviewDate}>
              <DatePicker
                value={form.nextReviewDate || undefined}
                onChange={(v) => set({ nextReviewDate: v ?? '' })}
                placeholder="None"
              />
            </Field>
          </div>
          <Field label="Treatment focus" optional error={errors.treatmentFocus}>
            <Textarea
              rows={2}
              value={form.treatmentFocus}
              onChange={(e) => set({ treatmentFocus: e.target.value })}
            />
          </Field>
          <Field label="Clinical notes" optional error={errors.clinicalNotes}>
            <Textarea
              rows={2}
              value={form.clinicalNotes}
              onChange={(e) => set({ clinicalNotes: e.target.value })}
            />
          </Field>
          <Field label="Reason for the revision" required error={errors.reason}>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Good progress at the 8-week review"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending} disabled={reason.trim().length < 3}>
            Save revision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Hands the plan to another therapist of the same therapy, with a reason. */
export function ReassignDialog({
  plan,
  open,
  onClose,
}: {
  plan: AnyPlanDetail;
  open: boolean;
  onClose: () => void;
}) {
  const [therapistId, setTherapistId] = React.useState('');
  const [reason, setReason] = React.useState('');
  const therapists = useTherapistList(
    { status: 'ACTIVE', therapyTypeId: plan.therapyType.id, pageSize: 100, sortBy: 'fullName' },
    open,
  );
  const options = (therapists.data?.items ?? []).filter(
    (t) => t.hasAccount && t.id !== plan.therapist.id,
  );
  const mutation = useReassignPlan();
  const errors = isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {};
  const close = () => {
    setTherapistId('');
    setReason('');
    mutation.reset();
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reassign plan</DialogTitle>
          <DialogDescription>
            {plan.therapist.fullName} is responsible now. Earlier progress and reviews keep their
            authors.
          </DialogDescription>
        </DialogHeader>
        <Field
          label="New responsible therapist"
          required
          error={errors.therapistId}
          helper={
            therapists.data && !options.length
              ? 'No other active therapist with a staff account provides this therapy.'
              : undefined
          }
        >
          <Select value={therapistId} onValueChange={setTherapistId} disabled={!options.length}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a therapist" />
            </SelectTrigger>
            <SelectContent>
              {options.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Reason" required error={errors.reason}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={!therapistId || reason.trim().length < 3}
            onClick={() =>
              mutation.mutate(
                {
                  id: plan.id,
                  input: { revision: plan.revision, therapistId, reason: reason.trim() },
                },
                {
                  onSuccess: (saved) => {
                    toast.success(`Reassigned to ${saved.therapist.fullName}`);
                    close();
                  },
                  onError: (e) => {
                    if (!(isApiError(e) && e.errors)) toast.error(e.message);
                  },
                },
              )
            }
          >
            Reassign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
