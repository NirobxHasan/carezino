import { HttpStatus, Injectable } from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import type { Permission } from '../auth/permissions';
import { apiError } from '../common/errors';
import { formatIsoDate, parseIsoDate, todayIn } from '../common/time';
import type { Prisma } from '../generated/prisma/client';
import {
  TherapyGoalStatus,
  TherapyPlanStatus,
  type TherapyPlanEvent,
} from '../generated/prisma/enums';
import { assertCan } from '../patients/access';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import { isOwn, listablePlans, planNotFound, readablePlans } from './access';
import { storedConfig } from './measurement';
import {
  GOAL_FIELD_KEYS,
  PLAN_FIELD_KEYS,
  WORK_STATUSES,
  describeFrequency,
  isOpen,
  reviewState,
  type GoalDetails,
  type PlanDetails,
} from './rules';

export type Tx = Prisma.TransactionClient;
export type Db = Tx | PrismaService;

export const userSelect = { select: { id: true, fullName: true } } as const;
export const therapyTypeSelect = {
  select: { id: true, name: true, code: true, color: true, isActive: true },
} as const;

export const planItemSelect = {
  id: true,
  code: true,
  title: true,
  status: true,
  sessionsPerPeriod: true,
  frequencyUnit: true,
  durationMinutes: true,
  startDate: true,
  targetEndDate: true,
  nextReviewDate: true,
  sourceAssessmentId: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  patient: {
    select: {
      id: true,
      code: true,
      fullName: true,
      photoUrl: true,
      deletedAt: true,
    },
  },
  therapyType: therapyTypeSelect,
  therapist: {
    select: {
      id: true,
      code: true,
      fullName: true,
      status: true,
      membershipId: true,
      deletedAt: true,
    },
  },
  goals: { select: { status: true } },
} satisfies Prisma.TherapyPlanSelect;

export const progressSelect = {
  id: true,
  goalId: true,
  observationDate: true,
  goalStatus: true,
  measuredValue: true,
  observation: true,
  correctsId: true,
  correctionReason: true,
  createdAt: true,
  recordedBy: userSelect,
  correctedBy: { select: { id: true } },
} satisfies Prisma.TherapyGoalProgressSelect;

export const goalSelect = {
  id: true,
  sourceAssessmentGoalId: true,
  title: true,
  description: true,
  priority: true,
  measurementType: true,
  measurementConfig: true,
  baselineText: true,
  baselineValue: true,
  targetText: true,
  targetValue: true,
  targetDate: true,
  status: true,
  statusChangedAt: true,
  statusChangedBy: userSelect,
  notes: true,
  displayOrder: true,
  categoryId: true,
  category: { select: { id: true, name: true, isActive: true } },
  createdAt: true,
  updatedAt: true,
  // The latest entry that hasn't been corrected: what the goal stands at now
  progress: {
    where: { correctedBy: null },
    select: progressSelect,
    orderBy: [{ observationDate: 'desc' }, { createdAt: 'desc' }],
    take: 1,
  },
  _count: { select: { progress: true } },
} satisfies Prisma.TherapyPlanGoalSelect;

export const reviewItemSelect = {
  id: true,
  number: true,
  reviewDate: true,
  overallProgress: true,
  recommendation: true,
  nextReviewDate: true,
  completedAt: true,
  updatedAt: true,
  therapist: { select: { id: true, fullName: true, membershipId: true } },
  reviewedBy: userSelect,
  _count: { select: { amendments: true } },
} satisfies Prisma.TherapyPlanReviewSelect;

export const planDetailSelect = {
  ...planItemSelect,
  treatmentFocus: true,
  clinicalNotes: true,
  reviewIntervalValue: true,
  reviewIntervalUnit: true,
  additionalInstructions: true,
  activatedAt: true,
  activatedBy: userSelect,
  pausedAt: true,
  statusReason: true,
  completedAt: true,
  completedBy: userSelect,
  completionSummary: true,
  discontinuedAt: true,
  discontinuedBy: userSelect,
  createdBy: userSelect,
  updatedBy: userSelect,
  sourceAssessment: {
    select: {
      id: true,
      type: true,
      status: true,
      assessmentDate: true,
      therapyType: therapyTypeSelect,
      therapist: { select: { id: true, fullName: true } },
    },
  },
  goals: { select: goalSelect, orderBy: { displayOrder: 'asc' } },
  reviews: { select: reviewItemSelect, orderBy: { number: 'desc' } },
  revisions: {
    select: {
      number: true,
      event: true,
      changedFields: true,
      previousSnapshot: true,
      newSnapshot: true,
      reason: true,
      goalId: true,
      reviewId: true,
      revisedAt: true,
      revisedBy: userSelect,
    },
    orderBy: { number: 'desc' },
  },
} satisfies Prisma.TherapyPlanSelect;

