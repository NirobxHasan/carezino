import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { apiError } from '../common/errors';
import { formatIsoDate, parseIsoDate } from '../common/time';
import type { Prisma } from '../generated/prisma/client';
import type {
  ReviewOverallProgress,
  ReviewRecommendation,
} from '../generated/prisma/enums';
import { assertCan } from '../patients/access';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import { isOwn, planNotFound, readablePlans, reviewNotFound } from './access';
import type { AmendReviewDto, CreateReviewDto } from './dto';
import type { Errors } from './measurement';
import { WORK_STATUSES, describeFrequency } from './rules';
import {
  PlanWrites,
  goalSelect,
  invalid,
  iso,
  reviewItemSelect,
  toGoal,
  toReviewItem,
  userSelect,
} from './shared';

const reviewDetailSelect = {
  ...reviewItemSelect,
  therapyPlanId: true,
  observations: true,
  goalSummary: true,
  notes: true,
  goalSnapshot: true,
  planSnapshot: true,
  amendments: {
    select: {
      number: true,
      reason: true,
      changedFields: true,
      previousContent: true,
      amendedAt: true,
      amendedBy: userSelect,
    },
    orderBy: { number: 'asc' },
  },
} satisfies Prisma.TherapyPlanReviewSelect;

type ReviewDetailRow = Prisma.TherapyPlanReviewGetPayload<{
  select: typeof reviewDetailSelect;
}>;

/** What a reviewer wrote, as stored and as kept in an amendment's previousContent. */
interface ReviewContent {
  reviewDate: string;
  overallProgress: ReviewOverallProgress;
  recommendation: ReviewRecommendation;
  observations: string | null;
  goalSummary: string | null;
  notes: string | null;
  nextReviewDate: string | null;
}

const CONTENT_LABELS: Record<keyof ReviewContent, string> = {
  reviewDate: 'Review date',
  overallProgress: 'Overall progress',
  recommendation: 'Recommendation',
  observations: 'Clinical observations',
  goalSummary: 'Goal review summary',
  notes: 'Additional notes',
  nextReviewDate: 'Next review date',
};

const contentOf = (row: ReviewDetailRow): ReviewContent => ({
  reviewDate: formatIsoDate(row.reviewDate),
  overallProgress: row.overallProgress,
  recommendation: row.recommendation,
  observations: row.observations,
  goalSummary: row.goalSummary,
  notes: row.notes,
  nextReviewDate: iso(row.nextReviewDate),
});

