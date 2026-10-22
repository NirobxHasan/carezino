'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { ColorDot } from '@/components/forms/color-picker';
import { DatePicker } from '@/components/forms/date-picker';
import { Field } from '@/components/forms/field';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  useAmendAssessment,
  useCompleteAssessment,
  useDiscardAssessment,
  useSaveAssessment,
  type AssessmentContentInput,
} from '@/lib/api/assessments';
import { isApiError } from '@/lib/api/client';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import { useSession } from '@/lib/session';
import type {
  AnswerValue,
  AssessmentDetail,
  AssessmentKind,
  ClinicalSummaryKey,
  GoalPriority,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { centerToday, useCenterFormat } from '../appointments/appointment-display';
import { PATIENT_GENDERS, REFERRAL_SOURCES, formatPatientAge } from '../patients/patient-display';
import {
  ASSESSMENT_KINDS,
  AssessmentStatusBadge,
  GOAL_PRIORITIES,
  SUMMARY_FIELDS,
  TemplateLabel,
  assessmentLinks,
} from './assessment-display';
import {
  SectionFields,
  checkAnswers,
  cleanAnswers,
  isAnswered,
  type DraftAnswers,
} from './dynamic-form';

interface RecommendationRow {
  key: string;
  therapyTypeId: string;
  sessionsPerWeek: string;
  durationMinutes: string;
  reviewAfterWeeks: string;
  note: string;
}

interface GoalRow {
  key: string;
  title: string;
  description: string;
  priority: GoalPriority | '';
  targetReviewDate: string;
}

type Summary = Record<ClinicalSummaryKey, string> & { suggestedReviewDate: string };

interface EditorState {
  type: AssessmentKind;
  assessmentDate: string;
  answers: DraftAnswers;
  summary: Summary;
  recommendations: RecommendationRow[];
  goals: GoalRow[];
}

const LIMITS = {
  sessionsPerWeek: [1, 21],
  durationMinutes: [5, 480],
  reviewAfterWeeks: [1, 104],
} as const;

let rowCounter = 0;
const rowKey = () => `row-${++rowCounter}`;

function fromDetail(a: AssessmentDetail): EditorState {
  const s = a.content.clinicalSummary;
  return {
    type: a.type,
    assessmentDate: a.assessmentDate,
    answers: { ...a.content.answers },
    summary: {
      summary: s.summary ?? '',
      keyFindings: s.keyFindings ?? '',
      strengths: s.strengths ?? '',
      areasOfDifficulty: s.areasOfDifficulty ?? '',
      clinicalImpression: s.clinicalImpression ?? '',
      followUpRecommendation: s.followUpRecommendation ?? '',
      additionalRecommendations: s.additionalRecommendations ?? '',
      suggestedReviewDate: s.suggestedReviewDate ?? '',
    },
    recommendations: a.content.recommendations.map((r) => ({
      key: rowKey(),
      therapyTypeId: r.therapyType.id,
      sessionsPerWeek: r.sessionsPerWeek?.toString() ?? '',
      durationMinutes: r.durationMinutes?.toString() ?? '',
      reviewAfterWeeks: r.reviewAfterWeeks?.toString() ?? '',
      note: r.note ?? '',
    })),
    goals: a.content.goals.map((g) => ({
      key: rowKey(),
      title: g.title,
      description: g.description ?? '',
      priority: g.priority ?? '',
      targetReviewDate: g.targetReviewDate ?? '',
    })),
  };
}

const toNumber = (v: string) => (v.trim() === '' ? null : Number(v));

/** The editor's state as the API takes it (without the revision). */
function toInput(
  state: EditorState,
  form: AssessmentDetail['form'],
): Omit<AssessmentContentInput, 'revision'> {
  const s = state.summary;
  return {
    type: state.type,
    assessmentDate: state.assessmentDate,
    answers: cleanAnswers(form, state.answers),
    clinicalSummary: {
      ...Object.fromEntries(
        (Object.keys(s) as (keyof Summary)[]).map((k) => [k, s[k].trim() || null]),
      ),
    },
    recommendations: state.recommendations.map((r) => ({
      therapyTypeId: r.therapyTypeId,
      sessionsPerWeek: toNumber(r.sessionsPerWeek),
      durationMinutes: toNumber(r.durationMinutes),
      reviewAfterWeeks: toNumber(r.reviewAfterWeeks),
      note: r.note.trim(),
    })),
    goals: state.goals.map((g) => ({
      title: g.title.trim(),
      description: g.description.trim(),
      priority: g.priority || null,
      targetReviewDate: g.targetReviewDate || null,
    })),
  };
}

/** What the browser can tell is wrong before saving; keys match the API's error paths. */
function checkState(state: EditorState, form: AssessmentDetail['form'], complete: boolean) {
  const errors: Record<string, string> = {};
  for (const [key, message] of Object.entries(checkAnswers(form, state.answers, { complete }))) {
    errors[`answers.${key}`] = message;
  }
  if (complete && !state.summary.summary.trim()) {
    errors['clinicalSummary.summary'] = 'Write an assessment summary to complete the assessment';
  }
  const seen = new Set<string>();
  state.recommendations.forEach((r, i) => {
    if (!r.therapyTypeId) errors[`recommendations.${i}.therapyTypeId`] = 'Choose a therapy';
    else if (seen.has(r.therapyTypeId)) {
      errors[`recommendations.${i}.therapyTypeId`] = 'Already recommended above';
    }
    seen.add(r.therapyTypeId);
    for (const [k, [min, max]] of Object.entries(LIMITS)) {
      const raw = r[k as keyof typeof LIMITS];
      if (raw.trim() === '') continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < min || n > max) {
        errors[`recommendations.${i}.${k}`] = `Enter ${min} to ${max}`;
      }
    }
  });
  state.goals.forEach((g, i) => {
    if (!g.title.trim()) errors[`goals.${i}.title`] = 'Goal title is required';
  });
  return errors;
}