export type PlanItemRow = Prisma.TherapyPlanGetPayload<{
  select: typeof planItemSelect;
}>;
export type PlanDetailRow = Prisma.TherapyPlanGetPayload<{
  select: typeof planDetailSelect;
}>;
export type GoalRow = Prisma.TherapyPlanGoalGetPayload<{
  select: typeof goalSelect;
}>;
export type ProgressRow = Prisma.TherapyGoalProgressGetPayload<{
  select: typeof progressSelect;
}>;
export type ReviewItemRow = Prisma.TherapyPlanReviewGetPayload<{
  select: typeof reviewItemSelect;
}>;

export const iso = (d: Date | null) => (d ? formatIsoDate(d) : null);

// ── Presenting ──────────────────────────────────────────────────────────────

const has = (tenant: TenantContext, p: Permission) =>
  tenant.permissions.includes(p);

/**
 * What the caller may do with a plan now, so every screen offers the same choices. The
 * API still checks each request.
 */
export function planActions(
  tenant: TenantContext,
  row: {
    status: TherapyPlanStatus;
    therapist: { membershipId: string | null };
  },
  readable: boolean,
) {
  const own = isOwn(tenant, row.therapist);
  const s = row.status;
  const draft = s === TherapyPlanStatus.DRAFT;
  const open = isOpen(s);
  return {
    /** Open the clinical content */
    view: readable,
    edit: own && draft && has(tenant, 'therapy_plans.update'),
    discard: own && draft && has(tenant, 'therapy_plans.update'),
    activate: own && draft && has(tenant, 'therapy_plans.activate'),
    pause:
      own &&
      s === TherapyPlanStatus.ACTIVE &&
      has(tenant, 'therapy_plans.manage_status'),
    resume:
      own &&
      s === TherapyPlanStatus.PAUSED &&
      has(tenant, 'therapy_plans.manage_status'),
    complete: own && open && has(tenant, 'therapy_plans.manage_status'),
    discontinue: own && open && has(tenant, 'therapy_plans.manage_status'),
    revise: own && open && has(tenant, 'therapy_plans.revise'),
    review: own && open && has(tenant, 'therapy_plans.review'),
    recordProgress:
      own &&
      s === TherapyPlanStatus.ACTIVE &&
      has(tenant, 'therapy_goals.record_progress'),
    /** Add and change goals: freely on a draft, with a reason once active */
    manageGoals:
      own &&
      ((draft && has(tenant, 'therapy_plans.update')) ||
        (open && has(tenant, 'therapy_goals.manage'))),
    reassign:
      has(tenant, 'therapy_plans.reassign') &&
      WORK_STATUSES.reassign.includes(s),
  };
}

export function goalCounts(goals: { status: TherapyGoalStatus }[]) {
  const counts = Object.fromEntries(
    Object.values(TherapyGoalStatus).map((s) => [s, 0]),
  ) as Record<TherapyGoalStatus, number>;
  for (const g of goals) counts[g.status] += 1;
  return { total: goals.length, ...counts };
}

export function toPlanItem(
  tenant: TenantContext,
  row: PlanItemRow,
  readable: boolean,
  today: Date,
) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    status: row.status,
    patient: {
      id: row.patient.id,
      code: row.patient.code,
      fullName: row.patient.fullName,
      photoUrl: row.patient.photoUrl,
      isDeleted: row.patient.deletedAt !== null,
    },
    therapyType: row.therapyType,
    therapist: {
      id: row.therapist.id,
      code: row.therapist.code,
      fullName: row.therapist.fullName,
      isActive: row.therapist.status === 'ACTIVE',
      isDeleted: row.therapist.deletedAt !== null,
      isYou: isOwn(tenant, row.therapist),
    },
    frequency: {
      sessionsPerPeriod: row.sessionsPerPeriod,
      unit: row.frequencyUnit,
      durationMinutes: row.durationMinutes,
      label: describeFrequency(row.sessionsPerPeriod, row.frequencyUnit),
    },
    startDate: formatIsoDate(row.startDate),
    targetEndDate: iso(row.targetEndDate),
    nextReviewDate: iso(row.nextReviewDate),
    reviewState: reviewState(row.status, row.nextReviewDate, today),
    sourceAssessmentId: row.sourceAssessmentId,
    /** Goal counts by status; clinical, so only with access to the content */
    goalSummary: readable ? goalCounts(row.goals) : null,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    actions: planActions(tenant, row, readable),
  };
}