/**
 * Periodic clinical reviews. A review is confirmed when it's saved and records the
 * goals as they stood; its recommendation changes nothing by itself: pausing,
 * revising or completing the plan are separate, explicit actions. Corrections keep the
 * earlier version (TherapyPlanReviewAmendment).
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly writes: PlanWrites,
  ) {}

  private async readable(tenant: TenantContext, planId: string) {
    const plan = await this.prisma.therapyPlan.findFirst({
      where: { id: planId, ...readablePlans(tenant) },
      select: { id: true },
    });
    if (!plan) throw planNotFound();
  }

  async list(tenant: TenantContext, planId: string) {
    await this.readable(tenant, planId);
    const rows = await this.prisma.therapyPlanReview.findMany({
      where: { therapyPlanId: planId },
      select: reviewItemSelect,
      orderBy: { number: 'desc' },
    });
    return rows.map((r) => toReviewItem(tenant, r));
  }

  private toDetail(tenant: TenantContext, row: ReviewDetailRow) {
    return {
      ...toReviewItem(tenant, row),
      therapyPlanId: row.therapyPlanId,
      observations: row.observations,
      goalSummary: row.goalSummary,
      notes: row.notes,
      goalSnapshot: row.goalSnapshot,
      planSnapshot: row.planSnapshot,
      amendments: row.amendments,
      actions: {
        amend:
          isOwn(tenant, row.therapist) &&
          tenant.permissions.includes('therapy_plans.review'),
      },
    };
  }

  async get(tenant: TenantContext, planId: string, reviewId: string) {
    await this.readable(tenant, planId);
    const row = await this.prisma.therapyPlanReview.findFirst({
      where: { id: reviewId, therapyPlanId: planId },
      select: reviewDetailSelect,
    });
    if (!row) throw reviewNotFound();
    return this.toDetail(tenant, row);
  }

  private checkDates(
    content: Pick<ReviewContent, 'reviewDate' | 'nextReviewDate'>,
    ctx: { today: Date; startDate: Date },
    errors: Errors,
  ) {
    const date = parseIsoDate(content.reviewDate);
    if (!date) errors.reviewDate = 'Choose a valid date';
    else if (date > ctx.today)
      errors.reviewDate = 'A review can’t be in the future';
    else if (date < ctx.startDate) {
      errors.reviewDate = 'A review can’t be before the plan started';
    }
    const next = content.nextReviewDate
      ? parseIsoDate(content.nextReviewDate)
      : null;
    if (content.nextReviewDate && !next) {
      errors.nextReviewDate = 'Choose a valid date';
    } else if (next && date && next <= date) {
      errors.nextReviewDate = 'The next review must be after this one';
    }
    return { date, next };
  }

  /**
   * Records a review by the responsible therapist of a plan in force. The goals'
   * statuses, baselines, targets and latest progress are snapshotted with it, and its
   * next review date becomes the plan's. Nothing else about the plan changes.
   */
  async create(
    tenant: TenantContext,
    planId: string,
    dto: CreateReviewDto,
    ip: string | null,
  ) {
    const { today } = await this.writes.center(tenant);
    const id = await this.prisma.$transaction(async (tx) => {
      const plan = await this.writes.lock(tx, tenant, planId, {
        statuses: WORK_STATUSES.review,
        doing: 'review it',
        permission: 'therapy_plans.review',
      });
      const errors: Errors = {};
      const { date, next } = this.checkDates(
        {
          reviewDate: dto.reviewDate,
          nextReviewDate: dto.nextReviewDate ?? null,
        },
        { today, startDate: plan.startDate },
        errors,
      );
      if (Object.keys(errors).length) throw invalid(errors);

      const goals = await tx.therapyPlanGoal.findMany({
        where: { therapyPlanId: planId },
        select: goalSelect,
        orderBy: { displayOrder: 'asc' },
      });
      const goalSnapshot = goals.map(toGoal).map((g) => ({
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
        latestProgress: g.latestProgress && {
          observationDate: g.latestProgress.observationDate,
          measuredValue: g.latestProgress.measuredValue,
          goalStatus: g.latestProgress.goalStatus,
          observation: g.latestProgress.observation,
        },
        progressCount: g.progressCount,
      }));
      const planSnapshot = {
        status: plan.status,
        sessionsPerPeriod: plan.sessionsPerPeriod,
        frequencyUnit: plan.frequencyUnit,
        frequency: describeFrequency(
          plan.sessionsPerPeriod,
          plan.frequencyUnit,
        ),
        durationMinutes: plan.durationMinutes,
        nextReviewDate: iso(plan.nextReviewDate),
        targetEndDate: iso(plan.targetEndDate),
      };
      const last = await tx.therapyPlanReview.aggregate({
        where: { therapyPlanId: planId },
        _max: { number: true },
      });
      const number = (last._max.number ?? 0) + 1;
      const created = await tx.therapyPlanReview.create({
        data: {
          centerId: tenant.centerId,
          therapyPlanId: planId,
          number,
          reviewDate: date!,
          therapistId: plan.therapistId,
          reviewedById: tenant.userId,
          overallProgress: dto.overallProgress,
          recommendation: dto.recommendation,
          observations: dto.observations ?? null,
          goalSummary: dto.goalSummary ?? null,
          notes: dto.notes ?? null,
          nextReviewDate: next,
          goalSnapshot: goalSnapshot as unknown as Prisma.InputJsonValue,
          planSnapshot,
        },
        select: { id: true },
      });
      if (next) {
        await tx.therapyPlan.update({
          where: { id: planId },
          data: {
            nextReviewDate: next,
            revision: { increment: 1 },
            updatedById: tenant.userId,
          },
        });
      }
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'therapy_plan.reviewed',
          entityType: 'TherapyPlanReview',
          entityId: created.id,
          metadata: {
            planCode: plan.code,
            patientCode: plan.patient.code,
            review: number,
            recommendation: dto.recommendation,
          },
          ipAddress: ip,
        },
        tx,
      );
      return created.id;
    });
    return this.get(tenant, planId, id);
  }

  /**
   * Corrects a review, by the therapist who gave it. The review before the correction
   * is kept with who, when, why and what changed (labels only). Correcting the next
   * review date here doesn't move the plan's; revise the plan for that.
   */
  async amend(
    tenant: TenantContext,
    planId: string,
    reviewId: string,
    dto: AmendReviewDto,
    ip: string | null,
  ) {
    assertCan(tenant, 'therapy_plans.review');
    const { today } = await this.writes.center(tenant);
    await this.readable(tenant, planId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "TherapyPlanReview"
        WHERE id = ${reviewId}::uuid AND "therapyPlanId" = ${planId}::uuid
        FOR UPDATE`;
      const row = await tx.therapyPlanReview.findFirst({
        where: { id: reviewId, therapyPlanId: planId },
        select: {
          ...reviewDetailSelect,
          therapyPlan: { select: { code: true, startDate: true } },
        },
      });
      if (!row) throw reviewNotFound();
      if (!isOwn(tenant, row.therapist)) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          `Only ${row.therapist.fullName}, who gave this review, can correct it.`,
          'NOT_REVIEWER',
        );
      }
      const before = contentOf(row);
      const after: ReviewContent = {
        reviewDate: dto.reviewDate ?? before.reviewDate,
        overallProgress: dto.overallProgress ?? before.overallProgress,
        recommendation: dto.recommendation ?? before.recommendation,
        observations:
          dto.observations !== undefined
            ? dto.observations
            : before.observations,
        goalSummary:
          dto.goalSummary !== undefined ? dto.goalSummary : before.goalSummary,
        notes: dto.notes !== undefined ? dto.notes : before.notes,
        nextReviewDate:
          dto.nextReviewDate !== undefined
            ? dto.nextReviewDate
            : before.nextReviewDate,
      };
      const errors: Errors = {};
      const { date, next } = this.checkDates(
        after,
        { today, startDate: row.therapyPlan.startDate },
        errors,
      );
      if (Object.keys(errors).length) throw invalid(errors);
      const changed = (Object.keys(CONTENT_LABELS) as (keyof ReviewContent)[])
        .filter((k) => before[k] !== after[k])
        .map((k) => CONTENT_LABELS[k]);
      if (!changed.length) {
        throw fieldError(
          'reason',
          'Nothing has changed. Make the correction, then save it.',
          'NOTHING_CHANGED',
        );
      }
      await tx.therapyPlanReview.update({
        where: { id: reviewId },
        data: {
          reviewDate: date!,
          overallProgress: after.overallProgress,
          recommendation: after.recommendation,
          observations: after.observations,
          goalSummary: after.goalSummary,
          notes: after.notes,
          nextReviewDate: next,
        },
      });
      const number = row.amendments.length + 1;
      await tx.therapyPlanReviewAmendment.create({
        data: {
          centerId: tenant.centerId,
          reviewId,
          number,
          reason: dto.reason,
          changedFields: changed,
          previousContent: before as unknown as Prisma.InputJsonValue,
          amendedById: tenant.userId,
        },
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'therapy_plan_review.amended',
          entityType: 'TherapyPlanReview',
          entityId: reviewId,
          metadata: {
            planCode: row.therapyPlan.code,
            amendment: number,
            changedFields: changed,
          },
          ipAddress: ip,
        },
        tx,
      );
    });
    return this.get(tenant, planId, reviewId);
  }
}
