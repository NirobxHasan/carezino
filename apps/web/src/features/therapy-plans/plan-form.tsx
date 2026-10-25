'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { addDays, addMonths, addWeeks, format, parseISO } from 'date-fns';
import { AlertTriangle, ClipboardList, Plus, Save, Sparkles, Trash2, X } from 'lucide-react';

import { ColorDot } from '@/components/forms/color-picker';
import { DatePicker } from '@/components/forms/date-picker';
import { Field } from '@/components/forms/field';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
  useCreatePlan,
  useGoalCategories,
  usePatientPlans,
  usePlanAssessmentOptions,
  usePlanPatientOptions,
  useUpdateDraft,
  type PlanDetailsInput,
} from '@/lib/api/therapy-plans';
import { useTherapistList } from '@/lib/api/therapists';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session';
import type { PlanAssessmentOption, PlanPeriodUnit, TherapyPlanDetail } from '@/lib/types';
import { centerToday, useCenterFormat } from '../appointments/appointment-display';
import { ASSESSMENT_KINDS, describeRecommendation } from '../assessments/assessment-display';
import { PatientAvatar, formatPatientAge } from '../patients/patient-display';
import {
  GoalFields,
  badNumber,
  draftToInput,
  emptyGoal,
  goalErrors,
  goalToDraft,
  type GoalDraft,
} from './goal-fields';
import { PERIOD_UNITS, planLinks } from './plan-display';

interface ChosenPatient {
  id: string;
  code: string;
  fullName: string;
  photoUrl: string | null;
}

interface FormState {
  therapyTypeId: string;
  therapistId: string;
  sourceAssessmentId: string;
  title: string;
  treatmentFocus: string;
  clinicalNotes: string;
  sessionsPerPeriod: string;
  frequencyUnit: PlanPeriodUnit | '';
  durationMinutes: string;
  additionalInstructions: string;
  startDate: string;
  targetEndDate: string;
  reviewIntervalValue: string;
  reviewIntervalUnit: PlanPeriodUnit | '';
  nextReviewDate: string;
  goals: GoalDraft[];
}

const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

function fromPlan(plan: TherapyPlanDetail): FormState {
  return {
    therapyTypeId: plan.therapyType.id,
    therapistId: plan.therapist.id,
    sourceAssessmentId: plan.sourceAssessment?.id ?? '',
    title: plan.title,
    treatmentFocus: plan.treatmentFocus ?? '',
    clinicalNotes: plan.clinicalNotes ?? '',
    sessionsPerPeriod: str(plan.frequency.sessionsPerPeriod),
    frequencyUnit: plan.frequency.unit ?? '',
    durationMinutes: str(plan.frequency.durationMinutes),
    additionalInstructions: plan.additionalInstructions ?? '',
    startDate: plan.startDate,
    targetEndDate: plan.targetEndDate ?? '',
    reviewIntervalValue: str(plan.reviewInterval.value),
    reviewIntervalUnit: plan.reviewInterval.unit ?? '',
    nextReviewDate: plan.nextReviewDate ?? '',
    goals: plan.goals.map(goalToDraft),
  };
}

/** A center-local date plus an interval, e.g. start + 8 weeks. */
export function addInterval(date: string, value: number, unit: PlanPeriodUnit) {
  const d = parseISO(date);
  const next =
    unit === 'DAY' ? addDays(d, value) : unit === 'WEEK' ? addWeeks(d, value) : addMonths(d, value);
  return format(next, 'yyyy-MM-dd');
}

const intOrNull = (v: string) => (v.trim() ? Number(v) : null);

