import { HttpStatus, Injectable } from '@nestjs/common';

import { assessablePatients, readableAssessments } from '../assessments/access';
import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { SettingsService } from '../center-settings/settings.service';
import { isUniqueViolation } from '../centers/centers.service';
import { apiError } from '../common/errors';
import { nextSequenceValue } from '../common/sequences';
import { addDays, formatIsoDate, parseIsoDate } from '../common/time';
import type { Prisma } from '../generated/prisma/client';
import {
  AssessmentStatus,
  MembershipStatus,
  PlanPeriodUnit,
  TherapistStatus,
  TherapyPlanEvent,
  TherapyPlanStatus,
} from '../generated/prisma/enums';
import { assertCan, patientNotFound } from '../patients/access';
import { patientAge } from '../patients/age';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import { visibleTherapists } from '../therapists/access';
import { listablePlans, planNotFound } from './access';
import type {
  CompletePlanDto,
  CreatePlanDto,
  GoalInputDto,
  ListPlansQuery,
  PatientOptionsQuery,
  PlanDetailsDto,
  ReasonedTransitionDto,
  ReassignPlanDto,
  ResumeDto,
  RevisePlanDto,
  TransitionDto,
  UpdateDraftDto,
} from './dto';
import { checkGoal, loadCategories, type GoalData } from './goal-input';
import type { Errors } from './measurement';
import {
  OPEN_STATUSES,
  PLAN_FIELD_KEYS,
  PLAN_LIMITS,
  TRANSITIONS,
  WORK_STATUSES,
  changedPlanLabels,
  type PlanAction,
  type PlanDetails,
} from './rules';
import {
  PlanWrites,
  changedMeanwhile,
  goalCounts,
  invalid,
  iso,
  planDetailSelect,
  planDetails,
  planItemSelect,
  toGoal,
  toPlanItem,
  toReviewItem,
  type Db,
  type LockedPlan,
  type PlanDetailRow,
  type Tx,
} from './shared';

const CODE_PREFIX = 'TP-';
const OPEN_PLAN_CODE = 'PLAN_ALREADY_ACTIVE';

const alreadyOpen = (existing?: { id: string; code: string }) =>
  apiError(
    HttpStatus.CONFLICT,
    existing
      ? `This patient already has a plan in force for this therapy (${existing.code}). Complete or discontinue it first.`
      : 'This patient already has a plan in force for this therapy. Complete or discontinue it first.',
    OPEN_PLAN_CODE,
    undefined,
    existing ? { planId: existing.id, planCode: existing.code } : undefined,
  );

/** Plan details as stored: dates as Date, everything else as is. */
type DetailsData = {
  [K in keyof PlanDetails]: K extends
    'startDate' | 'targetEndDate' | 'nextReviewDate'
    ? Date | null
    : PlanDetails[K];
};

