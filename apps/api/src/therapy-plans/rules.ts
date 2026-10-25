import { PlanPeriodUnit, TherapyPlanStatus } from '../generated/prisma/enums';
import { addDays } from '../common/time';

/**
 * The therapy plan lifecycle and the limits plans are checked against, as plain data
 * and pure functions so the service, the tests and the actions offered to screens all
 * read the same rules.
 *
 *   DRAFT ──activate──▶ ACTIVE ◀──resume── PAUSED
 *                         │  └──pause──────▶ │
 *                         ├──complete──▶ COMPLETED ◀─┤
 *                         └──discontinue─▶ DISCONTINUED ◀┘
 *
 * Completed and discontinued plans are closed: nothing about them changes again.
 */

export type PlanAction =
  'activate' | 'pause' | 'resume' | 'complete' | 'discontinue';

export const TRANSITIONS: Record<
  PlanAction,
  { from: TherapyPlanStatus[]; to: TherapyPlanStatus }
> = {
  activate: { from: [TherapyPlanStatus.DRAFT], to: TherapyPlanStatus.ACTIVE },
  pause: { from: [TherapyPlanStatus.ACTIVE], to: TherapyPlanStatus.PAUSED },
  resume: { from: [TherapyPlanStatus.PAUSED], to: TherapyPlanStatus.ACTIVE },
  complete: {
    from: [TherapyPlanStatus.ACTIVE, TherapyPlanStatus.PAUSED],
    to: TherapyPlanStatus.COMPLETED,
  },
  discontinue: {
    from: [TherapyPlanStatus.ACTIVE, TherapyPlanStatus.PAUSED],
    to: TherapyPlanStatus.DISCONTINUED,
  },
};

export const canTransition = (action: PlanAction, from: TherapyPlanStatus) =>
  TRANSITIONS[action].from.includes(from);

/** Plans in force: at most one per patient and therapy type (a partial unique index). */
export const OPEN_STATUSES: TherapyPlanStatus[] = [
  TherapyPlanStatus.ACTIVE,
  TherapyPlanStatus.PAUSED,
];

export const CLOSED_STATUSES: TherapyPlanStatus[] = [
  TherapyPlanStatus.COMPLETED,
  TherapyPlanStatus.DISCONTINUED,
];

export const isOpen = (s: TherapyPlanStatus) => OPEN_STATUSES.includes(s);
export const isClosed = (s: TherapyPlanStatus) => CLOSED_STATUSES.includes(s);

/** What each kind of clinical work needs the plan's status to be. */
export const WORK_STATUSES = {
  /** Editing details and goals freely, deleting goals, discarding */
  editDraft: [TherapyPlanStatus.DRAFT],
  /** Recording progress against goals */
  recordProgress: [TherapyPlanStatus.ACTIVE],
  /** Formal reviews, revisions and goal changes with a reason */
  review: OPEN_STATUSES,
  revise: OPEN_STATUSES,
  /** Handing the plan to another therapist */
  reassign: [TherapyPlanStatus.DRAFT, ...OPEN_STATUSES],
} satisfies Record<string, TherapyPlanStatus[]>;

export const PLAN_LIMITS = {
  title: 200,
  text: 5000,
  reason: { min: 3, max: 1000 },
  goals: 30,
  goalTitle: 200,
  goalText: 2000,
  observation: 5000,
  categoriesPerCenter: 300,
  categoryName: 80,
  categoryDescription: 500,
  /** Sessions per period, by period */
  sessions: { DAY: 6, WEEK: 21, MONTH: 60 } satisfies Record<
    PlanPeriodUnit,
    number
  >,
  /** Review interval, by unit */
  reviewInterval: { DAY: 365, WEEK: 104, MONTH: 24 } satisfies Record<
    PlanPeriodUnit,
    number
  >,
  durationMinutes: { min: 5, max: 480 },
} as const;

/** "3 sessions per week" */
export function describeFrequency(
  sessions: number | null,
  unit: PlanPeriodUnit | null,
) {
  if (!sessions || !unit) return null;
  const per = { DAY: 'day', WEEK: 'week', MONTH: 'month' }[unit];
  return `${sessions} session${sessions === 1 ? '' : 's'} per ${per}`;
}

/** A center-local date plus an interval, e.g. start + 8 weeks. Month ends clamp. */
export function addInterval(date: Date, value: number, unit: PlanPeriodUnit) {
  if (unit === PlanPeriodUnit.DAY) return addDays(date, value);
  if (unit === PlanPeriodUnit.WEEK) return addDays(date, value * 7);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + value;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), last)));
}

/**
 * Where a plan's next review stands on `today`: overdue, due within `soonDays`, or
 * neither. Only plans in force have reviews due.
 */
export function reviewState(
  status: TherapyPlanStatus,
  nextReviewDate: Date | null,
  today: Date,
  soonDays = 7,
): 'OVERDUE' | 'DUE_SOON' | null {
  if (!nextReviewDate || !isOpen(status)) return null;
  if (nextReviewDate < today) return 'OVERDUE';
  if (nextReviewDate <= addDays(today, soonDays)) return 'DUE_SOON';
  return null;
}

/**
 * The plan's clinically significant details, as kept in revision snapshots and
 * compared to find what changed. Labels name them in history, never values.
 */
export const PLAN_FIELDS = {
  title: 'Plan title',
  treatmentFocus: 'Treatment focus',
  clinicalNotes: 'Clinical notes',
  sessionsPerPeriod: 'Frequency',
  frequencyUnit: 'Frequency',
  durationMinutes: 'Session duration',
  reviewIntervalValue: 'Review interval',
  reviewIntervalUnit: 'Review interval',
  additionalInstructions: 'Additional instructions',
  startDate: 'Start date',
  targetEndDate: 'Target end date',
  nextReviewDate: 'Next review date',
} as const;
export type PlanField = keyof typeof PLAN_FIELDS;
export const PLAN_FIELD_KEYS = Object.keys(PLAN_FIELDS) as PlanField[];

export type PlanDetails = Record<PlanField, string | number | null>;

/** Labels of the details that differ, each once, in display order. */
export function changedPlanLabels(before: PlanDetails, after: PlanDetails) {
  const labels = PLAN_FIELD_KEYS.filter((k) => before[k] !== after[k]).map(
    (k) => PLAN_FIELDS[k],
  );
  return [...new Set(labels)];
}

export const GOAL_FIELDS = {
  title: 'Title',
  description: 'Description',
  categoryId: 'Category',
  priority: 'Priority',
  measurementType: 'Measurement',
  measurementConfig: 'Measurement',
  baselineText: 'Baseline',
  baselineValue: 'Baseline',
  targetText: 'Target',
  targetValue: 'Target',
  targetDate: 'Target date',
  status: 'Status',
  notes: 'Notes',
} as const;
export type GoalField = keyof typeof GOAL_FIELDS;
export const GOAL_FIELD_KEYS = Object.keys(GOAL_FIELDS) as GoalField[];

export type GoalDetails = Record<GoalField, unknown>;

export function changedGoalLabels(before: GoalDetails, after: GoalDetails) {
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return [
    ...new Set(
      GOAL_FIELD_KEYS.filter((k) => !same(before[k], after[k])).map(
        (k) => GOAL_FIELDS[k],
      ),
    ),
  ];
}
