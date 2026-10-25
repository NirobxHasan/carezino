import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { apiError } from '../common/errors';
import { parseIsoDate } from '../common/time';
import {
  TherapyGoalStatus,
  TherapyPlanEvent,
  TherapyPlanStatus,
} from '../generated/prisma/enums';
import { assertCan } from '../patients/access';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import { goalNotFound, planNotFound, readablePlans } from './access';
import type { AddGoalDto, RecordProgressDto, UpdateGoalDto } from './dto';
import { checkGoal, loadCategories, type GoalFields } from './goal-input';
import { storedConfig, valueError, type Errors } from './measurement';
import { PLAN_LIMITS, WORK_STATUSES, changedGoalLabels } from './rules';
import {
  PlanWrites,
  goalDetails,
  goalSelect,
  invalid,
  iso,
  progressSelect,
  toGoal,
  toProgress,
  type LockedPlan,
  type Tx,
} from './shared';

const needsReason = () =>
  fieldError(
    'reason',
    'Say why the goal is being changed: the plan is active, so the change is kept in its history.',
    'REASON_REQUIRED',
  );

/**
 * Goals and their progress. A draft's goals change freely; once the plan is active a
 * goal is never deleted, and every change to it is kept in the plan's history with a
 * reason. Progress is an append-only list of observations; corrections are new entries.
 * Nothing here decides a goal is achieved: statuses are set by the clinician.
 */