export function toProgress(row: ProgressRow) {
  return {
    id: row.id,
    goalId: row.goalId,
    observationDate: formatIsoDate(row.observationDate),
    goalStatus: row.goalStatus,
    measuredValue: row.measuredValue,
    observation: row.observation,
    correctsId: row.correctsId,
    correctionReason: row.correctionReason,
    /** Replaced by a later correction; kept for the record */
    isCorrected: row.correctedBy !== null,
    correctedById: row.correctedBy?.id ?? null,
    recordedBy: row.recordedBy,
    createdAt: row.createdAt,
  };
}

export function toGoal(row: GoalRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    measurementType: row.measurementType,
    measurementConfig: storedConfig(row.measurementConfig),
    baseline: { value: row.baselineValue, text: row.baselineText },
    target: { value: row.targetValue, text: row.targetText },
    targetDate: iso(row.targetDate),
    status: row.status,
    statusChangedAt: row.statusChangedAt,
    statusChangedBy: row.statusChangedBy,
    notes: row.notes,
    displayOrder: row.displayOrder,
    sourceAssessmentGoalId: row.sourceAssessmentGoalId,
    latestProgress: row.progress[0] ? toProgress(row.progress[0]) : null,
    progressCount: row._count.progress,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toReviewItem(tenant: TenantContext, row: ReviewItemRow) {
  return {
    id: row.id,
    number: row.number,
    reviewDate: formatIsoDate(row.reviewDate),
    overallProgress: row.overallProgress,
    recommendation: row.recommendation,
    nextReviewDate: iso(row.nextReviewDate),
    therapist: {
      id: row.therapist.id,
      fullName: row.therapist.fullName,
      isYou: isOwn(tenant, row.therapist),
    },
    reviewedBy: row.reviewedBy,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
    amendmentCount: row._count.amendments,
  };
}

// ── Snapshots ───────────────────────────────────────────────────────────────

type PlanDetailSource = {
  [K in keyof PlanDetails]: unknown;
};

/** The plan's clinically significant details as plain values, for history. */
export function planDetails(row: PlanDetailSource): PlanDetails {
  return Object.fromEntries(
    PLAN_FIELD_KEYS.map((k) => {
      const v = row[k];
      return [k, v instanceof Date ? formatIsoDate(v) : (v ?? null)];
    }),
  ) as PlanDetails;
}

type GoalDetailSource = { [K in keyof GoalDetails]: unknown };

export function goalDetails(row: GoalDetailSource): GoalDetails {
  return Object.fromEntries(
    GOAL_FIELD_KEYS.map((k) => {
      const v = row[k];
      return [k, v instanceof Date ? formatIsoDate(v) : (v ?? null)];
    }),
  ) as GoalDetails;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export const changedMeanwhile = () =>
  apiError(
    HttpStatus.CONFLICT,
    'This plan was changed in another tab or by someone else. Reload to see the latest version.',
    'PLAN_CHANGED',
  );

export const notResponsible = (therapist: string) =>
  apiError(
    HttpStatus.FORBIDDEN,
    `Only ${therapist}, the responsible therapist, can change this plan.`,
    'NOT_RESPONSIBLE_THERAPIST',
  );

const STATUS_WORDS: Record<TherapyPlanStatus, string> = {
  DRAFT: 'a draft',
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  DISCONTINUED: 'discontinued',
};

export const wrongStatus = (status: TherapyPlanStatus, doing: string) =>
  apiError(
    HttpStatus.CONFLICT,
    status === TherapyPlanStatus.COMPLETED ||
      status === TherapyPlanStatus.DISCONTINUED
      ? `This plan is ${STATUS_WORDS[status]}, so it can’t be changed. Start a new plan instead.`
      : `This plan is ${STATUS_WORDS[status]}, so you can’t ${doing}.`,
    'PLAN_STATUS',
    undefined,
    { status },
  );

export const invalid = (
  errors: Record<string, string>,
  message = 'Please check the highlighted fields',
) => apiError(HttpStatus.BAD_REQUEST, message, 'VALIDATION_FAILED', errors);

export function parseDate(value: string, field: string) {
  const date = parseIsoDate(value);
  if (!date)
    throw fieldError(field, 'Choose a valid date', 'VALIDATION_FAILED');
  return date;
}

// ── Loading for writes ──────────────────────────────────────────────────────

export interface WriteOptions {
  /** Statuses the work is allowed in */
  statuses: readonly TherapyPlanStatus[];
  /** What the work is, for the wrong-status message, e.g. "record progress" */
  doing: string;
  /** The revision the change was made from, when the client sends one */
  revision?: number;
  /** Clinical writes need the responsible therapist; reassigning doesn't */
  ownOnly?: boolean;
  permission?: Permission;
}

/**
 * Center context and the locked plan row every write starts from. The row stays locked
 * until the transaction ends, so status checks and the change can't interleave with
 * another writer, and history numbers are taken in order.
 */
@Injectable()
export class PlanWrites {
  constructor(private readonly prisma: PrismaService) {}

  async center(tenant: TenantContext) {
    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: { timezone: true },
    });
    return { timeZone: center.timezone, today: todayIn(center.timezone) };
  }

  async readableIds(tenant: TenantContext, ids: string[]) {
    if (has(tenant, 'therapy_plans.read') || !ids.length) return new Set(ids);
    const rows = await this.prisma.therapyPlan.findMany({
      where: { AND: [readablePlans(tenant), { id: { in: ids } }] },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  async lock(tx: Tx, tenant: TenantContext, id: string, opts: WriteOptions) {
    if (opts.permission) assertCan(tenant, opts.permission);
    await tx.$queryRaw`
      SELECT id FROM "TherapyPlan"
      WHERE id = ${id}::uuid AND "centerId" = ${tenant.centerId}::uuid
      FOR UPDATE`;
    const plan = await tx.therapyPlan.findFirst({
      where: { id, ...listablePlans(tenant) },
      select: {
        id: true,
        code: true,
        status: true,
        revision: true,
        patientId: true,
        therapyTypeId: true,
        therapistId: true,
        sourceAssessmentId: true,
        title: true,
        treatmentFocus: true,
        clinicalNotes: true,
        sessionsPerPeriod: true,
        frequencyUnit: true,
        durationMinutes: true,
        reviewIntervalValue: true,
        reviewIntervalUnit: true,
        additionalInstructions: true,
        startDate: true,
        targetEndDate: true,
        nextReviewDate: true,
        patient: { select: { code: true, deletedAt: true } },
        therapyType: { select: { id: true, name: true, isActive: true } },
        therapist: {
          select: {
            id: true,
            fullName: true,
            membershipId: true,
            status: true,
          },
        },
      },
    });
    if (!plan) throw planNotFound();
    // The caller can see the plan exists, so say why they can't change it.
    if (opts.ownOnly !== false && !isOwn(tenant, plan.therapist)) {
      throw notResponsible(plan.therapist.fullName);
    }
    if (!opts.statuses.includes(plan.status)) {
      throw wrongStatus(plan.status, opts.doing);
    }
    if (opts.revision !== undefined && plan.revision !== opts.revision) {
      throw changedMeanwhile();
    }
    return plan;
  }

  /** Appends a history entry; the plan row must be locked (see lock). */
  async record(
    tx: Tx,
    tenant: TenantContext,
    planId: string,
    entry: {
      event: TherapyPlanEvent;
      changedFields?: string[];
      previousSnapshot?: object | null;
      newSnapshot?: object | null;
      reason?: string | null;
      goalId?: string | null;
      reviewId?: string | null;
    },
  ) {
    const last = await tx.therapyPlanRevision.aggregate({
      where: { therapyPlanId: planId },
      _max: { number: true },
    });
    await tx.therapyPlanRevision.create({
      data: {
        centerId: tenant.centerId,
        therapyPlanId: planId,
        number: (last._max.number ?? 0) + 1,
        event: entry.event,
        changedFields: entry.changedFields ?? [],
        previousSnapshot:
          (entry.previousSnapshot as Prisma.InputJsonValue) ?? undefined,
        newSnapshot: (entry.newSnapshot as Prisma.InputJsonValue) ?? undefined,
        reason: entry.reason ?? null,
        goalId: entry.goalId ?? null,
        reviewId: entry.reviewId ?? null,
        revisedById: tenant.userId,
      },
    });
  }

  /** A review of this plan, when a change says which review led to it. */
  async assertReview(tx: Tx, planId: string, reviewId: string | undefined) {
    if (!reviewId) return;
    const review = await tx.therapyPlanReview.findFirst({
      where: { id: reviewId, therapyPlanId: planId },
      select: { id: true },
    });
    if (!review) {
      throw fieldError(
        'reviewId',
        'That review belongs to another plan.',
        'REVIEW_NOT_FOUND',
      );
    }
  }
}

export type LockedPlan = Awaited<ReturnType<PlanWrites['lock']>>;