/**
 * Therapy plans: drafting, activating, pausing, completing and discontinuing, formal
 * revisions and reassignment, and the lists. Clinical changes are only ever made by the
 * plan's responsible therapist; see access.ts for who can read what. Nothing here books,
 * sells or bills anything, and nothing changes the source assessment.
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly writes: PlanWrites,
    private readonly settings: SettingsService,
  ) {}

  // ── Reading ───────────────────────────────────────────────────────────────

  async list(tenant: TenantContext, query: ListPlansQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const { today } = await this.writes.center(tenant);
    const search = query.search;
    const from = query.startFrom ? parseIsoDate(query.startFrom) : null;
    const to = query.startTo ? parseIsoDate(query.startTo) : null;
    const due = query.reviewDue && {
      status: { in: OPEN_STATUSES },
      nextReviewDate:
        query.reviewDue === 'OVERDUE'
          ? { lt: today }
          : { lte: addDays(today, query.reviewDue === 'NEXT_7_DAYS' ? 7 : 30) },
    };
    const where: Prisma.TherapyPlanWhereInput = {
      AND: [
        listablePlans(tenant),
        {
          ...(query.patientId && { patientId: query.patientId }),
          ...(query.therapyTypeId && { therapyTypeId: query.therapyTypeId }),
          ...(query.therapistId && { therapistId: query.therapistId }),
          ...(query.status?.length && { status: { in: query.status } }),
          ...((from || to) && {
            startDate: { ...(from && { gte: from }), ...(to && { lte: to }) },
          }),
        },
        due || {},
        search
          ? {
              OR: [
                { code: { contains: search, mode: 'insensitive' } },
                { title: { contains: search, mode: 'insensitive' } },
                {
                  patient: {
                    fullName: { contains: search, mode: 'insensitive' },
                  },
                },
                {
                  patient: { code: { contains: search, mode: 'insensitive' } },
                },
                {
                  therapist: {
                    fullName: { contains: search, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {},
      ],
    };
    const order =
      query.sortOrder ??
      (query.sortBy === 'nextReviewDate' || query.sortBy === 'patientName'
        ? 'asc'
        : 'desc');
    const orderBy: Prisma.TherapyPlanOrderByWithRelationInput[] =
      query.sortBy === 'nextReviewDate'
        ? [{ nextReviewDate: { sort: order, nulls: 'last' } }]
        : query.sortBy === 'patientName'
          ? [{ patient: { fullName: order } }]
          : query.sortBy === 'updatedAt'
            ? [{ updatedAt: order }]
            : [{ createdAt: order }];
    const [total, rows] = await Promise.all([
      this.prisma.therapyPlan.count({ where }),
      this.prisma.therapyPlan.findMany({
        where,
        select: planItemSelect,
        orderBy: [...orderBy, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const readable = await this.writes.readableIds(
      tenant,
      rows.map((r) => r.id),
    );
    return {
      items: rows.map((r) => toPlanItem(tenant, r, readable.has(r.id), today)),
      total,
      page,
      pageSize,
    };
  }

  /** One patient's plans: those in force first, then drafts, then closed ones. */
  async patientPlans(tenant: TenantContext, patientId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, ...assessablePatients(tenant) },
      select: { id: true, code: true, fullName: true },
    });
    if (!patient) throw patientNotFound();
    const { today } = await this.writes.center(tenant);
    const rows = await this.prisma.therapyPlan.findMany({
      where: { AND: [listablePlans(tenant), { patientId }] },
      select: planItemSelect,
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });
    const rank: Record<TherapyPlanStatus, number> = {
      ACTIVE: 0,
      PAUSED: 1,
      DRAFT: 2,
      COMPLETED: 3,
      DISCONTINUED: 3,
    };
    rows.sort((a, b) => rank[a.status] - rank[b.status]);
    const readable = await this.writes.readableIds(
      tenant,
      rows.map((r) => r.id),
    );
    return {
      patient,
      items: rows.map((r) => toPlanItem(tenant, r, readable.has(r.id), today)),
    };
  }

  /** Patients the caller may start a plan for, by name or ID. */
  async patientOptions(tenant: TenantContext, query: PatientOptionsQuery) {
    const search = query.search;
    const { today } = await this.writes.center(tenant);
    const rows = await this.prisma.patient.findMany({
      where: {
        AND: [
          assessablePatients(tenant),
          search
            ? {
                OR: [
                  { fullName: { contains: search, mode: 'insensitive' } },
                  { code: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {},
        ],
      },
      select: {
        id: true,
        code: true,
        fullName: true,
        photoUrl: true,
        status: true,
        gender: true,
        dateOfBirth: true,
        approxAgeMonths: true,
        approxAgeAsOf: true,
      },
      orderBy: [{ fullName: 'asc' }, { code: 'asc' }],
      take: 20,
    });
    return {
      items: rows.map((p) => ({
        id: p.id,
        code: p.code,
        fullName: p.fullName,
        photoUrl: p.photoUrl,
        status: p.status,
        gender: p.gender,
        age: patientAge(p, today),
      })),
    };
  }

  /**
   * The patient's completed assessments the caller may read, with their recommendations
   * and initial goals: the starting suggestions for a new plan. Plans already based on
   * each are listed so staff don't plan the same thing twice by accident.
   */
  async assessmentOptions(tenant: TenantContext, patientId: string) {
    await this.patient(this.prisma, tenant, patientId);
    const rows = await this.prisma.assessment.findMany({
      where: {
        AND: [
          readableAssessments(tenant),
          {
            patientId,
            status: {
              in: [AssessmentStatus.COMPLETED, AssessmentStatus.AMENDED],
            },
          },
        ],
      },
      select: {
        id: true,
        type: true,
        status: true,
        assessmentDate: true,
        summary: true,
        suggestedReviewDate: true,
        therapyType: {
          select: { id: true, name: true, code: true, color: true },
        },
        therapist: { select: { id: true, fullName: true } },
        recommendations: {
          select: {
            sessionsPerWeek: true,
            durationMinutes: true,
            reviewAfterWeeks: true,
            note: true,
            therapyType: {
              select: { id: true, name: true, code: true, color: true },
            },
          },
          orderBy: { displayOrder: 'asc' },
        },
        goals: {
          select: {
            id: true,
            title: true,
            description: true,
            priority: true,
            targetReviewDate: true,
          },
          orderBy: { displayOrder: 'asc' },
        },
        therapyPlans: {
          select: {
            id: true,
            code: true,
            status: true,
            therapyTypeId: true,
          },
        },
      },
      orderBy: [{ assessmentDate: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    return {
      items: rows.map((a) => ({
        ...a,
        assessmentDate: formatIsoDate(a.assessmentDate),
        suggestedReviewDate: iso(a.suggestedReviewDate),
        goals: a.goals.map((g) => ({
          ...g,
          targetReviewDate: iso(g.targetReviewDate),
        })),
      })),
    };
  }

  private toDetail(
    tenant: TenantContext,
    row: PlanDetailRow,
    readable: boolean,
    today: Date,
  ) {
    const item = toPlanItem(tenant, row, readable, today);
    const common = {
      ...item,
      reviewInterval: {
        value: row.reviewIntervalValue,
        unit: row.reviewIntervalUnit,
      },
      activatedAt: row.activatedAt,
      activatedBy: row.activatedBy,
      pausedAt: row.pausedAt,
      completedAt: row.completedAt,
      discontinuedAt: row.discontinuedAt,
      createdBy: row.createdBy,
    };
    if (!readable) {
      return {
        ...common,
        clinicalAccess: false as const,
        treatmentFocus: null,
        clinicalNotes: null,
        additionalInstructions: null,
        statusReason: null,
        completionSummary: null,
        completedBy: null,
        discontinuedBy: null,
        updatedBy: null,
        sourceAssessment: null,
        goals: [],
        reviews: [],
        history: [],
      };
    }
    return {
      ...common,
      clinicalAccess: true as const,
      treatmentFocus: row.treatmentFocus,
      clinicalNotes: row.clinicalNotes,
      additionalInstructions: row.additionalInstructions,
      statusReason: row.statusReason,
      completionSummary: row.completionSummary,
      completedBy: row.completedBy,
      discontinuedBy: row.discontinuedBy,
      updatedBy: row.updatedBy,
      sourceAssessment: row.sourceAssessment && {
        ...row.sourceAssessment,
        assessmentDate: formatIsoDate(row.sourceAssessment.assessmentDate),
      },
      goals: row.goals.map(toGoal),
      reviews: row.reviews.map((r) => toReviewItem(tenant, r)),
      history: row.revisions,
    };
  }

  async get(tenant: TenantContext, id: string) {
    const row = await this.prisma.therapyPlan.findFirst({
      where: { id, ...listablePlans(tenant) },
      select: planDetailSelect,
    });
    if (!row) throw planNotFound();
    const readable = (await this.writes.readableIds(tenant, [id])).has(id);
    const { today } = await this.writes.center(tenant);
    return this.toDetail(tenant, row, readable, today);
  }

  // ── Checking references ───────────────────────────────────────────────────

  private async therapyType(
    db: Db,
    tenant: TenantContext,
    id: string,
    { requireActive = true } = {},
  ) {
    const type = await db.therapyType.findFirst({
      where: { id, centerId: tenant.centerId },
      select: { id: true, name: true, isActive: true },
    });
    if (!type) {
      throw fieldError(
        'therapyTypeId',
        'This therapy no longer exists. Reload and try again.',
        'THERAPY_TYPE_NOT_FOUND',
      );
    }
    if (requireActive && !type.isActive) {
      throw fieldError(
        'therapyTypeId',
        `${type.name} is inactive. Activate it in Settings first.`,
        'THERAPY_TYPE_INACTIVE',
      );
    }
    return type;
  }

  /**
   * An active therapist the caller may see, who provides the therapy and signs in with
   * a staff account of this center: the responsible therapist runs the plan themselves.
   */
  private async therapist(
    db: Db,
    tenant: TenantContext,
    id: string,
    therapyTypeId: string,
    field = 'therapistId',
  ) {
    const therapist = await db.therapist.findFirst({
      where: { id, ...visibleTherapists(tenant) },
      select: {
        id: true,
        fullName: true,
        status: true,
        membership: { select: { status: true } },
        specializations: { where: { therapyTypeId }, select: { id: true } },
      },
    });
    const fail = (message: string, code: string) =>
      fieldError(field, message, code);
    if (!therapist) {
      throw fail(
        'This therapist no longer exists. Choose another.',
        'THERAPIST_NOT_FOUND',
      );
    }
    if (therapist.status !== TherapistStatus.ACTIVE) {
      throw fail(`${therapist.fullName} is inactive.`, 'THERAPIST_INACTIVE');
    }
    if (!therapist.specializations.length) {
      throw fail(
        `${therapist.fullName} doesn’t provide this therapy. Choose another therapist.`,
        'THERAPIST_NOT_SPECIALIZED',
      );
    }
    if (therapist.membership?.status !== MembershipStatus.ACTIVE) {
      throw fail(
        `${therapist.fullName} has no active staff account, so they can’t manage a plan. Link one on their profile first.`,
        'THERAPIST_NO_ACCOUNT',
      );
    }
    return therapist;
  }

  private async patient(db: Db, tenant: TenantContext, id: string) {
    const patient = await db.patient.findFirst({
      where: { id, ...assessablePatients(tenant) },
      select: { id: true, code: true, fullName: true },
    });
    if (!patient) {
      throw fieldError(
        'patientId',
        'This patient isn’t available. Search again.',
        'PATIENT_NOT_FOUND',
      );
    }
    return patient;
  }

  /**
   * A completed assessment of the same patient that the caller may read. Its therapy
   * must be the plan's, or one it recommended: a recommendation documents the
   * cross-discipline referral, e.g. an OT assessment recommending speech therapy.
   */
  private async sourceAssessment(
    db: Db,
    tenant: TenantContext,
    id: string,
    patientId: string,
    therapyTypeId: string,
  ) {
    const assessment = await db.assessment.findFirst({
      where: { id, ...readableAssessments(tenant) },
      select: {
        id: true,
        status: true,
        patientId: true,
        therapyTypeId: true,
        recommendations: { select: { therapyTypeId: true } },
        goals: { select: { id: true } },
      },
    });
    const fail = (message: string, code: string) =>
      fieldError('sourceAssessmentId', message, code);
    if (!assessment) {
      throw fail('This assessment isn’t available.', 'ASSESSMENT_NOT_FOUND');
    }
    if (assessment.patientId !== patientId) {
      throw fail(
        'This assessment is for another patient.',
        'ASSESSMENT_PATIENT_MISMATCH',
      );
    }
    if (assessment.status === AssessmentStatus.DRAFT) {
      throw fail(
        'This assessment is still a draft. Complete it before planning from it.',
        'ASSESSMENT_NOT_COMPLETED',
      );
    }
    if (
      assessment.therapyTypeId !== therapyTypeId &&
      !assessment.recommendations.some((r) => r.therapyTypeId === therapyTypeId)
    ) {
      throw fail(
        'This assessment is for another therapy and doesn’t recommend this one.',
        'ASSESSMENT_THERAPY_MISMATCH',
      );
    }
    return {
      id: assessment.id,
      goalIds: new Set(assessment.goals.map((g) => g.id)),
    };
  }

  /**
   * One of the therapy type's active duration options, or any length in steps of 5
   * minutes when the center allows custom durations. `keep` is the plan's current
   * length, which may stay even if that option has since been removed.
   */
  private async checkDuration(
    db: Db,
    tenant: TenantContext,
    therapyTypeId: string,
    minutes: number | null,
    errors: Errors,
    keep?: number | null,
  ) {
    if (minutes === null || minutes === keep) return;
    const options = await db.therapyDurationOption.findMany({
      where: { therapyTypeId, isActive: true },
      select: { durationMinutes: true },
      orderBy: { durationMinutes: 'asc' },
    });
    const allowed = options.map((o) => o.durationMinutes);
    if (allowed.includes(minutes)) return;
    const { allowCustomDuration } = await this.settings.getScheduling(tenant);
    if (allowCustomDuration && minutes % 5 === 0) return;
    errors.durationMinutes = allowCustomDuration
      ? 'Use a length in steps of 5 minutes'
      : `Choose one of this therapy’s durations: ${allowed.join(', ') || 'none'} minutes`;
  }

  /**
   * The details after a change: each one sent replaces the current one. Checks dates,
   * frequency and the review interval together, since they depend on each other.
   */
  private mergeDetails(
    current: PlanDetails | null,
    dto: PlanDetailsDto,
    today: Date,
    errors: Errors,
  ): DetailsData {
    const merged = Object.fromEntries(
      PLAN_FIELD_KEYS.map((k) => [
        k,
        dto[k] !== undefined ? dto[k] : (current?.[k] ?? null),
      ]),
    ) as PlanDetails;
    const date = (field: 'startDate' | 'targetEndDate' | 'nextReviewDate') => {
      const value = merged[field] as string | null;
      if (!value) return null;
      const parsed = parseIsoDate(value);
      if (!parsed) errors[field] = 'Choose a valid date';
      return parsed;
    };
    const startDate = date('startDate');
    const targetEndDate = date('targetEndDate');
    const nextReviewDate = date('nextReviewDate');
    if (!startDate && !errors.startDate)
      errors.startDate = 'Choose a start date';
    if (
      startDate &&
      dto.startDate !== undefined &&
      (startDate < parseIsoDate('1990-01-01')! ||
        startDate > addDays(today, 366))
    ) {
      errors.startDate = 'Choose a date within the next year';
    }
    if (startDate && targetEndDate && targetEndDate < startDate) {
      errors.targetEndDate =
        'The target end date can’t be before the start date';
    }
    if (startDate && nextReviewDate && nextReviewDate < startDate) {
      errors.nextReviewDate = 'The review date can’t be before the start date';
    }

    const sessions = merged.sessionsPerPeriod as number | null;
    const unit = merged.frequencyUnit as PlanPeriodUnit | null;
    if ((sessions === null) !== (unit === null)) {
      errors[sessions === null ? 'sessionsPerPeriod' : 'frequencyUnit'] =
        sessions === null
          ? 'Enter how many sessions'
          : 'Choose per day, week or month';
    } else if (sessions !== null && unit) {
      const max = PLAN_LIMITS.sessions[unit];
      if (sessions > max) {
        errors.sessionsPerPeriod = `Enter 1 to ${max} sessions per ${unit.toLowerCase()}`;
      }
    }
    const every = merged.reviewIntervalValue as number | null;
    const everyUnit = merged.reviewIntervalUnit as PlanPeriodUnit | null;
    if ((every === null) !== (everyUnit === null)) {
      errors[every === null ? 'reviewIntervalValue' : 'reviewIntervalUnit'] =
        every === null
          ? 'Enter the review interval'
          : 'Choose days, weeks or months';
    } else if (every !== null && everyUnit) {
      const max = PLAN_LIMITS.reviewInterval[everyUnit];
      if (every > max) {
        errors.reviewIntervalValue = `Enter 1 to ${max} ${everyUnit.toLowerCase()}s`;
      }
    }
    return {
      ...merged,
      startDate,
      targetEndDate,
      nextReviewDate,
    };
  }

  /**
   * Checks a draft's goals. Goals copied from the source assessment must come from it;
   * everything else is the clinician's own definition.
   */
  private async checkGoals(
    db: Db,
    tenant: TenantContext,
    goals: GoalInputDto[],
    ctx: {
      therapyTypeId: string;
      assessmentGoalIds: Set<string> | null;
      existing?: Map<string, { categoryId: string | null }>;
    },
    errors: Errors,
  ) {
    const categories = await loadCategories(
      db,
      tenant.centerId,
      goals.map((g) => g.categoryId),
    );
    return goals.map((g, i) => {
      const keep = g.id ? ctx.existing?.get(g.id) : undefined;
      if (g.id && !keep)
        errors[`goals.${i}`] = 'This goal no longer exists. Reload the plan.';
      if (
        g.sourceAssessmentGoalId &&
        !ctx.assessmentGoalIds?.has(g.sourceAssessmentGoalId)
      ) {
        errors[`goals.${i}.sourceAssessmentGoalId`] = ctx.assessmentGoalIds
          ? 'This goal isn’t in the source assessment anymore. Reload and pick again.'
          : 'Choose the source assessment first';
      }
      const checked = checkGoal(
        g,
        {
          therapyTypeId: ctx.therapyTypeId,
          categories,
          keepCategoryId: keep?.categoryId,
        },
        `goals.${i}`,
      );
      Object.assign(errors, checked.errors);
      return {
        id: g.id,
        sourceAssessmentGoalId: g.sourceAssessmentGoalId ?? null,
        data: checked.data,
      };
    });
  }

  // ── Creating and drafting ─────────────────────────────────────────────────

  async create(tenant: TenantContext, dto: CreatePlanDto, ip: string | null) {
    if (!dto.sourceAssessmentId) {
      assertCan(tenant, 'therapy_plans.create_without_assessment');
    }
    const { today } = await this.writes.center(tenant);
    const id = await this.prisma.$transaction(async (tx) => {
      await this.therapyType(tx, tenant, dto.therapyTypeId);
      const therapist = await this.therapist(
        tx,
        tenant,
        dto.therapistId,
        dto.therapyTypeId,
      );
      const patient = await this.patient(tx, tenant, dto.patientId);
      const source = dto.sourceAssessmentId
        ? await this.sourceAssessment(
            tx,
            tenant,
            dto.sourceAssessmentId,
            patient.id,
            dto.therapyTypeId,
          )
        : null;
      const errors: Errors = {};
      const details = this.mergeDetails(null, dto, today, errors);
      await this.checkDuration(
        tx,
        tenant,
        dto.therapyTypeId,
        details.durationMinutes as number | null,
        errors,
      );
      const goals = await this.checkGoals(
        tx,
        tenant,
        (dto.goals ?? []).map((g) => ({ ...g, id: undefined })),
        {
          therapyTypeId: dto.therapyTypeId,
          assessmentGoalIds: source?.goalIds ?? null,
        },
        errors,
      );
      if (Object.keys(errors).length) throw invalid(errors);

      const number = await nextSequenceValue(
        tx,
        tenant.centerId,
        'therapy_plan',
      );
      const code = `${CODE_PREFIX}${String(number).padStart(4, '0')}`;
      const created = await tx.therapyPlan.create({
        data: {
          ...this.detailsData(details),
          centerId: tenant.centerId,
          code,
          patientId: patient.id,
          therapyTypeId: dto.therapyTypeId,
          therapistId: therapist.id,
          sourceAssessmentId: source?.id ?? null,
          createdById: tenant.userId,
        },
        select: { id: true },
      });
      await this.createGoals(tx, tenant, created.id, goals, 0);
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'therapy_plan.created',
          entityType: 'TherapyPlan',
          entityId: created.id,
          metadata: {
            planCode: code,
            patientCode: patient.code,
            therapyTypeId: dto.therapyTypeId,
            therapistId: therapist.id,
            sourceAssessmentId: source?.id ?? null,
            goals: goals.length,
            importedGoals: goals.filter((g) => g.sourceAssessmentGoalId).length,
          },
          ipAddress: ip,
        },
        tx,
      );
      return created.id;
    });
    return this.get(tenant, id);
  }

  private detailsData(details: DetailsData) {
    return {
      title: details.title as string,
      treatmentFocus: details.treatmentFocus as string | null,
      clinicalNotes: details.clinicalNotes as string | null,
      sessionsPerPeriod: details.sessionsPerPeriod as number | null,
      frequencyUnit: details.frequencyUnit as PlanPeriodUnit | null,
      durationMinutes: details.durationMinutes as number | null,
      reviewIntervalValue: details.reviewIntervalValue as number | null,
      reviewIntervalUnit: details.reviewIntervalUnit as PlanPeriodUnit | null,
      additionalInstructions: details.additionalInstructions as string | null,
      startDate: details.startDate!,
      targetEndDate: details.targetEndDate,
      nextReviewDate: details.nextReviewDate,
    };
  }

  private async createGoals(
    tx: Tx,
    tenant: TenantContext,
    planId: string,
    goals: { sourceAssessmentGoalId: string | null; data: GoalData }[],
    firstOrder: number,
  ) {
    for (const [i, g] of goals.entries()) {
      await tx.therapyPlanGoal.create({
        data: {
          ...g.data,
          centerId: tenant.centerId,
          therapyPlanId: planId,
          sourceAssessmentGoalId: g.sourceAssessmentGoalId,
          displayOrder: firstOrder + i,
          createdById: tenant.userId,
        },
      });
    }
  }

  /**
   * Saves a draft: its details, people, therapy, source assessment and the whole goal
   * list (kept by id, added, or removed). Drafts aren't clinical records yet, so there's
   * no history; that starts at activation.
   */
  async updateDraft(tenant: TenantContext, id: string, dto: UpdateDraftDto) {
    const { today } = await this.writes.center(tenant);
    await this.prisma.$transaction(async (tx) => {
      const plan = await this.writes.lock(tx, tenant, id, {
        statuses: WORK_STATUSES.editDraft,
        doing: 'edit it as a draft',
        revision: dto.revision,
      });
      const therapyTypeId = dto.therapyTypeId ?? plan.therapyTypeId;
      if (dto.therapyTypeId && dto.therapyTypeId !== plan.therapyTypeId) {
        await this.therapyType(tx, tenant, dto.therapyTypeId);
      }
      const therapistId = dto.therapistId ?? plan.therapistId;
      if (dto.therapistId || dto.therapyTypeId) {
        await this.therapist(tx, tenant, therapistId, therapyTypeId);
      }
      const sourceId =
        dto.sourceAssessmentId !== undefined
          ? dto.sourceAssessmentId
          : plan.sourceAssessmentId;
      if (!sourceId)
        assertCan(tenant, 'therapy_plans.create_without_assessment');
      const source = sourceId
        ? await this.sourceAssessment(
            tx,
            tenant,
            sourceId,
            plan.patientId,
            therapyTypeId,
          )
        : null;

      const errors: Errors = {};
      const details = this.mergeDetails(planDetails(plan), dto, today, errors);
      await this.checkDuration(
        tx,
        tenant,
        therapyTypeId,
        details.durationMinutes as number | null,
        errors,
        therapyTypeId === plan.therapyTypeId ? plan.durationMinutes : undefined,
      );
      const existing = await tx.therapyPlanGoal.findMany({
        where: { therapyPlanId: id },
        select: { id: true, categoryId: true, sourceAssessmentGoalId: true },
      });
      const goals = dto.goals
        ? await this.checkGoals(
            tx,
            tenant,
            dto.goals,
            {
              therapyTypeId,
              assessmentGoalIds: source?.goalIds ?? null,
              existing: new Map(existing.map((g) => [g.id, g])),
            },
            errors,
          )
        : null;
      // Goals kept as they are must still suit a changed therapy or assessment.
      if (!goals && therapyTypeId !== plan.therapyTypeId) {
        const categories = await tx.therapyPlanGoal.count({
          where: {
            therapyPlanId: id,
            category: { therapyTypeId: { not: null, notIn: [therapyTypeId] } },
          },
        });
        if (categories) {
          errors.therapyTypeId =
            'Some goals use categories of the previous therapy. Change their categories first.';
        }
      }
      if (Object.keys(errors).length) throw invalid(errors);

      const updated = await tx.therapyPlan.updateMany({
        where: { id, revision: plan.revision, status: TherapyPlanStatus.DRAFT },
        data: {
          ...this.detailsData(details),
          therapyTypeId,
          therapistId,
          sourceAssessmentId: source?.id ?? null,
          revision: { increment: 1 },
          updatedById: tenant.userId,
        },
      });
      if (updated.count === 0) throw changedMeanwhile();

      if (goals) {
        const keep = new Set(goals.flatMap((g) => (g.id ? [g.id] : [])));
        await tx.therapyPlanGoal.deleteMany({
          where: { therapyPlanId: id, id: { notIn: [...keep] } },
        });
        for (const [i, g] of goals.entries()) {
          if (g.id) {
            await tx.therapyPlanGoal.update({
              where: { id: g.id },
              data: {
                ...g.data,
                sourceAssessmentGoalId: g.sourceAssessmentGoalId,
                displayOrder: i,
              },
            });
          } else {
            await this.createGoals(tx, tenant, id, [g], i);
          }
        }
      } else if ((source?.id ?? null) !== plan.sourceAssessmentId) {
        // Goals copied from an assessment the plan no longer uses lose that link.
        await tx.therapyPlanGoal.updateMany({
          where: { therapyPlanId: id, sourceAssessmentGoalId: { not: null } },
          data: { sourceAssessmentGoalId: null },
        });
      }
    });
    return this.get(tenant, id);
  }

  /** Throws a draft away. Plans that were ever active are kept (the database insists). */
  async discard(tenant: TenantContext, id: string, ip: string | null) {
    await this.prisma.$transaction(async (tx) => {
      const plan = await this.writes.lock(tx, tenant, id, {
        statuses: WORK_STATUSES.editDraft,
        doing: 'discard it',
        permission: 'therapy_plans.update',
      });
      await tx.therapyPlanGoal.deleteMany({ where: { therapyPlanId: id } });
      await tx.therapyPlan.delete({ where: { id } });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'therapy_plan.discarded',
          entityType: 'TherapyPlan',
          entityId: id,
          metadata: { planCode: plan.code, patientCode: plan.patient.code },
          ipAddress: ip,
        },
        tx,
      );
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Goals as a short summary for history snapshots: titles and statuses, no content. */
  private async goalSummary(tx: Tx, planId: string) {
    const goals = await tx.therapyPlanGoal.findMany({
      where: { therapyPlanId: planId },
      select: { id: true, title: true, status: true },
      orderBy: { displayOrder: 'asc' },
    });
    return { goals, counts: goalCounts(goals) };
  }

  private async transition(
    tenant: TenantContext,
    id: string,
    action: PlanAction,
    dto: TransitionDto,
    ip: string | null,
    apply: (
      tx: Tx,
      plan: LockedPlan,
    ) => Promise<{
      data: Prisma.TherapyPlanUncheckedUpdateManyInput;
      reason?: string | null;
      reviewId?: string;
      snapshot?: object;
    }>,
  ) {
    const rule = TRANSITIONS[action];
    const doing = {
      activate: 'activate it',
      pause: 'pause it',
      resume: 'resume it',
      complete: 'complete it',
      discontinue: 'discontinue it',
    }[action];
    await this.prisma.$transaction(async (tx) => {
      const plan = await this.writes.lock(tx, tenant, id, {
        statuses: rule.from,
        doing,
        revision: dto.revision,
        permission:
          action === 'activate'
            ? 'therapy_plans.activate'
            : 'therapy_plans.manage_status',
      });
      const change = await apply(tx, plan);
      await this.writes.assertReview(tx, id, change.reviewId);
      try {
        const updated = await tx.therapyPlan.updateMany({
          where: { id, revision: plan.revision, status: plan.status },
          data: {
            ...change.data,
            status: rule.to,
            revision: { increment: 1 },
            updatedById: tenant.userId,
          },
        });
        if (updated.count === 0) throw changedMeanwhile();
      } catch (error) {
        if (isUniqueViolation(error)) throw alreadyOpen();
        throw error;
      }
      const event = {
        activate: TherapyPlanEvent.ACTIVATED,
        pause: TherapyPlanEvent.PAUSED,
        resume: TherapyPlanEvent.RESUMED,
        complete: TherapyPlanEvent.COMPLETED,
        discontinue: TherapyPlanEvent.DISCONTINUED,
      }[action];
      await this.writes.record(tx, tenant, id, {
        event,
        changedFields: ['Status'],
        previousSnapshot: { status: plan.status },
        newSnapshot: { status: rule.to, ...change.snapshot },
        reason: change.reason ?? null,
        reviewId: change.reviewId ?? null,
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: `therapy_plan.${{ activate: 'activated', pause: 'paused', resume: 'resumed', complete: 'completed', discontinue: 'discontinued' }[action]}`,
          entityType: 'TherapyPlan',
          entityId: id,
          metadata: {
            planCode: plan.code,
            patientCode: plan.patient.code,
            from: plan.status,
            to: rule.to,
          },
          ipAddress: ip,
        },
        tx,
      );
    });
    return this.get(tenant, id);
  }

  /**
   * Puts a draft into force. It needs a recommended frequency and at least one goal,
   * a therapist and therapy still active, and no other plan in force for the same
   * patient and therapy (the database enforces that last one too).
   */
  activate(
    tenant: TenantContext,
    id: string,
    dto: TransitionDto,
    ip: string | null,
  ) {
    return this.transition(
      tenant,
      id,
      'activate',
      dto,
      ip,
      async (tx, plan) => {
        const errors: Errors = {};
        if (!plan.sessionsPerPeriod || !plan.frequencyUnit) {
          errors.sessionsPerPeriod =
            'Set the recommended frequency before activating';
        }
        const goals = await tx.therapyPlanGoal.count({
          where: { therapyPlanId: id },
        });
        if (!goals) errors.goals = 'Add at least one goal before activating';
        if (Object.keys(errors).length) {
          throw invalid(
            errors,
            'The plan isn’t complete yet. Check the highlighted fields.',
          );
        }
        if (plan.patient.deletedAt) throw planNotFound();
        if (!plan.therapyType.isActive) {
          throw fieldError(
            'therapyTypeId',
            `${plan.therapyType.name} is inactive, so plans for it can’t be activated.`,
            'THERAPY_TYPE_INACTIVE',
          );
        }
        await this.therapist(tx, tenant, plan.therapistId, plan.therapyTypeId);
        const open = await tx.therapyPlan.findFirst({
          where: {
            patientId: plan.patientId,
            therapyTypeId: plan.therapyTypeId,
            status: { in: OPEN_STATUSES },
            id: { not: id },
          },
          select: { id: true, code: true },
        });
        if (open) throw alreadyOpen(open);
        const summary = await this.goalSummary(tx, id);
        return {
          data: { activatedAt: new Date(), activatedById: tenant.userId },
          snapshot: { details: planDetails(plan), goals: summary.goals },
        };
      },
    );
  }

  pause(
    tenant: TenantContext,
    id: string,
    dto: ReasonedTransitionDto,
    ip: string | null,
  ) {
    return this.transition(tenant, id, 'pause', dto, ip, () =>
      Promise.resolve({
        data: { pausedAt: new Date(), statusReason: dto.reason },
        reason: dto.reason,
        reviewId: dto.reviewId,
      }),
    );
  }

  resume(tenant: TenantContext, id: string, dto: ResumeDto, ip: string | null) {
    return this.transition(tenant, id, 'resume', dto, ip, () =>
      Promise.resolve({
        data: { pausedAt: null, statusReason: null },
        reason: dto.note ?? null,
        reviewId: dto.reviewId,
      }),
    );
  }

  /** Concludes treatment formally. Appointments and packages are left as they are. */
  complete(
    tenant: TenantContext,
    id: string,
    dto: CompletePlanDto,
    ip: string | null,
  ) {
    return this.transition(tenant, id, 'complete', dto, ip, async (tx) => {
      const summary = await this.goalSummary(tx, id);
      return {
        data: {
          completedAt: new Date(),
          completedById: tenant.userId,
          completionSummary: dto.completionSummary,
          pausedAt: null,
        },
        reviewId: dto.reviewId,
        snapshot: { goals: summary.goals },
      };
    });
  }

  discontinue(
    tenant: TenantContext,
    id: string,
    dto: ReasonedTransitionDto,
    ip: string | null,
  ) {
    return this.transition(tenant, id, 'discontinue', dto, ip, async (tx) => {
      const summary = await this.goalSummary(tx, id);
      return {
        data: {
          discontinuedAt: new Date(),
          discontinuedById: tenant.userId,
          statusReason: dto.reason,
          pausedAt: null,
        },
        reason: dto.reason,
        reviewId: dto.reviewId,
        snapshot: { goals: summary.goals },
      };
    });
  }

  // ── Revisions ─────────────────────────────────────────────────────────────

  /**
   * Changes an active or paused plan's details with a reason. The values before and
   * after go into its history, so earlier frequencies, durations and dates stay
   * readable. Goals are changed on their own (goals.service.ts).
   */
  async revise(
    tenant: TenantContext,
    id: string,
    dto: RevisePlanDto,
    ip: string | null,
  ) {
    const { today } = await this.writes.center(tenant);
    await this.prisma.$transaction(async (tx) => {
      const plan = await this.writes.lock(tx, tenant, id, {
        statuses: WORK_STATUSES.revise,
        doing: 'revise it',
        revision: dto.revision,
        permission: 'therapy_plans.revise',
      });
      await this.writes.assertReview(tx, id, dto.reviewId);
      const errors: Errors = {};
      const before = planDetails(plan);
      const details = this.mergeDetails(before, dto, today, errors);
      await this.checkDuration(
        tx,
        tenant,
        plan.therapyTypeId,
        details.durationMinutes as number | null,
        errors,
        plan.durationMinutes,
      );
      if (Object.keys(errors).length) throw invalid(errors);
      const after = planDetails(details);
      const changed = changedPlanLabels(before, after);
      if (!changed.length) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'Nothing has changed. Make the revision, then save it.',
          'NOTHING_CHANGED',
        );
      }
      const updated = await tx.therapyPlan.updateMany({
        where: { id, revision: plan.revision },
        data: {
          ...this.detailsData(details),
          revision: { increment: 1 },
          updatedById: tenant.userId,
        },
      });
      if (updated.count === 0) throw changedMeanwhile();
      await this.writes.record(tx, tenant, id, {
        event: TherapyPlanEvent.REVISED,
        changedFields: changed,
        previousSnapshot: before,
        newSnapshot: after,
        reason: dto.reason,
        reviewId: dto.reviewId,
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'therapy_plan.revised',
          entityType: 'TherapyPlan',
          entityId: id,
          metadata: {
            planCode: plan.code,
            patientCode: plan.patient.code,
            changedFields: changed,
          },
          ipAddress: ip,
        },
        tx,
      );
    });
    return this.get(tenant, id);
  }

  /**
   * Hands the plan to another therapist, e.g. when someone leaves. Earlier progress and
   * reviews keep their authors; only who runs the plan from now on changes.
   */
  async reassign(
    tenant: TenantContext,
    id: string,
    dto: ReassignPlanDto,
    ip: string | null,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const plan = await this.writes.lock(tx, tenant, id, {
        statuses: WORK_STATUSES.reassign,
        doing: 'reassign it',
        revision: dto.revision,
        ownOnly: false,
        permission: 'therapy_plans.reassign',
      });
      if (dto.therapistId === plan.therapistId) {
        throw fieldError(
          'therapistId',
          `${plan.therapist.fullName} is already responsible for this plan.`,
          'SAME_THERAPIST',
        );
      }
      const next = await this.therapist(
        tx,
        tenant,
        dto.therapistId,
        plan.therapyTypeId,
      );
      const updated = await tx.therapyPlan.updateMany({
        where: { id, revision: plan.revision },
        data: {
          therapistId: next.id,
          revision: { increment: 1 },
          updatedById: tenant.userId,
        },
      });
      if (updated.count === 0) throw changedMeanwhile();
      await this.writes.record(tx, tenant, id, {
        event: TherapyPlanEvent.THERAPIST_REASSIGNED,
        changedFields: ['Responsible therapist'],
        previousSnapshot: {
          therapist: {
            id: plan.therapist.id,
            fullName: plan.therapist.fullName,
          },
        },
        newSnapshot: { therapist: { id: next.id, fullName: next.fullName } },
        reason: dto.reason,
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'therapy_plan.reassigned',
          entityType: 'TherapyPlan',
          entityId: id,
          metadata: {
            planCode: plan.code,
            patientCode: plan.patient.code,
            fromTherapistId: plan.therapist.id,
            toTherapistId: next.id,
          },
          ipAddress: ip,
        },
        tx,
      );
    });
    return this.get(tenant, id);
  }
}