function move<T>(list: T[], from: number, to: number) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function SectionCard({
  id,
  title,
  description,
  children,
  actions,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Patient, therapist and booking at a glance, from registration rather than re-entered. */
function ContextCard({ assessment: a }: { assessment: AssessmentDetail }) {
  const fmt = useCenterFormat();
  const p = a.patient;
  const referral =
    p.referralSource === 'OTHER'
      ? p.referralOther
      : p.referralSource && REFERRAL_SOURCES[p.referralSource];
  const rows: [string, React.ReactNode][] = [
    ['Patient ID', p.code],
    ['Age at assessment', formatPatientAge(p.ageAtAssessment)],
    ['Gender', p.gender && PATIENT_GENDERS[p.gender]],
    ['Concern at registration', p.primaryConcern],
    ['Referral source', referral],
    [
      'Therapist',
      `${a.therapist.fullName}${a.therapist.designation ? `, ${a.therapist.designation}` : ''}`,
    ],
    [
      'Appointment',
      a.appointment && (
        <Link href={`/appointments/${a.appointment.id}`} className="text-primary hover:underline">
          {fmt.shortDate(a.appointment.date)}, {fmt.clock(a.appointment.startTime)}
        </Link>
      ),
    ],
  ];
  return (
    <dl className="grid gap-3 text-sm">
      {rows
        .filter(([, v]) => v)
        .map(([label, value]) => (
          <div key={label} className="grid gap-0.5">
            <dt className="text-[13px] text-muted-foreground">{label}</dt>
            <dd className="whitespace-pre-line">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

/**
 * The clinical form for a draft (save, then complete and sign) or a completed assessment
 * being corrected (amend, with a reason). The form is the assessment's own template
 * version, whatever the template looks like now.
 */
export function AssessmentEditor({
  assessment: a,
  mode,
  onReload,
}: {
  assessment: AssessmentDetail;
  mode: 'draft' | 'amend';
  /** Throw local changes away and load the latest version */
  onReload: () => void;
}) {
  const router = useRouter();
  const { activeCenter } = useSession();
  const today = centerToday(activeCenter.timezone);
  const types = useTherapyTypeList({ status: 'all' });
  const [state, setState] = React.useState(() => fromDetail(a));
  const [baseline, setBaseline] = React.useState(() =>
    JSON.stringify(toInput(fromDetail(a), a.form)),
  );
  const [clientErrors, setClientErrors] = React.useState<Record<string, string>>({});
  const [confirming, setConfirming] = React.useState<'complete' | 'amend' | 'discard' | null>(null);
  const [reason, setReason] = React.useState('');
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);

  const save = useSaveAssessment();
  const complete = useCompleteAssessment();
  const amend = useAmendAssessment();
  const discard = useDiscardAssessment();
  const pending = save.isPending || complete.isPending || amend.isPending;
  const lastError = save.error ?? complete.error ?? amend.error;
  const conflict = isApiError(lastError, 409) && lastError.code === 'ASSESSMENT_CHANGED';

  const input = toInput(state, a.form);
  const dirty = JSON.stringify(input) !== baseline;
  useUnsavedChanges(dirty);

  const serverErrors = isApiError(lastError) ? (lastError.errors ?? {}) : {};
  const errors = { ...serverErrors, ...clientErrors };
  const answerErrors = Object.fromEntries(
    Object.entries(errors)
      .filter(([k]) => k.startsWith('answers.'))
      .map(([k, v]) => [k.slice('answers.'.length), v]),
  );

  const patch = (p: Partial<EditorState>) => {
    setState((s) => ({ ...s, ...p }));
    setClientErrors({});
  };
  const setAnswer = (key: string, value: AnswerValue | undefined) =>
    setState((s) => ({ ...s, answers: { ...s.answers, [key]: value } }));
  const setSummary = (key: keyof Summary, value: string) =>
    setState((s) => ({ ...s, summary: { ...s.summary, [key]: value } }));
  const setRec = (i: number, p: Partial<RecommendationRow>) =>
    setState((s) => ({
      ...s,
      recommendations: s.recommendations.map((r, j) => (j === i ? { ...r, ...p } : r)),
    }));
  const setGoal = (i: number, p: Partial<GoalRow>) =>
    setState((s) => ({ ...s, goals: s.goals.map((g, j) => (j === i ? { ...g, ...p } : g)) }));

  /** Shows errors and scrolls to the first; true when there were none. */
  const validate = (forCompletion: boolean) => {
    const found = checkState(state, a.form, forCompletion);
    setClientErrors(found);
    const first = Object.keys(found)[0];
    if (!first) return true;
    const target = first.startsWith('answers.')
      ? document.querySelector(`[data-field="${first.slice(8)}"]`)
      : document.getElementById(first.split('.')[0]);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast.error(
      `${Object.keys(found).length} field${Object.keys(found).length === 1 ? ' needs' : 's need'} attention`,
    );
    return false;
  };

  const onError = (e: Error) => {
    // A conflict shows its own banner; field errors appear inline, with this summary.
    if (isApiError(e, 409) && e.code === 'ASSESSMENT_CHANGED') return;
    toast.error(e.message);
  };

  const saveDraft = () => {
    if (!validate(false)) return;
    const sent = JSON.stringify(input);
    save.mutate(
      { id: a.id, input: { ...input, revision: a.revision } },
      {
        onSuccess: () => {
          setBaseline(sent);
          setSavedAt(new Date());
          toast.success('Draft saved');
        },
        onError,
      },
    );
  };

  const doComplete = () => {
    complete.mutate(
      { id: a.id, input: { ...input, revision: a.revision } },
      {
        onSuccess: () => {
          setBaseline(JSON.stringify(input));
          setConfirming(null);
          toast.success('Assessment completed', {
            description: 'It’s now part of the patient’s clinical history.',
          });
        },
        onError: (e) => {
          setConfirming(null);
          onError(e);
        },
      },
    );
  };

  const doAmend = () => {
    amend.mutate(
      { id: a.id, input: { ...input, revision: a.revision, reason: reason.trim() } },
      {
        onSuccess: () => {
          setBaseline(JSON.stringify(input));
          setConfirming(null);
          toast.success('Amendment saved', { description: 'The earlier version is kept.' });
          router.replace(assessmentLinks.detail(a.id));
        },
        onError: (e) => {
          if (!(isApiError(e) && e.errors?.reason)) setConfirming(null);
          onError(e);
        },
      },
    );
  };

  // Ctrl/Cmd+S saves the draft.
  const onSaveShortcut = React.useEffectEvent((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveDraft();
    }
  });
  React.useEffect(() => {
    if (mode !== 'draft') return;
    const handler = (e: KeyboardEvent) => onSaveShortcut(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode]);

  const leave = () => {
    if (dirty && !window.confirm('Leave without saving? Your changes will be lost.')) return;
    router.push(mode === 'amend' ? assessmentLinks.detail(a.id) : assessmentLinks.list);
  };

  // ── Progress: required questions answered, per section ──
  const sections = a.form.sections.map((s) => {
    const required = s.fields.filter((f) => f.required);
    const answered = s.fields.filter((f) => isAnswered(state.answers[f.key])).length;
    const requiredDone = required.filter((f) => isAnswered(state.answers[f.key])).length;
    return {
      key: s.key,
      title: s.title,
      answered,
      total: s.fields.length,
      required: required.length,
      requiredDone,
    };
  });
  const requiredTotal = sections.reduce((n, s) => n + s.required, 0) + 1;
  const requiredDone =
    sections.reduce((n, s) => n + s.requiredDone, 0) + (state.summary.summary.trim() ? 1 : 0);
  const nav = [
    { id: 'details', title: 'Details', done: true },
    ...sections.map((s) => ({
      id: `section-${s.key}`,
      title: s.title,
      done: s.requiredDone === s.required && (s.required > 0 || s.answered > 0),
      hint: `${s.answered}/${s.total}`,
    })),
    {
      id: 'clinicalSummary',
      title: 'Clinical summary',
      done: Boolean(state.summary.summary.trim()),
    },
    { id: 'recommendations', title: 'Recommendations', done: state.recommendations.length > 0 },
    { id: 'goals', title: 'Initial goals', done: state.goals.length > 0 },
  ];

  const saveState = pending
    ? 'Saving…'
    : dirty
      ? 'Unsaved changes'
      : savedAt
        ? `Saved at ${savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : mode === 'draft'
          ? 'All changes saved'
          : 'No changes yet';

  const typeOptions = (types.data ?? []).filter(
    (t) => t.isActive || state.recommendations.some((r) => r.therapyTypeId === t.id),
  );

  return (
    <>
      <PageHeader
        back={
          mode === 'amend'
            ? { href: assessmentLinks.detail(a.id), label: 'Back to assessment' }
            : { href: assessmentLinks.list, label: 'Assessments' }
        }
        title={a.patient.fullName}
        description={`${ASSESSMENT_KINDS[a.type]} · ${a.therapyType.name}`}
        meta={
          <>
            <AssessmentStatusBadge status={a.status} />
            <TemplateLabel template={a.template} />
            <span
              className={cn(
                'text-[13px]',
                dirty ? 'font-medium text-warning-foreground' : 'text-muted-foreground',
              )}
              role="status"
            >
              {saveState}
            </span>
          </>
        }
      />

      {mode === 'amend' && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-info/30 bg-info-subtle p-4 text-sm text-info-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            You’re correcting a completed assessment. The current version is kept in its history,
            and you’ll be asked why you’re changing it.
          </p>
        </div>
      )}
      {conflict && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning-subtle p-4 text-sm text-warning-foreground"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            This assessment was changed in another tab or by someone else. Reload to see the latest
            version; changes you haven’t saved here will be lost.
          </p>
          <Button variant="secondary" size="sm" onClick={onReload}>
            Reload latest
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav aria-label="Assessment sections" className="sticky top-20 grid gap-3">
            <div className="grid gap-1.5">
              <p className="text-xs text-muted-foreground">
                {requiredDone} of {requiredTotal} required answered
              </p>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${(requiredDone / requiredTotal) * 100}%` }}
                />
              </div>
            </div>
            <ol className="grid gap-0.5">
              {nav.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById(n.id)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground focus-ring"
                  >
                    {n.done ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-primary" aria-hidden />
                    ) : (
                      <Circle className="size-3.5 shrink-0" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate">{n.title}</span>
                    {'hint' in n && <span className="tabular text-xs">{n.hint}</span>}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <div className="grid min-w-0 content-start gap-4">
          <SectionCard id="details" title="Details">
            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="grid content-start gap-4">
                <Field label="Assessment type" required>
                  <Select
                    value={state.type}
                    onValueChange={(v) => patch({ type: v as AssessmentKind })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ASSESSMENT_KINDS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label="Assessment date"
                  required
                  error={errors.assessmentDate}
                  helper={
                    state.assessmentDate > today
                      ? 'It can be completed on or after this date.'
                      : undefined
                  }
                >
                  <DatePicker
                    value={state.assessmentDate}
                    onChange={(v) => v && patch({ assessmentDate: v })}
                  />
                </Field>
              </div>
              <ContextCard assessment={a} />
            </div>
          </SectionCard>

          {a.form.sections.map((section) => (
            <SectionCard
              key={section.key}
              id={`section-${section.key}`}
              title={section.title}
              description={section.description}
            >
              <SectionFields
                section={section}
                values={state.answers}
                onChange={setAnswer}
                errors={answerErrors}
              />
            </SectionCard>
          ))}

          <SectionCard
            id="clinicalSummary"
            title="Clinical summary"
            description="Your own wording. Carezino never suggests a diagnosis."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {SUMMARY_FIELDS.map((f) => (
                <Field
                  key={f.key}
                  label={f.label}
                  required={f.required}
                  helper={f.required ? 'Required to complete the assessment.' : undefined}
                  error={errors[`clinicalSummary.${f.key}`]}
                  className={f.key === 'summary' ? 'sm:col-span-2' : undefined}
                >
                  <Textarea
                    value={state.summary[f.key]}
                    onChange={(e) => setSummary(f.key, e.target.value)}
                    rows={f.key === 'summary' ? 5 : 3}
                    maxLength={5000}
                  />
                </Field>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            id="recommendations"
            title="Recommendations"
            description="Suggested services. Nothing is booked, sold or billed from here."
            actions={
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  patch({
                    recommendations: [
                      ...state.recommendations,
                      {
                        key: rowKey(),
                        therapyTypeId: state.recommendations.length === 0 ? a.therapyType.id : '',
                        sessionsPerWeek: '',
                        durationMinutes: '',
                        reviewAfterWeeks: '',
                        note: '',
                      },
                    ],
                  })
                }
                disabled={state.recommendations.length >= 20}
              >
                <Plus /> Add recommendation
              </Button>
            }
          >
            <div className="grid gap-4">
              {state.recommendations.length === 0 && (
                <p className="text-[13px] text-muted-foreground">No therapy recommended yet.</p>
              )}
              {state.recommendations.map((r, i) => {
                const err = (k: string) => errors[`recommendations.${i}.${k}`];
                return (
                  <div
                    key={r.key}
                    className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-4"
                  >
                    <Field
                      label="Therapy"
                      required
                      error={err('therapyTypeId')}
                      className="lg:col-span-2"
                    >
                      <Select
                        value={r.therapyTypeId}
                        onValueChange={(v) => setRec(i, { therapyTypeId: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a therapy" />
                        </SelectTrigger>
                        <SelectContent>
                          {typeOptions.map((t) => (
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
                    <Field label="Sessions a week" optional error={err('sessionsPerWeek')}>
                      <Input
                        inputMode="numeric"
                        value={r.sessionsPerWeek}
                        onChange={(e) => setRec(i, { sessionsPerWeek: e.target.value })}
                        placeholder="e.g. 3"
                      />
                    </Field>
                    <Field label="Minutes per session" optional error={err('durationMinutes')}>
                      <Input
                        inputMode="numeric"
                        value={r.durationMinutes}
                        onChange={(e) => setRec(i, { durationMinutes: e.target.value })}
                        placeholder="e.g. 45"
                      />
                    </Field>
                    <Field label="Review after (weeks)" optional error={err('reviewAfterWeeks')}>
                      <Input
                        inputMode="numeric"
                        value={r.reviewAfterWeeks}
                        onChange={(e) => setRec(i, { reviewAfterWeeks: e.target.value })}
                        placeholder="e.g. 8"
                      />
                    </Field>
                    <Field label="Note" optional error={err('note')} className="lg:col-span-2">
                      <Input
                        value={r.note}
                        onChange={(e) => setRec(i, { note: e.target.value })}
                        maxLength={1000}
                      />
                    </Field>
                    <div className="flex items-end justify-end">
                      <Button
                        variant="danger-ghost"
                        size="sm"
                        onClick={() =>
                          patch({
                            recommendations: state.recommendations.filter((_, j) => j !== i),
                          })
                        }
                      >
                        <Trash2 /> Remove
                      </Button>
                    </div>
                  </div>
                );
              })}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Additional recommendations" optional className="sm:col-span-2">
                  <Textarea
                    value={state.summary.additionalRecommendations}
                    onChange={(e) => setSummary('additionalRecommendations', e.target.value)}
                    rows={3}
                    maxLength={5000}
                    placeholder="e.g. home programme, school liaison, referral elsewhere"
                  />
                </Field>
                <Field
                  label="Suggested review date"
                  optional
                  error={errors['clinicalSummary.suggestedReviewDate']}
                >
                  <DatePicker
                    value={state.summary.suggestedReviewDate || undefined}
                    onChange={(v) => setSummary('suggestedReviewDate', v ?? '')}
                    placeholder="Not set"
                  />
                </Field>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            id="goals"
            title="Initial goals"
            description="Suggestions for the therapy plan. They don’t become active goals by themselves."
            actions={
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  patch({
                    goals: [
                      ...state.goals,
                      {
                        key: rowKey(),
                        title: '',
                        description: '',
                        priority: '',
                        targetReviewDate: '',
                      },
                    ],
                  })
                }
                disabled={state.goals.length >= 30}
              >
                <Plus /> Add goal
              </Button>
            }
          >
            <ol className="grid gap-3">
              {state.goals.length === 0 && (
                <p className="text-[13px] text-muted-foreground">No goals suggested yet.</p>
              )}
              {state.goals.map((g, i) => (
                <li
                  key={g.key}
                  className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label={`Goal ${i + 1}`}
                      required
                      error={errors[`goals.${i}.title`]}
                      className="sm:col-span-2"
                    >
                      <Input
                        value={g.title}
                        onChange={(e) => setGoal(i, { title: e.target.value })}
                        maxLength={200}
                        placeholder="e.g. Hold a pencil with a tripod grasp"
                      />
                    </Field>
                    <Field label="Description" optional className="sm:col-span-2">
                      <Textarea
                        value={g.description}
                        onChange={(e) => setGoal(i, { description: e.target.value })}
                        rows={2}
                        maxLength={2000}
                      />
                    </Field>
                    <Field label="Priority" optional>
                      <Select
                        value={g.priority || 'none'}
                        onValueChange={(v) =>
                          setGoal(i, { priority: v === 'none' ? '' : (v as GoalPriority) })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not set</SelectItem>
                          {Object.entries(GOAL_PRIORITIES).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field
                      label="Target review date"
                      optional
                      error={errors[`goals.${i}.targetReviewDate`]}
                    >
                      <DatePicker
                        value={g.targetReviewDate || undefined}
                        onChange={(v) => setGoal(i, { targetReviewDate: v ?? '' })}
                        placeholder="Not set"
                      />
                    </Field>
                  </div>
                  <div className="flex gap-1 sm:flex-col">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move goal ${i + 1} up`}
                      disabled={i === 0}
                      onClick={() => patch({ goals: move(state.goals, i, i - 1) })}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move goal ${i + 1} down`}
                      disabled={i === state.goals.length - 1}
                      onClick={() => patch({ goals: move(state.goals, i, i + 1) })}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="danger-ghost"
                      size="icon-sm"
                      aria-label={`Remove goal ${i + 1}`}
                      onClick={() => patch({ goals: state.goals.filter((_, j) => j !== i) })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          </SectionCard>
        </div>
      </div>

      {/* Actions stay in reach on long forms. */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 print:hidden">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto hidden text-[13px] text-muted-foreground sm:inline">
            {saveState}
          </span>
          {mode === 'draft' && a.actions.discard && (
            <Button
              variant="danger-ghost"
              onClick={() => setConfirming('discard')}
              disabled={pending}
            >
              <Trash2 /> Discard draft
            </Button>
          )}
          <Button variant="secondary" onClick={leave} disabled={pending}>
            {mode === 'amend' ? 'Cancel' : 'Back'}
          </Button>
          {mode === 'draft' ? (
            <>
              <Button
                variant="secondary"
                onClick={saveDraft}
                loading={save.isPending}
                disabled={!dirty || pending}
              >
                <Save /> Save draft
              </Button>
              {a.actions.complete && (
                <Button
                  onClick={() => validate(true) && setConfirming('complete')}
                  disabled={pending}
                >
                  <ClipboardCheck /> Complete assessment
                </Button>
              )}
            </>
          ) : (
            <Button
              onClick={() => validate(true) && setConfirming('amend')}
              disabled={!dirty || pending}
            >
              <Save /> Save amendment
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirming === 'complete'}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Complete this assessment?"
        description={`It will be signed as completed by you on behalf of ${a.therapist.fullName} and become read-only. Corrections later are made as amendments, which keep this version.`}
        confirmLabel="Complete and sign"
        loading={complete.isPending}
        onConfirm={doComplete}
      />
      <ConfirmDialog
        open={confirming === 'amend'}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Save amendment"
        description="Say why the assessment is being corrected. The reason, your name and the time are recorded with it."
        confirmLabel="Save amendment"
        loading={amend.isPending}
        onConfirm={() => {
          if (reason.trim().length < 5) {
            toast.error('Say why the assessment is being corrected');
            return;
          }
          doAmend();
        }}
      >
        <Field
          label="Reason for amendment"
          required
          error={isApiError(amend.error) ? amend.error.errors?.reason : undefined}
        >
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={1000}
          />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirming === 'discard'}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Discard this draft?"
        description="Everything recorded in it is deleted. This can’t be undone."
        confirmLabel="Discard draft"
        tone="danger"
        loading={discard.isPending}
        onConfirm={() =>
          discard.mutate(a.id, {
            onSuccess: () => {
              setBaseline(JSON.stringify(input));
              toast.success('Draft discarded');
              router.push(assessmentLinks.list);
            },
            onError: (e) => {
              setConfirming(null);
              toast.error(e.message);
            },
          })
        }
      />
    </>
  );
}
