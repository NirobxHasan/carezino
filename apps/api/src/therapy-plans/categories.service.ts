import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { isUniqueViolation } from '../centers/centers.service';
import { apiError } from '../common/errors';
import { lockCenter } from '../common/locks';
import type { Prisma } from '../generated/prisma/client';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import { categoryNotFound } from './access';
import type {
  CategoryStatusDto,
  CreateCategoryDto,
  ListCategoriesQuery,
  UpdateCategoryDto,
} from './dto';
import { PLAN_LIMITS } from './rules';
import type { Tx } from './shared';

const categorySelect = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  displayOrder: true,
  createdAt: true,
  updatedAt: true,
  therapyType: {
    select: { id: true, name: true, code: true, color: true, isActive: true },
  },
  _count: { select: { goals: true } },
} satisfies Prisma.TherapyGoalCategorySelect;

type CategoryRow = Prisma.TherapyGoalCategoryGetPayload<{
  select: typeof categorySelect;
}>;

const toCategory = ({ _count, ...row }: CategoryRow) => ({
  ...row,
  /** Goals using it; a used category can be deactivated but never deleted */
  goalCount: _count.goals,
});

const nameTaken = () =>
  apiError(
    HttpStatus.CONFLICT,
    'A category with this name already exists for this therapy.',
    'CATEGORY_NAME_TAKEN',
    { name: 'Already used for this therapy' },
  );

/**
 * The center's goal categories: a short, optional list per therapy (or for all), never
 * a taxonomy. Categories are deactivated rather than deleted, so goals that use them
 * keep showing them.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenant: TenantContext, query: ListCategoriesQuery) {
    const status = query.status ?? 'ACTIVE';
    const rows = await this.prisma.therapyGoalCategory.findMany({
      where: {
        centerId: tenant.centerId,
        ...(status !== 'all' && { isActive: status === 'ACTIVE' }),
        ...(query.therapyTypeId && {
          OR: [{ therapyTypeId: null }, { therapyTypeId: query.therapyTypeId }],
        }),
      },
      select: categorySelect,
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toCategory);
  }

  private async therapyType(tx: Tx, tenant: TenantContext, id: string) {
    const type = await tx.therapyType.findFirst({
      where: { id, centerId: tenant.centerId },
      select: { id: true },
    });
    if (!type) {
      throw fieldError(
        'therapyTypeId',
        'This therapy no longer exists.',
        'THERAPY_TYPE_NOT_FOUND',
      );
    }
  }

  private async write<T>(fn: (tx: Tx) => Promise<T>) {
    try {
      return await this.prisma.$transaction(fn);
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  async create(
    tenant: TenantContext,
    dto: CreateCategoryDto,
    ip: string | null,
  ) {
    const row = await this.write(async (tx) => {
      await lockCenter(tx, tenant.centerId);
      const count = await tx.therapyGoalCategory.count({
        where: { centerId: tenant.centerId },
      });
      if (count >= PLAN_LIMITS.categoriesPerCenter) {
        throw apiError(
          HttpStatus.CONFLICT,
          `A center can have up to ${PLAN_LIMITS.categoriesPerCenter} goal categories.`,
          'CATEGORY_LIMIT',
        );
      }
      if (dto.therapyTypeId)
        await this.therapyType(tx, tenant, dto.therapyTypeId);
      const last = await tx.therapyGoalCategory.aggregate({
        where: { centerId: tenant.centerId },
        _max: { displayOrder: true },
      });
      const created = await tx.therapyGoalCategory.create({
        data: {
          centerId: tenant.centerId,
          name: dto.name,
          description: dto.description ?? null,
          therapyTypeId: dto.therapyTypeId ?? null,
          displayOrder: dto.displayOrder ?? (last._max.displayOrder ?? -1) + 1,
        },
        select: categorySelect,
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'therapy_goal_category.created',
          entityType: 'TherapyGoalCategory',
          entityId: created.id,
          metadata: {
            name: created.name,
            therapyTypeId: dto.therapyTypeId ?? null,
          },
          ipAddress: ip,
        },
        tx,
      );
      return created;
    });
    return toCategory(row);
  }

  /**
   * Renaming or moving a category to another therapy. Goals already using it keep it;
   * moving it only affects which plans can choose it from now on.
   */
  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateCategoryDto,
    ip: string | null,
  ) {
    const row = await this.write(async (tx) => {
      const current = await tx.therapyGoalCategory.findFirst({
        where: { id, centerId: tenant.centerId },
        select: { id: true, name: true, therapyTypeId: true },
      });
      if (!current) throw categoryNotFound();
      if (dto.therapyTypeId)
        await this.therapyType(tx, tenant, dto.therapyTypeId);
      const updated = await tx.therapyGoalCategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          ...(dto.therapyTypeId !== undefined && {
            therapyTypeId: dto.therapyTypeId,
          }),
          ...(dto.displayOrder !== undefined && {
            displayOrder: dto.displayOrder,
          }),
        },
        select: categorySelect,
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'therapy_goal_category.updated',
          entityType: 'TherapyGoalCategory',
          entityId: id,
          metadata: {
            changedFields: Object.keys(dto).filter(
              (k) => dto[k as keyof UpdateCategoryDto] !== undefined,
            ),
          },
          ipAddress: ip,
        },
        tx,
      );
      return updated;
    });
    return toCategory(row);
  }

  async setStatus(
    tenant: TenantContext,
    id: string,
    dto: CategoryStatusDto,
    ip: string | null,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.therapyGoalCategory.findFirst({
        where: { id, centerId: tenant.centerId },
        select: { id: true },
      });
      if (!current) throw categoryNotFound();
      const updated = await tx.therapyGoalCategory.update({
        where: { id },
        data: { isActive: dto.isActive },
        select: categorySelect,
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: dto.isActive
            ? 'therapy_goal_category.activated'
            : 'therapy_goal_category.deactivated',
          entityType: 'TherapyGoalCategory',
          entityId: id,
          ipAddress: ip,
        },
        tx,
      );
      return updated;
    });
    return toCategory(row);
  }
}
