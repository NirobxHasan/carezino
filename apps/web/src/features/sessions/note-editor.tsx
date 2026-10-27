'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ClipboardCheck,
  Eye,
  FilePlus2,
  FileSearch,
  History,
  ListChecks,
  RotateCcw,
  Save,
  Target,
  Trash2,
} from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { Field } from '@/components/forms/field';
import { useBreadcrumbLabel } from '@/components/layout/breadcrumbs';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
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
  useAmendNote,
  useCompleteNote,
  useCreateNote,
  useDiscardNote,
  useNoteAmendment,
  useNoteTemplateList,
  useSaveNote,
  useSessionDetail,
  useSessionNote,
} from '@/lib/api/sessions';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import type {
  AnswerValue,
  NoteGoalEntry,
  NotePlanGoal,
  SessionDetail,
  SessionNoteDetail,
  TemplateSection,
  TherapyGoalStatus,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { TherapyTypeChip, useCenterFormat } from '../appointments/appointment-display';
import {
  AnswersView,
  SectionFields,
  checkAnswers,
  cleanAnswers,
  type DraftAnswers,
} from '../assessments/dynamic-form';
import { useInstant } from '../packages/package-display';
import {
  GOAL_STATUSES,
  GoalStatusBadge,
  PlanStatusBadge,
  describeLevel,
  formatMeasure,
  measureUnit,
  planLinks,
} from '../therapy-plans/plan-display';
import { AttendanceBadge, NoteStatusBadge, sessionLinks } from './session-display';

/** Goal progress as typed: the value stays text until it's a number. */
interface GoalRow {
  goalId: string;
  observation: string;
  measuredValue: string;
  goalStatus: TherapyGoalStatus | '';
}

const toRow = (g: NoteGoalEntry): GoalRow => ({
  goalId: g.goalId,
  observation: g.observation ?? '',
  measuredValue: g.measuredValue === null ? '' : String(g.measuredValue),
  goalStatus: g.goalStatus ?? '',
});

function toEntries(rows: GoalRow[]) {
  return rows.map((r) => ({
    goalId: r.goalId,
    observation: r.observation.trim() || null,
    measuredValue: r.measuredValue.trim() === '' ? null : Number(r.measuredValue),
    goalStatus: r.goalStatus || null,
  }));
}

/** The section the goal progress card goes before: "next plan" if the form has it. */
function goalsBefore(sections: TemplateSection[]) {
  const i = sections.findIndex((s) => s.key === 'next_plan');
  return i === -1 ? sections.length : i;
}

// ── Header ──────────────────────────────────────────────────────────────────

function SessionHeader({ session: s, note }: { session: SessionDetail; note?: SessionNoteDetail }) {
  const fmt = useCenterFormat();
  const item = (label: string, value: React.ReactNode) => (
    <div className="grid gap-0.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
  return (
    <Card>
      <CardContent className="pt-6">
        <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {item(
            'Patient',
            <span className="flex flex-col">
              <span className="font-medium">{s.patient.fullName}</span>
              <span className="text-xs text-muted-foreground">{s.patient.code}</span>
            </span>,
          )}
          {item('Therapy', <TherapyTypeChip therapyType={s.therapyType} full />)}
          {item('Therapist', note?.therapist.fullName ?? s.therapist.fullName)}
          {item(
            'Session',
            <span className="tabular">
              {fmt.shortDate(s.date)}
              <span className="block text-xs text-muted-foreground">{fmt.range(s)}</span>
            </span>,
          )}
          {item('Attendance', <AttendanceBadge status={s.attendance.status} />)}
          {item(
            'Therapy plan',
            note?.plan || s.plan ? (
              <Link
                href={planLinks.detail((note?.plan ?? s.plan)!.id)}
                className="inline-flex items-center gap-1.5 rounded hover:underline focus-ring"
              >
                <ListChecks className="size-3.5" aria-hidden />
                {(note?.plan ?? s.plan)!.code}
              </Link>
            ) : (
              <span className="text-subtle-foreground">None active</span>
            ),
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

// ── Goal progress ───────────────────────────────────────────────────────────

function GoalLevels({ goal }: { goal: NotePlanGoal }) {
  const baseline = describeLevel(goal.measurementType, goal.measurementConfig, {
    value: goal.baselineValue,
    text: goal.baselineText,
  });
  const target = describeLevel(goal.measurementType, goal.measurementConfig, {
    value: goal.targetValue,
    text: goal.targetText,
  });
  const latest = goal.latestProgress
    ? formatMeasure(goal.measurementType, goal.measurementConfig, goal.latestProgress.measuredValue)
    : null;
  return (
    <p className="text-xs text-muted-foreground">
      {[
        baseline && `Baseline: ${baseline}`,
        target && `Target: ${target}`,
        latest && `Last: ${latest}`,
      ]
        .filter(Boolean)
        .join(' · ') || 'Described in words'}
    </p>
  );
}

/**
 * Goals of the session's plan the therapist worked on, with what they saw. Progress is
 * written to the plan when the note is signed; a status is only changed when chosen
 * here, never worked out from a value.
 */
function GoalProgressCard({
  note,
  rows,
  setRows,
  errors,
  recorded,
}: {
  note: SessionNoteDetail;
  rows: GoalRow[];
  setRows: (rows: GoalRow[]) => void;
  errors: Record<string, string>;
  /** Goals already recorded (amending): they can be corrected, not removed */
  recorded: Set<string>;
}) {
  const plan = note.plan;
  const goals = note.planGoals.filter(
    (g) => g.status !== 'DISCONTINUED' || rows.some((r) => r.goalId === g.id),
  );
  const toggle = (goal: NotePlanGoal, on: boolean) =>
    setRows(
      on
        ? [...rows, { goalId: goal.id, observation: '', measuredValue: '', goalStatus: '' }]
        : rows.filter((r) => r.goalId !== goal.id),
    );
  const update = (goalId: string, patch: Partial<GoalRow>) =>
    setRows(rows.map((r) => (r.goalId === goalId ? { ...r, ...patch } : r)));
  return (
    <Card id="goals">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="size-4 text-primary" aria-hidden /> Goal progress
        </CardTitle>
        {plan ? (
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            {plan.code} · {plan.title} <PlanStatusBadge status={plan.status} />
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            The patient has no active therapy plan for this therapy, so there are no goals to
            record. The note can be completed without them.
          </p>
        )}
      </CardHeader>
      {plan && (
        <CardContent className="grid gap-3">
          {plan.status === 'PAUSED' && (
            <p className="rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2 text-[13px] text-warning-foreground">
              The plan is paused: progress can’t be recorded until it’s resumed.
            </p>
          )}
          {errors.goals && <p className="text-sm text-danger-foreground">{errors.goals}</p>}
          {goals.length === 0 && (
            <p className="text-[13px] text-muted-foreground">The plan has no goals.</p>
          )}
          {goals.map((goal) => {
            const index = rows.findIndex((r) => r.goalId === goal.id);
            const row = rows[index];
            const numeric = goal.measurementType !== 'NARRATIVE';
            const err = (field: string) => errors[`goals.${index}.${field}`];
            return (
              <div
                key={goal.id}
                className={cn(
                  'grid gap-3 rounded-lg border border-border p-3',
                  row && 'border-primary/40 bg-primary-subtle/40',
                )}
              >
                <label className="flex items-start gap-3">
                  <Checkbox
                    checked={Boolean(row)}
                    disabled={recorded.has(goal.id) || plan.status !== 'ACTIVE'}
                    onCheckedChange={(c) => toggle(goal, c === true)}
                    className="mt-0.5"
                    aria-label={`Worked on “${goal.title}” this session`}
                  />
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {goal.title} <GoalStatusBadge status={goal.status} />
                    </span>
                    <GoalLevels goal={goal} />
                  </span>
                </label>
                {err('goalId') && <p className="text-xs text-danger-foreground">{err('goalId')}</p>}
                {row && (
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
                    <Field label="Observation" optional error={err('observation')}>
                      <Textarea
                        value={row.observation}
                        onChange={(e) => update(goal.id, { observation: e.target.value })}
                        rows={2}
                        maxLength={5000}
                      />
                    </Field>
                    <div className="grid content-start gap-3">
                      {numeric && (
                        <Field
                          label={`Measured (${measureUnit(goal.measurementType, goal.measurementConfig) || 'value'})`}
                          optional
                          error={err('measuredValue')}
                        >
                          <Input
                            inputMode="decimal"
                            value={row.measuredValue}
                            onChange={(e) => update(goal.id, { measuredValue: e.target.value })}
                            className="tabular"
                          />
                        </Field>
                      )}
                      <Field label="Goal status" optional error={err('goalStatus')}>
                        <Select
                          value={row.goalStatus || 'keep'}
                          onValueChange={(v) =>
                            update(goal.id, {
                              goalStatus: v === 'keep' ? '' : (v as TherapyGoalStatus),
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="keep">Keep as is</SelectItem>
                            {Object.entries(GOAL_STATUSES).map(([value, s]) => (
                              <SelectItem key={value} value={value}>
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────────

/**
 * Writes a draft (save, sign off, discard) or corrects a signed note (amend, with a
 * reason). The form is the note's own template version, whatever the template looks
 * like now.
 */
function NoteEditor({
  session,
  note: n,
  mode,
  onReload,
}: {
  session: SessionDetail;
  note: SessionNoteDetail;
  mode: 'draft' | 'amend';
  /** Throw local changes away and load the latest version */
  onReload: () => void;
}) {
  const router = useRouter();
  const instant = useInstant();
  const [answers, setAnswers] = React.useState<DraftAnswers>(() => ({ ...n.answers }));
  const [rows, setRows] = React.useState<GoalRow[]>(() => n.goals.map(toRow));
  const content = () => ({
    answers: cleanAnswers(n.form, answers),
    goals: toEntries(rows),
  });
  const [baseline, setBaseline] = React.useState(() => JSON.stringify(content()));
  const [clientErrors, setClientErrors] = React.useState<Record<string, string>>({});
  const [confirming, setConfirming] = React.useState<'complete' | 'amend' | 'discard' | null>(null);
  const [attested, setAttested] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const recorded = React.useMemo(
    () => new Set(mode === 'amend' ? n.goals.map((g) => g.goalId) : []),
    // Only the goals recorded when the correction started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode],
  );

  const save = useSaveNote(session.id);
  const complete = useCompleteNote(session.id);
  const amend = useAmendNote(session.id);
  const discard = useDiscardNote(session.id);
  const pending = save.isPending || complete.isPending || amend.isPending || discard.isPending;
  const lastError = save.error ?? complete.error ?? amend.error;
  const conflict = isApiError(lastError, 409) && lastError.code === 'NOTE_CHANGED';
  const current = JSON.stringify(content());
  const dirty = current !== baseline;
  useUnsavedChanges(dirty);

  const serverErrors = isApiError(lastError) ? (lastError.errors ?? {}) : {};
  const errors = { ...serverErrors, ...clientErrors };
  const answerErrors = Object.fromEntries(
    Object.entries(errors)
      .filter(([k]) => k.startsWith('answers.'))
      .map(([k, v]) => [k.slice('answers.'.length), v]),
  );

  /** Shows errors and scrolls to the first; true when there were none. */
  const validate = (forCompletion: boolean) => {
    const found: Record<string, string> = Object.fromEntries(
      Object.entries(checkAnswers(n.form, answers, { complete: forCompletion })).map(([k, v]) => [
        `answers.${k}`,
        v,
      ]),
    );
    rows.forEach((r, i) => {
      if (r.measuredValue.trim() !== '' && !Number.isFinite(Number(r.measuredValue))) {
        found[`goals.${i}.measuredValue`] = 'Enter a number';
      }
      if (forCompletion && !r.observation.trim() && !r.measuredValue.trim() && !r.goalStatus) {
        found[`goals.${i}.observation`] =
          'Record a value, an observation or a status, or untick the goal';
      }
    });
    setClientErrors(found);
    const first = Object.keys(found)[0];
    if (!first) return true;
    const target = first.startsWith('answers.')
      ? document.querySelector(`[data-field="${first.slice(8)}"]`)
      : document.getElementById('goals');
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast.error(
      `${Object.keys(found).length} field${Object.keys(found).length === 1 ? ' needs' : 's need'} attention`,
    );
    return false;
  };

  const onError = (e: Error) => {
    // A conflict shows its own banner; field errors appear inline, with this summary.
    if (isApiError(e, 409) && e.code === 'NOTE_CHANGED') return;
    toast.error(e.message);
  };

  const saveDraft = () => {
    if (!validate(false)) return;
    const sent = current;
    save.mutate(
      { revision: n.revision, ...content() },
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

  const doComplete = () =>
    complete.mutate(
      { revision: n.revision, ...content() },
      {
        onSuccess: () => {
          setBaseline(current);
          setConfirming(null);
          toast.success('Note signed', {
            description: rows.length
              ? `Progress recorded for ${rows.length} goal${rows.length === 1 ? '' : 's'}.`
              : 'It’s now part of the patient’s clinical record.',
          });
        },
        onError: (e) => {
          setConfirming(null);
          onError(e);
        },
      },
    );

  const doAmend = () =>
    amend.mutate(
      { revision: n.revision, ...content(), reason: reason.trim() },
      {
        onSuccess: () => {
          setBaseline(current);
          setConfirming(null);
          toast.success('Amendment saved', { description: 'The earlier version is kept.' });
          router.replace(sessionLinks.note(session.id));
        },
        onError: (e) => {
          if (!(isApiError(e) && e.errors?.reason)) setConfirming(null);
          onError(e);
        },
      },
    );

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
    router.push(mode === 'amend' ? sessionLinks.note(session.id) : sessionLinks.detail(session.id));
  };

  const setAnswer = (key: string, value: AnswerValue | undefined) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setClientErrors({});
  };
  const goalsAt = goalsBefore(n.form.sections);
  const goalCard = (
    <GoalProgressCard
      key="goals"
      note={n}
      rows={rows}
      setRows={(r) => {
        setRows(r);
        setClientErrors({});
      }}
      errors={errors}
      recorded={recorded}
    />
  );
  const saveState = pending
    ? 'Saving…'
    : dirty
      ? 'Unsaved changes'
      : savedAt
        ? `Saved at ${savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : mode === 'draft'
          ? `Draft · last saved ${instant(n.updatedAt)}`
          : '';

  return (
    <>
      <PageHeader
        back={{ href: sessionLinks.detail(session.id), label: 'Session' }}
        title={mode === 'amend' ? 'Amend session note' : 'Session note'}
        description={`${n.template.name} · version ${n.template.version}`}
        meta={<NoteStatusBadge state={n.status} />}
      />
      <div className="grid gap-4">
        <SessionHeader session={session} note={n} />
        {conflict && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning-subtle p-4 text-sm text-warning-foreground"
          >
            This note was changed in another tab or by someone else.
            <Button variant="secondary" size="sm" onClick={onReload}>
              <RotateCcw /> Reload
            </Button>
          </div>
        )}
        {mode === 'amend' && (
          <p className="rounded-xl border border-info/20 bg-info-subtle p-4 text-sm text-info-foreground">
            You’re correcting a signed note. The signed version is kept, and the correction is
            recorded with your name, the time and a reason. Recorded goal progress can be corrected
            but not removed.
          </p>
        )}
        {n.form.sections.map((section, i) => (
          <React.Fragment key={section.key}>
            {i === goalsAt && goalCard}
            <Card>
              <CardHeader>
                <CardTitle>{section.title}</CardTitle>
                {section.description && (
                  <p className="text-[13px] text-muted-foreground">{section.description}</p>
                )}
              </CardHeader>
              <CardContent>
                <SectionFields
                  section={section}
                  values={answers}
                  onChange={setAnswer}
                  errors={answerErrors}
                />
              </CardContent>
            </Card>
          </React.Fragment>
        ))}
        {goalsAt === n.form.sections.length && goalCard}
      </div>

      {/* Actions stay in reach on long notes. */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto hidden text-[13px] text-muted-foreground sm:inline">
            {saveState}
          </span>
          {mode === 'draft' && n.actions.discard && (
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
              {n.actions.complete && (
                <Button
                  onClick={() => {
                    if (!validate(true)) return;
                    setAttested(false);
                    setConfirming('complete');
                  }}
                  disabled={pending}
                >
                  <ClipboardCheck /> Complete note
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
        title="Complete and sign this note?"
        description={
          rows.length
            ? `It becomes read-only, and progress for ${rows.length} goal${rows.length === 1 ? '' : 's'} is recorded on the therapy plan. Corrections later are made as amendments.`
            : 'It becomes read-only. Corrections later are made as amendments, which keep this version.'
        }
        confirmLabel="Complete and sign"
        loading={complete.isPending}
        onConfirm={() => {
          if (!attested) {
            toast.error('Confirm the statement to sign the note');
            return;
          }
          doComplete();
        }}
      >
        <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
          <Checkbox
            checked={attested}
            onCheckedChange={(c) => setAttested(c === true)}
            className="mt-0.5"
          />
          <span>
            I confirm this note accurately records the session I provided. It’s signed with my
            account, name and the time.
          </span>
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirming === 'amend'}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Save amendment"
        description="Say why the note is being corrected. The reason, your name and the time are recorded with it."
        confirmLabel="Save amendment"
        loading={amend.isPending}
        onConfirm={() => {
          if (reason.trim().length < 5) {
            toast.error('Say why the note is being corrected');
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
          discard.mutate(undefined, {
            onSuccess: () => {
              setBaseline(current);
              toast.success('Draft discarded');
              router.push(sessionLinks.detail(session.id));
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

// ── Read-only view ──────────────────────────────────────────────────────────

function RecordedGoals({
  goals,
  planGoals,
}: {
  goals: NoteGoalEntry[];
  planGoals: NotePlanGoal[];
}) {
  if (!goals.length) {
    return <p className="text-[13px] text-muted-foreground italic">No goal progress recorded.</p>;
  }
  return (
    <ul className="grid gap-3">
      {goals.map((g) => {
        const goal = planGoals.find((p) => p.id === g.goalId);
        const value = goal
          ? formatMeasure(goal.measurementType, goal.measurementConfig, g.measuredValue)
          : g.measuredValue;
        return (
          <li key={g.goalId} className="grid gap-1 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">{goal?.title ?? 'Goal'}</p>
            <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              {value !== null && <span className="tabular">Measured: {value}</span>}
              {g.goalStatus && <GoalStatusBadge status={g.goalStatus} />}
            </p>
            {g.observation && <p className="text-sm whitespace-pre-line">{g.observation}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function AmendmentDialog({
  sessionId,
  number,
  note,
  onClose,
}: {
  sessionId: string;
  number: number | null;
  note: SessionNoteDetail;
  onClose: () => void;
}) {
  const snapshot = useNoteAmendment(sessionId, number);
  return (
    <Dialog open={number !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {number === 1 ? 'The originally signed note' : `Before amendment ${number}`}
          </DialogTitle>
          <DialogDescription>
            The note as it stood before this correction. It’s kept as part of the record.
          </DialogDescription>
        </DialogHeader>
        {snapshot.data ? (
          <div className="grid gap-6">
            <AnswersView
              definition={snapshot.data.form}
              answers={snapshot.data.previousContent.answers}
            />
            <section className="grid gap-3">
              <h3 className="text-card-title">Goal progress</h3>
              <RecordedGoals
                goals={snapshot.data.previousContent.goals}
                planGoals={note.planGoals}
              />
            </section>
          </div>
        ) : snapshot.error ? (
          <ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} />
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A note as read: answers, recorded goal progress, sign-off and corrections. */
function NoteView({ session, note: n }: { session: SessionDetail; note: SessionNoteDetail }) {
  const instant = useInstant();
  const [viewing, setViewing] = React.useState<number | null>(null);
  const draft = n.status === 'DRAFT';
  return (
    <>
      <PageHeader
        back={{ href: sessionLinks.detail(session.id), label: 'Session' }}
        title="Session note"
        description={`${n.template.name} · version ${n.template.version}`}
        meta={<NoteStatusBadge state={n.status} />}
        actions={
          n.actions.amend && (
            <Button asChild>
              <Link href={`${sessionLinks.note(session.id)}?amend=1`}>
                <History /> Amend
              </Link>
            </Button>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <div className="grid content-start gap-4">
          <SessionHeader session={session} note={n} />
          {draft && (
            <p className="rounded-xl border border-warning/30 bg-warning-subtle p-4 text-sm text-warning-foreground">
              This note is a draft by {n.therapist.fullName}: it isn’t signed and may still change.
            </p>
          )}
          <Card>
            <CardContent className="pt-6">
              <AnswersView definition={n.form} answers={n.answers} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="size-4 text-primary" aria-hidden /> Goal progress
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RecordedGoals goals={n.goals} planGoals={n.planGoals} />
            </CardContent>
          </Card>
        </div>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Sign-off</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {n.completedAt ? (
                <>
                  <p>
                    Signed by <span className="font-medium">{n.completedBy?.fullName}</span>
                    <span className="block text-[13px] text-muted-foreground">
                      {instant(n.completedAt)}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    An attestation by a signed-in clinician, recorded with their account and the
                    time. It isn’t a certified digital signature.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">Not signed yet.</p>
              )}
            </CardContent>
          </Card>
          {n.amendments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Amendments</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="grid gap-3">
                  {[...n.amendments].reverse().map((a) => (
                    <li key={a.number} className="grid gap-1 text-sm">
                      <p className="flex items-center gap-2">
                        <Badge tone="primary">#{a.number}</Badge>
                        {a.amendedBy.fullName}
                      </p>
                      <p className="text-[13px] text-muted-foreground">{instant(a.amendedAt)}</p>
                      <p>“{a.reason}”</p>
                      <p className="text-xs text-muted-foreground">
                        Changed: {a.changedFields.join(', ')}
                      </p>
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto w-fit p-0 text-xs"
                        onClick={() => setViewing(a.number)}
                      >
                        <FileSearch />{' '}
                        {a.number === 1 ? 'View the original' : 'View the version before'}
                      </Button>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      <AmendmentDialog
        sessionId={session.id}
        number={viewing}
        note={n}
        onClose={() => setViewing(null)}
      />
    </>
  );
}

// ── Starting a note ─────────────────────────────────────────────────────────

/** Opens the session's note from the default template, or one the therapist picks. */
function StartNote({ session: s }: { session: SessionDetail }) {
  const templates = useNoteTemplateList({ usableFor: s.therapyType.id });
  const create = useCreateNote(s.id);
  const options = templates.data ?? [];
  const preferred =
    options.find((t) => t.therapyType && t.isDefault) ??
    options.find((t) => !t.therapyType && t.isDefault) ??
    options[0];
  const [choice, setChoice] = React.useState<string | undefined>();
  const templateId = choice ?? preferred?.id;
  return (
    <>
      <PageHeader
        back={{ href: sessionLinks.detail(s.id), label: 'Session' }}
        title="Write session note"
        description="Choose the form to document this session with."
      />
      <div className="grid gap-4">
        <SessionHeader session={s} />
        <Card>
          <CardContent className="grid gap-4 pt-6">
            {templates.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : options.length > 1 ? (
              <RadioGroup value={templateId} onValueChange={setChoice} aria-label="Note template">
                {options.map((t) => (
                  <RadioCard
                    key={t.id}
                    value={t.id}
                    title={
                      <span className="flex flex-wrap items-center gap-2">
                        {t.name}
                        {t.isDefault && <Badge tone="primary">Default</Badge>}
                      </span>
                    }
                    description={
                      t.therapyType ? `For ${t.therapyType.name}` : 'General: any therapy'
                    }
                  />
                ))}
              </RadioGroup>
            ) : (
              <p className="text-sm text-muted-foreground">
                {options[0]
                  ? `The note uses “${options[0].name}”.`
                  : 'The standard session note is used; administrators can change it in Settings.'}
              </p>
            )}
            <Button
              className="w-fit"
              loading={create.isPending}
              onClick={() =>
                create.mutate(templateId, {
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              <FilePlus2 /> Start note
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

function NotePage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const session = useSessionDetail(id);
  const s = session.data;
  const hasNote = Boolean(s?.note);
  const readable = Boolean(s && (s.sessionActions.viewNote || s.sessionActions.editNote));
  const note = useSessionNote(id, hasNote && readable);
  useBreadcrumbLabel(id, s?.patient.fullName);
  const amending = searchParams.get('amend') === '1';
  // Reloading after a conflict starts the editor afresh from the latest version.
  const [generation, setGeneration] = React.useState(0);
  const reload = () => void note.refetch().then(() => setGeneration((g) => g + 1));

  if (session.isPending || (hasNote && readable && note.isPending)) return <PageSkeleton />;
  const error = session.error ?? note.error;
  if (error || !s) {
    return (
      <Card>
        {isApiError(error, 404) || isApiError(error, 400) ? (
          <EmptyState
            icon={FileSearch}
            title="Note not found"
            description="It may belong to another center or another therapist’s patient, or the link is wrong."
            action={
              <Button variant="secondary" size="sm" asChild>
                <Link href={sessionLinks.list}>Back to sessions</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={error} onRetry={() => void session.refetch()} />
        )}
      </Card>
    );
  }
  if (!s.note) {
    if (s.sessionActions.writeNote) return <StartNote session={s} />;
    return (
      <Card>
        <EmptyState
          icon={Eye}
          title="No note for this session"
          description={
            s.type === 'THERAPY_SESSION'
              ? 'The session’s therapist hasn’t started one.'
              : 'Assessment appointments are documented as assessments.'
          }
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href={sessionLinks.detail(s.id)}>Back to the session</Link>
            </Button>
          }
        />
      </Card>
    );
  }
  if (!readable || !note.data) {
    return (
      <Card>
        <EmptyState
          icon={Eye}
          title="Clinical content isn’t available to you"
          description="Session notes are visible to the patient’s treating therapists and administrators."
        />
      </Card>
    );
  }
  const n = note.data;
  if (n.status === 'DRAFT' && n.actions.edit) {
    return (
      <NoteEditor
        key={`${n.id}-${generation}`}
        session={s}
        note={n}
        mode="draft"
        onReload={reload}
      />
    );
  }
  if (amending && n.actions.amend) {
    return (
      <NoteEditor
        key={`${n.id}-amend-${generation}`}
        session={s}
        note={n}
        mode="amend"
        onReload={reload}
      />
    );
  }
  return <NoteView session={s} note={n} />;
}

export function SessionNoteScreen() {
  return (
    <RequirePermission permission="sessions.read_own">
      <div className="animate-in">
        <NotePage />
      </div>
    </RequirePermission>
  );
}