/** The plan's details as the API takes them; empty fields are cleared. */
export function detailsInput(
  f: Omit<FormState, 'goals' | 'therapyTypeId' | 'therapistId' | 'sourceAssessmentId'>,
): PlanDetailsInput {
  return {
    title: f.title.trim(),
    treatmentFocus: f.treatmentFocus,
    clinicalNotes: f.clinicalNotes,
    sessionsPerPeriod: intOrNull(f.sessionsPerPeriod),
    frequencyUnit: f.frequencyUnit || null,
    durationMinutes: intOrNull(f.durationMinutes),
    additionalInstructions: f.additionalInstructions,
    startDate: f.startDate,
    targetEndDate: f.targetEndDate || null,
    reviewIntervalValue: intOrNull(f.reviewIntervalValue),
    reviewIntervalUnit: f.reviewIntervalUnit || null,
    nextReviewDate: f.nextReviewDate || null,
  };
}

/** Sessions per period, session length, review interval: shared with revisions. */
export function ScheduleFields({
  value,
  onChange,
  errors,
  durations,
  allowCustomDuration,
}: {
  value: Pick<
    FormState,
    | 'sessionsPerPeriod'
    | 'frequencyUnit'
    | 'durationMinutes'
    | 'additionalInstructions'
    | 'reviewIntervalValue'
    | 'reviewIntervalUnit'
  >;
  onChange: (patch: Partial<FormState>) => void;
  errors: Record<string, string>;
  durations: number[];
  allowCustomDuration: boolean;
}) {
  const current = value.durationMinutes ? Number(value.durationMinutes) : null;
  const options = [...new Set([...durations, ...(current ? [current] : [])])].sort((a, b) => a - b);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        label="Recommended frequency"
        error={errors.sessionsPerPeriod ?? errors.frequencyUnit}
        helper="Needed to activate. A recommendation only: sessions are booked separately."
      >
        <div className="flex items-center gap-2">
          <Input
            inputMode="numeric"
            className="w-20"
            value={value.sessionsPerPeriod}
            onChange={(e) => onChange({ sessionsPerPeriod: e.target.value.replace(/\D/g, '') })}
            aria-label="Sessions"
            placeholder="3"
          />
          <span className="text-sm text-muted-foreground">sessions per</span>
          <Select
            value={value.frequencyUnit}
            onValueChange={(v) => onChange({ frequencyUnit: v as PlanPeriodUnit })}
          >
            <SelectTrigger className="w-28" aria-label="Per">
              <SelectValue placeholder="Period" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIOD_UNITS) as PlanPeriodUnit[]).map((u) => (
                <SelectItem key={u} value={u}>
                  {PERIOD_UNITS[u].per}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Field>
      <Field
        label="Session duration"
        optional
        error={errors.durationMinutes}
        helper={allowCustomDuration ? 'Any length in steps of 5 minutes.' : undefined}
      >
        {allowCustomDuration ? (
          <div className="flex items-center gap-2">
            <Input
              inputMode="numeric"
              className="w-24"
              value={value.durationMinutes}
              onChange={(e) => onChange({ durationMinutes: e.target.value.replace(/\D/g, '') })}
              list="plan-durations"
            />
            <datalist id="plan-durations">
              {options.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <span className="text-sm text-muted-foreground">minutes</span>
          </div>
        ) : (
          <Select
            value={value.durationMinutes || 'none'}
            onValueChange={(v) => onChange({ durationMinutes: v === 'none' ? '' : v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not set</SelectItem>
              {options.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m} minutes
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field
        label="Review interval"
        optional
        error={errors.reviewIntervalValue ?? errors.reviewIntervalUnit}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Every</span>
          <Input
            inputMode="numeric"
            className="w-20"
            value={value.reviewIntervalValue}
            onChange={(e) => onChange({ reviewIntervalValue: e.target.value.replace(/\D/g, '') })}
            aria-label="Review every"
            placeholder="8"
          />
          <Select
            value={value.reviewIntervalUnit}
            onValueChange={(v) => onChange({ reviewIntervalUnit: v as PlanPeriodUnit })}
          >
            <SelectTrigger className="w-28" aria-label="Review interval unit">
              <SelectValue placeholder="Unit" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIOD_UNITS) as PlanPeriodUnit[]).map((u) => (
                <SelectItem key={u} value={u}>
                  {PERIOD_UNITS[u].plural}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Field>
      <Field
        label="Additional instructions"
        optional
        error={errors.additionalInstructions}
        className="sm:col-span-2"
      >
        <Textarea
          rows={2}
          value={value.additionalInstructions}
          onChange={(e) => onChange({ additionalInstructions: e.target.value })}
          placeholder="e.g. Home programme between sessions"
        />
      </Field>
    </div>
  );
}

/** The chosen assessment's suggestions for this therapy, and its goals to copy. */
function AssessmentSuggestions({
  assessment,
  therapyTypeId,
  goals,
  onApply,
  onToggleGoal,
}: {
  assessment: PlanAssessmentOption;
  therapyTypeId: string;
  goals: GoalDraft[];
  onApply: () => void;
  onToggleGoal: (goal: PlanAssessmentOption['goals'][number], on: boolean) => void;
}) {
  const recommendation = assessment.recommendations.find((r) => r.therapyType.id === therapyTypeId);
  const imported = new Set(goals.map((g) => g.sourceAssessmentGoalId).filter(Boolean));
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
      {assessment.summary && (
        <p className="text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">Summary: </span>
          {assessment.summary}
        </p>
      )}
      {recommendation ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>
            <span className="font-medium">Recommended: </span>
            {describeRecommendation(recommendation) || 'No frequency suggested'}
            {recommendation.note && (
              <span className="block text-[13px] text-muted-foreground">{recommendation.note}</span>
            )}
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={onApply}>
            <Sparkles /> Use these suggestions
          </Button>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          No recommendation for this therapy in the assessment.
        </p>
      )}
      {assessment.goals.length > 0 && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 font-medium">Initial goals to copy into the plan</legend>
          {assessment.goals.map((g) => (
            <label key={g.id} className="flex items-start gap-2">
              <Checkbox
                checked={imported.has(g.id)}
                onCheckedChange={(on) => onToggleGoal(g, on === true)}
                className="mt-0.5"
              />
              <span>
                {g.title}
                {g.description && (
                  <span className="block text-[13px] text-muted-foreground">{g.description}</span>
                )}
              </span>
            </label>
          ))}
          <p className="text-xs text-muted-foreground">
            Copied goals become the plan’s own; editing them never changes the assessment.
          </p>
        </fieldset>
      )}
    </div>
  );
}

/**
 * Creating a plan, or editing a draft. Suggestions from a completed assessment are
 * starting points the therapist reviews and edits; nothing is final until the plan is
 * activated from its page.
 */
export function PlanForm({
  plan,
  onSaved,
}: {
  plan?: TherapyPlanDetail;
  /** After saving and navigating away; the page uses it to start the form over */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const { activeCenter, can } = useSession();
  const fmt = useCenterFormat();
  const today = centerToday(activeCenter.timezone);
  const editing = Boolean(plan);

  // ── Patient ──
  const [picked, setPicked] = React.useState<ChosenPatient | null>(
    plan ? { ...plan.patient } : null,
  );
  const [cleared, setCleared] = React.useState(false);
  const [patientQuery, setPatientQuery] = React.useState('');
  const debounced = useDebounced(patientQuery, 250);
  const prefillPatientId = cleared ? undefined : (search.get('patientId') ?? undefined);
  const patientOptions = usePlanPatientOptions(debounced, !picked);
  const patientPlans = usePatientPlans(
    picked?.id ?? prefillPatientId ?? '',
    Boolean(picked?.id ?? prefillPatientId),
  );
  // Arriving from a patient or an assessment: the patient comes from their plan list.
  if (!picked && prefillPatientId && patientPlans.data?.patient) {
    setPicked({ ...patientPlans.data.patient, photoUrl: null });
  }
  const patientId = picked?.id;

  // ── Form ──
  const [form, setForm] = React.useState<FormState>(() =>
    plan
      ? fromPlan(plan)
      : {
          therapyTypeId: search.get('therapyTypeId') ?? '',
          therapistId: '',
          sourceAssessmentId: search.get('assessmentId') ?? '',
          title: '',
          treatmentFocus: '',
          clinicalNotes: '',
          sessionsPerPeriod: '',
          frequencyUnit: '',
          durationMinutes: '',
          additionalInstructions: '',
          startDate: today,
          targetEndDate: '',
          reviewIntervalValue: '',
          reviewIntervalUnit: '',
          nextReviewDate: '',
          goals: [],
        },
  );
  const [titleTouched, setTitleTouched] = React.useState(editing);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const types = useTherapyTypeList({ status: 'ACTIVE' });
  const type = types.data?.find((t) => t.id === form.therapyTypeId);
  const scheduling = useSchedulingSettings();
  const categories = useGoalCategories(
    { therapyTypeId: form.therapyTypeId, status: 'all' },
    Boolean(form.therapyTypeId),
  );

  const therapists = useTherapistList(
    { status: 'ACTIVE', therapyTypeId: form.therapyTypeId, pageSize: 100, sortBy: 'fullName' },
    Boolean(form.therapyTypeId),
  );
  // The responsible therapist runs the plan, so they need a staff account.
  const leads = (therapists.data?.items ?? []).filter((t) => t.hasAccount);
  const therapistId =
    leads.find((t) => t.id === form.therapistId)?.id ??
    leads.find((t) => t.isYou)?.id ??
    (leads.length === 1 ? leads[0].id : '');

  // ── Assessment ──
  const assessments = usePlanAssessmentOptions(patientId);
  const assessment = assessments.data?.items.find((a) => a.id === form.sourceAssessmentId);
  const recommendationFor = (a: PlanAssessmentOption, typeId: string) =>
    a.recommendations.find((r) => r.therapyType.id === typeId);

  const applySuggestions = (a: PlanAssessmentOption, typeId: string, base: FormState) => {
    const r = recommendationFor(a, typeId);
    const patch: Partial<FormState> = {};
    if (r?.sessionsPerWeek) {
      patch.sessionsPerPeriod = String(r.sessionsPerWeek);
      patch.frequencyUnit = 'WEEK';
    }
    if (r?.durationMinutes) patch.durationMinutes = String(r.durationMinutes);
    if (r?.reviewAfterWeeks) {
      patch.reviewIntervalValue = String(r.reviewAfterWeeks);
      patch.reviewIntervalUnit = 'WEEK';
      patch.nextReviewDate = addInterval(base.startDate, r.reviewAfterWeeks, 'WEEK');
    } else if (a.suggestedReviewDate && a.suggestedReviewDate >= base.startDate) {
      patch.nextReviewDate = a.suggestedReviewDate;
    }
    return patch;
  };

  const importGoal = (g: PlanAssessmentOption['goals'][number]): GoalDraft =>
    emptyGoal({
      sourceAssessmentGoalId: g.id,
      title: g.title,
      description: g.description ?? '',
      priority: g.priority ?? '',
      targetDate: g.targetReviewDate ?? '',
    });

  // From "Create therapy plan" on an assessment: its therapy, suggestions and goals
  // are filled in once, for the therapist to review.
  const [prefilled, setPrefilled] = React.useState(editing || !search.get('assessmentId'));
  if (!prefilled && assessment) {
    setPrefilled(true);
    const typeId = form.therapyTypeId || assessment.therapyType.id;
    setForm((f) => ({
      ...f,
      therapyTypeId: typeId,
      ...applySuggestions(assessment, typeId, f),
      goals: f.goals.length ? f.goals : assessment.goals.map(importGoal),
    }));
  }

  const chooseAssessment = (id: string) => {
    const a = assessments.data?.items.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      sourceAssessmentId: id,
      ...(a && !f.therapyTypeId && { therapyTypeId: a.therapyType.id }),
      // Goals copied from another assessment lose that link.
      goals: f.goals.map((g) =>
        g.sourceAssessmentGoalId && !a?.goals.some((x) => x.id === g.sourceAssessmentGoalId)
          ? { ...g, sourceAssessmentGoalId: null }
          : g,
      ),
    }));
  };

  // Default title from the therapy, until the therapist types their own.
  const title = titleTouched || !type ? form.title : `${type.name} treatment plan`;

  const openPlan = patientPlans.data?.items.find(
    (p) =>
      p.id !== plan?.id &&
      p.therapyType.id === form.therapyTypeId &&
      (p.status === 'ACTIVE' || p.status === 'PAUSED'),
  );

  // ── Saving ──
  const create = useCreatePlan();
  const update = useUpdateDraft();
  const mutation = editing ? update : create;
  const apiErrors = isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {};
  const [localErrors, setLocalErrors] = React.useState<Record<string, string>>({});
  const errors = { ...apiErrors, ...localErrors };
  const needsAssessment = !can('therapy_plans.create_without_assessment');
  const ready = Boolean(
    patientId &&
    form.therapyTypeId &&
    therapistId &&
    title.trim() &&
    form.startDate &&
    (!needsAssessment || form.sourceAssessmentId),
  );

  const submit = () => {
    const local: Record<string, string> = {};
    form.goals.forEach((g, i) => {
      if (!g.title.trim()) local[`goals.${i}.title`] = 'Goal title is required';
      for (const [k, v] of Object.entries(badNumber(g))) local[`goals.${i}.${k}`] = v;
    });
    setLocalErrors(local);
    if (Object.keys(local).length || !ready) return;
    const details = detailsInput({ ...form, title });
    const goals = form.goals.map(draftToInput);
    const onError = (e: Error) => {
      if (!(isApiError(e) && e.errors)) toast.error(e.message);
    };
    if (plan) {
      update.mutate(
        {
          id: plan.id,
          input: {
            ...details,
            revision: plan.revision,
            therapyTypeId: form.therapyTypeId,
            therapistId,
            sourceAssessmentId: form.sourceAssessmentId || null,
            goals,
          },
        },
        {
          onSuccess: (saved) => {
            toast.success('Draft saved');
            router.push(planLinks.detail(saved.id));
            onSaved?.();
          },
          onError,
        },
      );
      return;
    }
    create.mutate(
      {
        ...details,
        title,
        startDate: form.startDate,
        patientId: patientId!,
        therapyTypeId: form.therapyTypeId,
        therapistId,
        sourceAssessmentId: form.sourceAssessmentId || null,
        goals,
      },
      {
        onSuccess: (saved) => {
          toast.success('Draft plan saved', {
            description: `${saved.code} · ${saved.patient.fullName}. Review it, then activate.`,
          });
          router.push(planLinks.detail(saved.id));
          onSaved?.();
        },
        onError,
      },
    );
  };

  const goalError = (i: number) => goalErrors(errors, `goals.${i}`);
  const durations = (type?.durationOptions ?? [])
    .filter((o) => o.isActive)
    .map((o) => o.durationMinutes);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
      <div className="grid content-start gap-4">
        {/* 1 — Patient & assessment */}
        <Card>
          <CardHeader>
            <CardTitle>Patient and assessment</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Patient" required error={errors.patientId}>
              {picked ? (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
                  <PatientAvatar patient={picked} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{picked.fullName}</p>
                    <p className="text-[13px] text-muted-foreground">{picked.code}</p>
                  </div>
                  {!editing && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Choose another patient"
                      onClick={() => {
                        setPicked(null);
                        setCleared(true);
                        // Goals copied from this patient's assessment don't carry over.
                        setForm((f) => ({
                          ...f,
                          sourceAssessmentId: '',
                          goals: f.goals.filter((g) => !g.sourceAssessmentGoalId),
                        }));
                      }}
                    >
                      <X />
                    </Button>
                  )}
                </div>
              ) : (
                <SearchableSelect
                  options={(patientOptions.data?.items ?? []).map((p) => ({
                    value: p.id,
                    label: p.fullName,
                    description: [p.code, formatPatientAge(p.age)].filter(Boolean).join(' · '),
                    leading: <PatientAvatar patient={p} size="sm" />,
                  }))}
                  onChange={(id) => {
                    const p = patientOptions.data?.items.find((x) => x.id === id);
                    if (p) setPicked(p);
                  }}
                  onSearch={setPatientQuery}
                  loading={patientOptions.isFetching && !patientOptions.data}
                  placeholder="Search by name or patient ID"
                  searchPlaceholder="Name or patient ID…"
                  emptyText={
                    can('patients.read')
                      ? 'No patients found.'
                      : 'No patients found. You can plan for patients in your care.'
                  }
                />
              )}
            </Field>
            <Field
              label="Source assessment"
              required={needsAssessment}
              optional={!needsAssessment}
              error={errors.sourceAssessmentId}
              helper={
                patientId && assessments.data && !assessments.data.items.length
                  ? 'No completed assessments you can read for this patient.'
                  : 'A completed assessment this plan is based on. It is never changed by the plan.'
              }
            >
              <Select
                value={form.sourceAssessmentId || 'none'}
                onValueChange={(v) => chooseAssessment(v === 'none' ? '' : v)}
                disabled={!patientId}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!needsAssessment && <SelectItem value="none">No assessment</SelectItem>}
                  {assessments.data?.items.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex items-center gap-2">
                        <ColorDot color={a.therapyType.color} />
                        {ASSESSMENT_KINDS[a.type]} · {a.therapyType.code} ·{' '}
                        {fmt.date(a.assessmentDate)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {assessment && form.therapyTypeId && (
              <AssessmentSuggestions
                assessment={assessment}
                therapyTypeId={form.therapyTypeId}
                goals={form.goals}
                onApply={() => set(applySuggestions(assessment, form.therapyTypeId, form))}
                onToggleGoal={(g, on) =>
                  setForm((f) => ({
                    ...f,
                    goals: on
                      ? [...f.goals, importGoal(g)]
                      : f.goals.filter((x) => x.sourceAssessmentGoalId !== g.id),
                  }))
                }
              />
            )}
          </CardContent>
        </Card>

        {/* 2 — Treatment */}
        <Card>
          <CardHeader>
            <CardTitle>Treatment</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Therapy" required error={errors.therapyTypeId}>
              <Select
                value={form.therapyTypeId}
                onValueChange={(v) =>
                  set({ therapyTypeId: v, therapistId: '', durationMinutes: '' })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a therapy" />
                </SelectTrigger>
                <SelectContent>
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
            </Field>
            <Field
              label="Responsible therapist"
              required
              error={errors.therapistId}
              helper={
                form.therapyTypeId && therapists.data && !leads.length
                  ? 'No active therapist with a staff account provides this therapy.'
                  : undefined
              }
            >
              <Select
                value={therapistId}
                onValueChange={(v) => set({ therapistId: v })}
                disabled={!form.therapyTypeId || !leads.length}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a therapist" />
                </SelectTrigger>
                <SelectContent>
                  {leads.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.fullName}
                      {t.isYou && <span className="text-muted-foreground"> (you)</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Plan title" required error={errors.title} className="sm:col-span-2">
              <Input
                value={title}
                onChange={(e) => {
                  setTitleTouched(true);
                  set({ title: e.target.value });
                }}
                maxLength={200}
              />
            </Field>
            <Field
              label="Treatment focus"
              optional
              error={errors.treatmentFocus}
              className="sm:col-span-2"
            >
              <Textarea
                rows={3}
                value={form.treatmentFocus}
                onChange={(e) => set({ treatmentFocus: e.target.value })}
                placeholder="The main areas this treatment works on"
              />
            </Field>
            <Field
              label="Clinical notes"
              optional
              error={errors.clinicalNotes}
              className="sm:col-span-2"
            >
              <Textarea
                rows={2}
                value={form.clinicalNotes}
                onChange={(e) => set({ clinicalNotes: e.target.value })}
              />
            </Field>
          </CardContent>
        </Card>

        {/* 3 — Frequency & duration */}
        <Card>
          <CardHeader>
            <CardTitle>Frequency and duration</CardTitle>
          </CardHeader>
          <CardContent>
            <ScheduleFields
              value={form}
              onChange={set}
              errors={errors}
              durations={durations}
              allowCustomDuration={scheduling.data?.allowCustomDuration ?? false}
            />
          </CardContent>
        </Card>

        {/* 4 — Goals */}
        <Card>
          <CardHeader>
            <CardTitle>Goals</CardTitle>
            <CardDescription>
              At least one goal is needed to activate. Goals don’t need numbers: describe them when
              that fits better.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {errors.goals && <p className="text-sm text-danger-foreground">{errors.goals}</p>}
            {form.goals.map((g, i) => (
              <div key={g.key} className="rounded-lg border border-border p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    Goal {i + 1}
                    {g.sourceAssessmentGoalId && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                        <ClipboardList className="size-3" aria-hidden /> From assessment
                      </span>
                    )}
                  </p>
                  <Button
                    variant="danger-ghost"
                    size="icon-sm"
                    aria-label={`Remove goal ${i + 1}`}
                    onClick={() => set({ goals: form.goals.filter((x) => x.key !== g.key) })}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <GoalFields
                  value={g}
                  onChange={(patch) =>
                    setForm((f) => ({
                      ...f,
                      goals: f.goals.map((x) => (x.key === g.key ? { ...x, ...patch } : x)),
                    }))
                  }
                  errors={goalError(i)}
                  categories={categories.data ?? []}
                />
              </div>
            ))}
            <Button
              variant="secondary"
              className="justify-self-start"
              onClick={() => set({ goals: [...form.goals, emptyGoal()] })}
              disabled={form.goals.length >= 30}
            >
              <Plus /> Add goal
            </Button>
          </CardContent>
        </Card>

        {/* 5 — Review schedule */}
        <Card>
          <CardHeader>
            <CardTitle>Treatment period and review</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Field label="Start date" required error={errors.startDate}>
              <DatePicker value={form.startDate} onChange={(v) => set({ startDate: v ?? today })} />
            </Field>
            <Field label="Target end date" optional error={errors.targetEndDate}>
              <DatePicker
                value={form.targetEndDate || undefined}
                onChange={(v) => set({ targetEndDate: v ?? '' })}
                placeholder="None"
              />
            </Field>
            <Field
              label="Next review date"
              optional
              error={errors.nextReviewDate}
              helper="A clinical follow-up target; nothing is booked."
              labelAction={
                form.reviewIntervalValue && form.reviewIntervalUnit ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() =>
                      set({
                        nextReviewDate: addInterval(
                          form.startDate,
                          Number(form.reviewIntervalValue),
                          form.reviewIntervalUnit as PlanPeriodUnit,
                        ),
                      })
                    }
                  >
                    From interval
                  </Button>
                ) : undefined
              }
            >
              <DatePicker
                value={form.nextReviewDate || undefined}
                onChange={(v) => set({ nextReviewDate: v ?? '' })}
                placeholder="None"
              />
            </Field>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle>{editing ? 'Save draft' : 'Save as draft'}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-[13px] text-muted-foreground">
          <p>
            The plan is saved as a draft you can come back to. It takes effect when you activate it
            from its page. Nothing is booked, sold or billed.
          </p>
          {openPlan && (
            <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning-subtle p-3 text-warning-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {picked?.fullName} already has a {openPlan.status.toLowerCase()}{' '}
                {openPlan.therapyType.code} plan ({openPlan.code}). This one can be saved, but not
                activated until that one is completed or discontinued.{' '}
                <Link href={planLinks.detail(openPlan.id)} className="font-medium underline">
                  Open it
                </Link>
              </span>
            </p>
          )}
          {needsAssessment && !form.sourceAssessmentId && (
            <p>Plans you start need a completed assessment as their source.</p>
          )}
          <Button onClick={submit} disabled={!ready} loading={mutation.isPending}>
            <Save /> {editing ? 'Save draft' : 'Save draft plan'}
          </Button>
          <Button variant="secondary" asChild>
            <Link href={plan ? planLinks.detail(plan.id) : planLinks.list}>Cancel</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
