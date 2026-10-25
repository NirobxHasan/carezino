import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { isUniqueViolation } from '../centers/centers.service';
import { apiError } from '../common/errors';
import { nextSequenceValue } from '../common/sequences';
import { Prisma } from '../generated/prisma/client';
import { PackagePeriodUnit } from '../generated/prisma/enums';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreatePackageDto,
  ListPackagesQuery,
  PackageStatusDto,
  UpdatePackageDto,
} from './dto';
import { PACKAGE_LIMITS } from './rules';
import { packageNotFound, packageSelect, toPackage, type Tx } from './shared';

const CODE_PREFIX = 'PKG-';
const UNIT_WORDS: Record<PackagePeriodUnit, string> = {
  DAY: 'days',
  WEEK: 'weeks',
  MONTH: 'months',
};

const codeTaken = () =>
  fieldError(
    'code',
    'Another package already uses this code',
    'PACKAGE_CODE_TAKEN',
  );

/** The fields a package's terms are made of, as stored. */
type Terms = Pick<
  Prisma.TherapyPackageUncheckedCreateInput,
  'validityValue' | 'validityUnit' | 'usageLimitCount' | 'usageLimitPeriod'
>;

/**
 * The package catalog: what the center sells, at what price and on what terms. Edits
 * only ever affect future enrollments, since each enrollment keeps its own copy of the
 * terms; packages someone enrolled in are deactivated, never deleted.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenant: TenantContext, query: ListPackagesQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const status = query.status ?? 'all';
    const search = query.search;
    const where: Prisma.TherapyPackageWhereInput = {
      centerId: tenant.centerId,
      ...(status !== 'all' && { isActive: status === 'ACTIVE' }),
      ...(query.therapyTypeId && {
        therapyTypes: { some: { therapyTypeId: query.therapyTypeId } },
      }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const sortBy = query.sortBy ?? 'displayOrder';
    const order = query.sortOrder ?? (sortBy === 'createdAt' ? 'desc' : 'asc');
    const orderBy: Prisma.TherapyPackageOrderByWithRelationInput[] =
      sortBy === 'displayOrder'
        ? [{ displayOrder: order }, { name: 'asc' }]
        : [{ [sortBy]: order }];
    const [total, rows] = await Promise.all([
      this.prisma.therapyPackage.count({ where }),
      this.prisma.therapyPackage.findMany({
        where,
        select: packageSelect,
        orderBy: [...orderBy, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => toPackage(tenant, r)),
      total,
      page,
      pageSize,
    };
  }

  async get(tenant: TenantContext, id: string) {
    const row = await this.prisma.therapyPackage.findFirst({
      where: { id, centerId: tenant.centerId },
      select: packageSelect,
    });
    if (!row) throw packageNotFound();
    return toPackage(tenant, row);
  }

  /**
   * Therapy types a package may list: the center's own. Newly added ones must be
   * active; ones it already has may stay even if they've since been deactivated.
   */
  private async checkTherapyTypes(
    db: Tx | PrismaService,
    tenant: TenantContext,
    ids: string[],
    keep: string[] = [],
  ) {
    const types = await db.therapyType.findMany({
      where: { id: { in: ids }, centerId: tenant.centerId },
      select: { id: true, name: true, isActive: true },
    });
    if (types.length !== ids.length) {
      throw fieldError(
        'therapyTypeIds',
        'One of these therapies no longer exists. Reload and try again.',
        'THERAPY_TYPE_NOT_FOUND',
      );
    }
    const inactive = types.find((t) => !t.isActive && !keep.includes(t.id));
    if (inactive) {
      throw fieldError(
        'therapyTypeIds',
        `${inactive.name} is inactive. Activate it in Settings to add it to a package.`,
        'THERAPY_TYPE_INACTIVE',
      );
    }
  }

  /** Validity within each unit's limit; a usage limit has both a count and a period. */
  private checkTerms(terms: Terms) {
    const max = PACKAGE_LIMITS.validity[terms.validityUnit];
    if (terms.validityValue > max) {
      throw fieldError(
        'validityValue',
        `Enter up to ${max} ${UNIT_WORDS[terms.validityUnit]}`,
        'VALIDATION_FAILED',
      );
    }
    const count = terms.usageLimitCount ?? null;
    const period = terms.usageLimitPeriod ?? null;
    if ((count === null) !== (period === null)) {
      throw fieldError(
        count === null ? 'usageLimitCount' : 'usageLimitPeriod',
        count === null
          ? 'Enter how many sessions per period'
          : 'Choose the period the limit is per',
        'VALIDATION_FAILED',
      );
    }
  }

  private checkPrice(price: string) {
    if (new Prisma.Decimal(price).gt(PACKAGE_LIMITS.maxPrice)) {
      throw fieldError(
        'price',
        'Enter a price up to 99,999,999.99',
        'VALIDATION_FAILED',
      );
    }
  }

  /** The next free PKG-0001-style code, skipping any a center typed itself. */
  private async generateCode(tx: Tx, centerId: string) {
    for (;;) {
      const n = await nextSequenceValue(tx, centerId, 'package');
      const code = `${CODE_PREFIX}${String(n).padStart(4, '0')}`;
      const taken = await tx.therapyPackage.findFirst({
        where: { centerId, code },
        select: { id: true },
      });
      if (!taken) return code;
    }
  }

  async create(
    tenant: TenantContext,
    dto: CreatePackageDto,
    ip: string | null,
  ) {
    this.checkTerms(dto);
    this.checkPrice(dto.price);
    await this.checkTherapyTypes(this.prisma, tenant, dto.therapyTypeIds);
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const code = dto.code
          ? dto.code.toUpperCase()
          : await this.generateCode(tx, tenant.centerId);
        const row = await tx.therapyPackage.create({
          data: {
            centerId: tenant.centerId,
            code,
            name: dto.name,
            description: dto.description ?? null,
            sessionCount: dto.sessionCount,
            defaultDurationMinutes: dto.defaultDurationMinutes ?? null,
            price: dto.price,
            validityValue: dto.validityValue,
            validityUnit: dto.validityUnit,
            activationPolicy: dto.activationPolicy,
            usageLimitCount: dto.usageLimitCount ?? null,
            usageLimitPeriod: dto.usageLimitPeriod ?? null,
            coversAssessments: dto.coversAssessments,
            chargeNoShow: dto.chargeNoShow,
            chargeLateCancellation: dto.chargeLateCancellation,
            isActive: dto.isActive,
            displayOrder: dto.displayOrder,
            createdById: tenant.userId,
            therapyTypes: {
              createMany: {
                data: dto.therapyTypeIds.map((therapyTypeId) => ({
                  therapyTypeId,
                })),
              },
            },
          },
          select: { id: true, code: true },
        });
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: 'package.created',
            entityType: 'TherapyPackage',
            entityId: row.id,
            metadata: { code: row.code, price: dto.price },
            ipAddress: ip,
          },
          tx,
        );
        return row.id;
      });
      return this.get(tenant, id);
    } catch (error) {
      if (isUniqueViolation(error)) throw codeTaken();
      throw error;
    }
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdatePackageDto,
    ip: string | null,
  ) {
    const current = await this.prisma.therapyPackage.findFirst({
      where: { id, centerId: tenant.centerId },
      select: {
        validityValue: true,
        validityUnit: true,
        usageLimitCount: true,
        usageLimitPeriod: true,
        therapyTypes: { select: { therapyTypeId: true } },
      },
    });
    if (!current) throw packageNotFound();
    const { therapyTypeIds, code, ...fields } = dto;
    this.checkTerms({
      validityValue: dto.validityValue ?? current.validityValue,
      validityUnit: dto.validityUnit ?? current.validityUnit,
      usageLimitCount:
        dto.usageLimitCount !== undefined
          ? dto.usageLimitCount
          : current.usageLimitCount,
      usageLimitPeriod:
        dto.usageLimitPeriod !== undefined
          ? dto.usageLimitPeriod
          : current.usageLimitPeriod,
    });
    if (dto.price !== undefined) this.checkPrice(dto.price);
    const existingTypes = current.therapyTypes.map((t) => t.therapyTypeId);
    if (therapyTypeIds) {
      await this.checkTherapyTypes(
        this.prisma,
        tenant,
        therapyTypeIds,
        existingTypes,
      );
    }
    const data: Prisma.TherapyPackageUncheckedUpdateInput = {
      ...Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      ),
      ...(code !== undefined && { code: code.toUpperCase() }),
    };
    const typesChanged =
      therapyTypeIds !== undefined &&
      (therapyTypeIds.length !== existingTypes.length ||
        therapyTypeIds.some((t) => !existingTypes.includes(t)));
    if (!Object.keys(data).length && !typesChanged) return this.get(tenant, id);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.therapyPackage.update({
          where: { id },
          data: { ...data, updatedById: tenant.userId },
        });
        if (typesChanged) {
          await tx.packageEligibleTherapyType.deleteMany({
            where: { packageId: id, therapyTypeId: { notIn: therapyTypeIds } },
          });
          await tx.packageEligibleTherapyType.createMany({
            data: therapyTypeIds.map((therapyTypeId) => ({
              packageId: id,
              therapyTypeId,
            })),
            skipDuplicates: true,
          });
        }
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: 'package.updated',
            entityType: 'TherapyPackage',
            entityId: id,
            metadata: {
              fields: [
                ...Object.keys(data),
                ...(typesChanged ? ['therapyTypeIds'] : []),
              ],
              ...(dto.price !== undefined && { price: dto.price }),
            },
            ipAddress: ip,
          },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw codeTaken();
      throw error;
    }
    return this.get(tenant, id);
  }

  async setStatus(
    tenant: TenantContext,
    id: string,
    dto: PackageStatusDto,
    ip: string | null,
  ) {
    const current = await this.get(tenant, id);
    if (current.isActive === dto.isActive) return current;
    await this.prisma.$transaction(async (tx) => {
      await tx.therapyPackage.update({
        where: { id },
        data: { isActive: dto.isActive, updatedById: tenant.userId },
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: dto.isActive ? 'package.activated' : 'package.deactivated',
          entityType: 'TherapyPackage',
          entityId: id,
          metadata: { code: current.code },
          ipAddress: ip,
        },
        tx,
      );
    });
    return this.get(tenant, id);
  }

  /** Only packages nobody enrolled in; others are deactivated instead. */
  async remove(tenant: TenantContext, id: string, ip: string | null) {
    const current = await this.get(tenant, id);
    const inUse = () =>
      apiError(
        HttpStatus.CONFLICT,
        'Patients have enrolled in this package, so it’s kept for their history. Deactivate it instead.',
        'PACKAGE_IN_USE',
      );
    if (current.enrollmentCount > 0) throw inUse();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.therapyPackage.delete({ where: { id } });
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: 'package.deleted',
            entityType: 'TherapyPackage',
            entityId: id,
            metadata: { code: current.code },
            ipAddress: ip,
          },
          tx,
        );
      });
    } catch (error) {
      // Someone enrolled in it meanwhile: the foreign key keeps it.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw inUse();
      }
      throw error;
    }
  }

  /** A copy with a new code, inactive so it can be reviewed before it's sold. */
  async duplicate(tenant: TenantContext, id: string, ip: string | null) {
    const source = await this.prisma.therapyPackage.findFirst({
      where: { id, centerId: tenant.centerId },
      include: { therapyTypes: { select: { therapyTypeId: true } } },
    });
    if (!source) throw packageNotFound();
    const newId = await this.prisma.$transaction(async (tx) => {
      const code = await this.generateCode(tx, tenant.centerId);
      const row = await tx.therapyPackage.create({
        data: {
          centerId: tenant.centerId,
          code,
          name: `${source.name} (copy)`.slice(0, PACKAGE_LIMITS.name),
          description: source.description,
          sessionCount: source.sessionCount,
          defaultDurationMinutes: source.defaultDurationMinutes,
          price: source.price,
          validityValue: source.validityValue,
          validityUnit: source.validityUnit,
          activationPolicy: source.activationPolicy,
          usageLimitCount: source.usageLimitCount,
          usageLimitPeriod: source.usageLimitPeriod,
          coversAssessments: source.coversAssessments,
          chargeNoShow: source.chargeNoShow,
          chargeLateCancellation: source.chargeLateCancellation,
          isActive: false,
          displayOrder: source.displayOrder,
          createdById: tenant.userId,
          therapyTypes: {
            createMany: {
              data: source.therapyTypes.map((t) => ({
                therapyTypeId: t.therapyTypeId,
              })),
            },
          },
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'package.duplicated',
          entityType: 'TherapyPackage',
          entityId: row.id,
          metadata: { code, fromCode: source.code, fromId: source.id },
          ipAddress: ip,
        },
        tx,
      );
      return row.id;
    });
    return this.get(tenant, newId);
  }
}