@Injectable()
export class GoalsService {
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
    const rows = await this.prisma.therapyPlanGoal.findMany({
      where: { therapyPlanId: planId },
      select: goalSelect,
      orderBy: { displayOrder: 'asc' },
    });
    return rows.map(toGoal);
  }

  private async goal(planId: string, goalId: string) {
    const row = await this.prisma.therapyPlanGoal.findFirst({
      where: { id: goalId, therapyPlanId: planId },
      select: goalSelect,
    });
    if (!row) throw goalNotFound();
    return toGoal(row);
  }

  /** Goal changes need the plan editable as a draft, or in force with goal rights. */
  private async lockForGoals(tx: Tx, tenant: TenantContext, planId: string) {
    const plan = await this.writes.lock(tx, tenant, planId, {
      statuses: [TherapyPlanStatus.DRAFT, ...WORK_STATUSES.revise],
      doing: 'change its goals',
    });
    assertCan(
      tenant,
      plan.status === TherapyPlanStatus.DRAFT
        ? 'therapy_plans.update'
        : 'therapy_goals.manage',
    );
    return plan;
  }

  /** Drafts' goals change with the plan, so a stale draft editor gets a clean 409. */
  private async touchDraft(tx: Tx, tenant: TenantContext, plan: LockedPlan) {
    if (plan.status !== TherapyPlanStatus.DRAFT) return;
    await tx.therapyPlan.update({
      where: { id: plan.id },
      data: { revision: { increment: 1 }, updatedById: tenant.userId },
    });
  }

  async add(
    tenant: TenantContext,
    planId: string,
    dto: AddGoalDto,
    ip: string | null,
  ) {
    const goalId = await this.prisma.$transaction(async (tx) => {
      const plan = await this.lockForGoals(tx, tenant, planId);
      const active = plan.status !== TherapyPlanStatus.DRAFT;
      if (active && !dto.reason) throw needsReason();
      const count = await tx.therapyPlanGoal.count({
        where: { therapyPlanId: planId },
      });
      if (count >= PLAN_LIMITS.goals) {
        throw apiError(
          HttpStatus.CONFLICT,
          `A plan can have up to ${PLAN_LIMITS.goals} goals. Discontinue or combine some first.`,
          'GOAL_LIMIT',
        );
      }
      if (dto.sourceAssessmentGoalId && !plan.sourceAssessmentId) {
        throw fieldError(
          'sourceAssessmentGoalId',
          'This plan isn’t based on an assessment.',
          'VALIDATION_FAILED',
        );
      }
      if (dto.sourceAssessmentGoalId) {
        const found = await tx.assessmentGoal.findFirst({
          where: {
            id: dto.sourceAssessmentGoalId,
            assessmentId: plan.sourceAssessmentId!,
          },
          select: { id: true },
        });
        if (!found) {
          throw fieldError(
            'sourceAssessmentGoalId',
            'This goal isn’t in the source assessment anymore.',
            'VALIDATION_FAILED',
          );
        }
      }
      const categories = await loadCategories(tx, tenant.centerId, [
        dto.categoryId,
      ]);
      const checked = checkGoal(dto, {
        therapyTypeId: plan.therapyTypeId,
        categories,
      });
      if (Object.keys(checked.errors).length) throw invalid(checked.errors);
      const last = await tx.therapyPlanGoal.aggregate({
        where: { therapyPlanId: planId },
        _max: { displayOrder: true },
      });
      const created = await tx.therapyPlanGoal.create({
        data: {
          ...checked.data,
          centerId: tenant.centerId,
          therapyPlanId: planId,
          sourceAssessmentGoalId: dto.sourceAssessmentGoalId ?? null,
          displayOrder: (last._max.displayOrder ?? -1) + 1,
          createdById: tenant.userId,
        },
        select: { id: true },
      });
      await this.touchDraft(tx, tenant, plan);
      if (active) {
        await this.writes.record(tx, tenant, planId, {
          event: TherapyPlanEvent.GOAL_ADDED,
          changedFields: ['Goals'],
          newSnapshot: goalDetails({
            ...checked.data,
            measurementConfig: checked.config,
            status: TherapyGoalStatus.NOT_STARTED,
          }),
          reason: dto.reason,
          goalId: created.id,
        });
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: 'therapy_goal.added',
            entityType: 'TherapyPlanGoal',
            entityId: created.id,
            metadata: { planCode: plan.code, patientCode: plan.patient.code },
            ipAddress: ip,
          },
          tx,
        );
      }
      return created.id;
    });
    return this.goal(planId, goalId);
  }

  /**
   * Changes a goal. On a draft: anything but the status (draft goals haven't started).
   * Once active: a status change alone needs goal or progress rights and an optional
   * reason; anything else needs goal rights and a reason. A goal with recorded progress
   * keeps its measurement, so earlier values keep their meaning.
   */
  async update(
    tenant: TenantContext,
    planId: string,
    goalId: string,
    dto: UpdateGoalDto,
    ip: string | null,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const plan = await this.writes.lock(tx, tenant, planId, {
        statuses: [TherapyPlanStatus.DRAFT, ...WORK_STATUSES.revise],
        doing: 'change its goals',
      });
      const current = await tx.therapyPlanGoal.findFirst({
        where: { id: goalId, therapyPlanId: planId },
        select: {
          id: true,
          title: true,
          description: true,
          categoryId: true,
          priority: true,
          measurementType: true,
          measurementConfig: true,
          baselineText: true,
          baselineValue: true,
          targetText: true,
          targetValue: true,
          targetDate: true,
          status: true,
          notes: true,
          _count: { select: { progress: true } },
        },
      });
      if (!current) throw goalNotFound();
      const draft = plan.status === TherapyPlanStatus.DRAFT;
      const { status, reason, ...content } = dto;
      const contentKeys = Object.entries(content).filter(
        ([, v]) => v !== undefined,
      );
      if (draft) {
        assertCan(tenant, 'therapy_plans.update');
        if (status !== undefined && status !== current.status) {
          throw fieldError(
            'status',
            'Goals start once the plan is active.',
            'PLAN_STATUS',
          );
        }
      } else if (contentKeys.length) {
        assertCan(tenant, 'therapy_goals.manage');
      } else if (
        !tenant.permissions.includes('therapy_goals.manage') &&
        !tenant.permissions.includes('therapy_goals.record_progress')
      ) {
        assertCan(tenant, 'therapy_goals.manage');
      }

      const merged: GoalFields = {
        title: content.title ?? current.title,
        description:
          content.description !== undefined
            ? content.description
            : current.description,
        categoryId:
          content.categoryId !== undefined
            ? content.categoryId
            : current.categoryId,
        priority:
          content.priority !== undefined ? content.priority : current.priority,
        measurementType: content.measurementType ?? current.measurementType,
        measurementConfig:
          content.measurementConfig !== undefined
            ? content.measurementConfig
            : storedConfig(current.measurementConfig),
        baselineText:
          content.baselineText !== undefined
            ? content.baselineText
            : current.baselineText,
        baselineValue:
          content.baselineValue !== undefined
            ? content.baselineValue
            : current.baselineValue,
        targetText:
          content.targetText !== undefined
            ? content.targetText
            : current.targetText,
        targetValue:
          content.targetValue !== undefined
            ? content.targetValue
            : current.targetValue,
        targetDate:
          content.targetDate !== undefined
            ? content.targetDate
            : iso(current.targetDate),
        notes: content.notes !== undefined ? content.notes : current.notes,
      };
      const categories = await loadCategories(tx, tenant.centerId, [
        merged.categoryId,
      ]);
      const checked = checkGoal(merged, {
        therapyTypeId: plan.therapyTypeId,
        categories,
        keepCategoryId: current.categoryId,
      });
      if (Object.keys(checked.errors).length) throw invalid(checked.errors);

      const before = goalDetails({
        ...current,
        measurementConfig: storedConfig(current.measurementConfig),
      });
      const nextStatus = status ?? current.status;
      const after = goalDetails({
        ...checked.data,
        measurementConfig: checked.config,
        status: nextStatus,
      });
      const changed = changedGoalLabels(before, after);
      if (!changed.length) return;
      if (current._count.progress > 0 && changed.includes('Measurement')) {
        throw apiError(
          HttpStatus.CONFLICT,
          'Progress has been recorded against this goal, so its measurement can’t change. Add a new goal instead.',
          'GOAL_HAS_PROGRESS',
          { measurementType: 'Can’t change once progress is recorded' },
        );
      }
      const statusOnly = changed.length === 1 && changed[0] === 'Status';
      if (!draft && !statusOnly && !reason) throw needsReason();

      const statusChanged = nextStatus !== current.status;
      await tx.therapyPlanGoal.update({
        where: { id: goalId },
        data: {
          ...checked.data,
          status: nextStatus,
          ...(statusChanged && {
            statusChangedAt: new Date(),
            statusChangedById: tenant.userId,
          }),
        },
      });
      await this.touchDraft(tx, tenant, plan);
      if (!draft) {
        await this.writes.record(tx, tenant, planId, {
          event: TherapyPlanEvent.GOAL_UPDATED,
          changedFields: changed,
          previousSnapshot: before,
          newSnapshot: after,
          reason: reason ?? null,
          goalId,
        });
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: 'therapy_goal.updated',
            entityType: 'TherapyPlanGoal',
            entityId: goalId,
            metadata: {
              planCode: plan.code,
              patientCode: plan.patient.code,
              changedFields: changed,
              ...(statusChanged && { from: current.status, to: nextStatus }),
            },
            ipAddress: ip,
          },
          tx,
        );
      }
    });
    return this.goal(planId, goalId);
  }

  /** Drafts only: an active plan's goals are discontinued instead (and the database insists). */
  async remove(tenant: TenantContext, planId: string, goalId: string) {
    await this.prisma.$transaction(async (tx) => {
      const plan = await this.writes.lock(tx, tenant, planId, {
        statuses: WORK_STATUSES.editDraft,
        doing: 'delete goals; discontinue the goal instead',
        permission: 'therapy_plans.update',
      });
      const removed = await tx.therapyPlanGoal.deleteMany({
        where: { id: goalId, therapyPlanId: planId },
      });
      if (removed.count === 0) throw goalNotFound();
      await this.touchDraft(tx, tenant, plan);
    });
  }

  // ── Progress ──────────────────────────────────────────────────────────────

  /**
   * Records an observation of a goal of an active plan. The value is checked against
   * the goal's measurement; a status given here is the clinician's judgement and also
   * becomes the goal's status. A correction replaces an earlier entry (kept, marked as
   * corrected) and needs a reason.
   */
  async recordProgress(
    tenant: TenantContext,
    planId: string,
    goalId: string,
    dto: RecordProgressDto,
    ip: string | null,
  ) {
    const { today } = await this.writes.center(tenant);
    const entryId = await this.prisma.$transaction(async (tx) => {
      const plan = await this.writes.lock(tx, tenant, planId, {
        statuses: WORK_STATUSES.recordProgress,
        doing: 'record progress',
        permission: 'therapy_goals.record_progress',
      });
      const goal = await tx.therapyPlanGoal.findFirst({
        where: { id: goalId, therapyPlanId: planId },
        select: {
          id: true,
          status: true,
          measurementType: true,
          measurementConfig: true,
        },
      });
      if (!goal) throw goalNotFound();
      if (goal.status === TherapyGoalStatus.DISCONTINUED && !dto.correctsId) {
        throw apiError(
          HttpStatus.CONFLICT,
          'This goal is discontinued. Change its status first to record progress again.',
          'GOAL_DISCONTINUED',
        );
      }

      const errors: Errors = {};
      const date = parseIsoDate(dto.observationDate);
      if (!date) errors.observationDate = 'Choose a valid date';
      else if (date > today) {
        errors.observationDate = 'Observations can’t be in the future';
      } else if (date < plan.startDate) {
        errors.observationDate =
          'Observations can’t be before the plan started';
      }
      const valueProblem = valueError(
        goal.measurementType,
        storedConfig(goal.measurementConfig),
        dto.measuredValue,
      );
      if (valueProblem) errors.measuredValue = valueProblem;
      if (
        (dto.measuredValue === undefined || dto.measuredValue === null) &&
        !dto.observation &&
        !dto.goalStatus
      ) {
        errors.observation = 'Record a value, an observation or a status';
      }
      if (dto.correctsId) {
        if (!dto.correctionReason) {
          errors.correctionReason = 'Say why the entry is being corrected';
        }
        const original = await tx.therapyGoalProgress.findFirst({
          where: { id: dto.correctsId, goalId },
          select: { id: true, correctedBy: { select: { id: true } } },
        });
        if (!original) {
          errors.correctsId = 'That entry belongs to another goal';
        } else if (original.correctedBy) {
          throw apiError(
            HttpStatus.CONFLICT,
            'That entry has already been corrected. Correct the latest version instead.',
            'PROGRESS_ALREADY_CORRECTED',
          );
        }
      } else if (dto.correctionReason) {
        errors.correctionReason = 'Only corrections take a reason';
      }
      if (Object.keys(errors).length) throw invalid(errors);

      const entry = await tx.therapyGoalProgress.create({
        data: {
          centerId: tenant.centerId,
          therapyPlanId: planId,
          goalId,
          observationDate: date!,
          goalStatus: dto.goalStatus ?? null,
          measuredValue: dto.measuredValue ?? null,
          observation: dto.observation ?? null,
          correctsId: dto.correctsId ?? null,
          correctionReason: dto.correctsId ? dto.correctionReason! : null,
          recordedById: tenant.userId,
        },
        select: { id: true },
      });
      if (dto.goalStatus && dto.goalStatus !== goal.status) {
        await tx.therapyPlanGoal.update({
          where: { id: goalId },
          data: {
            status: dto.goalStatus,
            statusChangedAt: new Date(),
            statusChangedById: tenant.userId,
          },
        });
      }
      if (dto.correctsId) {
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: 'therapy_goal.progress_corrected',
            entityType: 'TherapyGoalProgress',
            entityId: entry.id,
            metadata: {
              planCode: plan.code,
              goalId,
              correctsId: dto.correctsId,
            },
            ipAddress: ip,
          },
          tx,
        );
      }
      return entry.id;
    });
    const [entry, goal] = await Promise.all([
      this.prisma.therapyGoalProgress.findUniqueOrThrow({
        where: { id: entryId },
        select: progressSelect,
      }),
      this.goal(planId, goalId),
    ]);
    return { entry: toProgress(entry), goal };
  }

  /** A goal's observations in the order they happened, corrections included. */
  async goalProgress(tenant: TenantContext, planId: string, goalId: string) {
    await this.readable(tenant, planId);
    const goal = await this.goal(planId, goalId);
    const rows = await this.prisma.therapyGoalProgress.findMany({
      where: { goalId, therapyPlanId: planId },
      select: progressSelect,
      orderBy: [{ observationDate: 'asc' }, { createdAt: 'asc' }],
      take: 1000,
    });
    return { goal, items: rows.map(toProgress) };
  }

  /** Every observation of the plan's goals, in the order they happened. */
  async planProgress(tenant: TenantContext, planId: string) {
    await this.readable(tenant, planId);
    const rows = await this.prisma.therapyGoalProgress.findMany({
      where: { therapyPlanId: planId },
      select: progressSelect,
      orderBy: [{ observationDate: 'asc' }, { createdAt: 'asc' }],
      take: 2000,
    });
    return { items: rows.map(toProgress) };
  }
}
