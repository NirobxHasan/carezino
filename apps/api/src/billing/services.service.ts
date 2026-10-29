import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import type { Prisma } from '../generated/prisma/client';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateServiceDto,
  ListServicesQuery,
  ServiceStatusDto,
  UpdateServiceDto,
} from './dto';
import { can, isUniqueViolation, money, notFound, type Db } from './shared';

export const serviceSelect = {
  id: true,
  code: true,
  name: true,
  category: true,
  price: true,
  defaultDurationMinutes: true,
  description: true,
  isActive: true,
  displayOrder: true,
  createdAt: true,
  updatedAt: true,
  therapyType: {
    select: { id: true, name: true, code: true, color: true, isActive: true },
  },
  _count: { select: { items: true } },
} satisfies Prisma.BillableServiceSelect;

type ServiceRow = Prisma.BillableServiceGetPayload<{
  select: typeof serviceSelect;
}>;

function toService(tenant: TenantContext, row: ServiceRow) {
  const { _count, price, ...rest } = row;
  const manage = can(tenant, 'billing_services.manage');
  return {
    ...rest,
    price: money(price),
    /** Invoice lines that used it; their prices never change with the service's */
    usageCount: _count.items,
    actions: {
      edit: manage,
      activate: manage && !row.isActive,
      deactivate: manage && row.isActive,
    },
  };
}

const codeTaken = () =>
  fieldError('code', 'Another service already uses this code', 'CODE_TAKEN');

/**
 * The center's priced services: assessments, sessions and anything else it charges
 * for, optionally per therapy type. Invoice lines copy the name and price they used,
 * so editing or deactivating a service never changes issued invoices. Packages are
 * priced by their own catalog and enrollments, not here.
 */
@Injectable()
export class BillableServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenant: TenantContext, query: ListServicesQuery) {
    const status = query.status ?? 'all';
    const rows = await this.prisma.billableService.findMany({
      where: {
        centerId: tenant.centerId,
        ...(status !== 'all' && { isActive: status === 'ACTIVE' }),
        ...(query.category && { category: query.category }),
        ...(query.therapyTypeId && {
          OR: [{ therapyTypeId: query.therapyTypeId }, { therapyTypeId: null }],
        }),
        ...(query.search && {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
          ],
        }),
      },
      select: serviceSelect,
      orderBy: [{ category: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
    });
    return { items: rows.map((r) => toService(tenant, r)) };
  }

  async get(tenant: TenantContext, id: string) {
    const row = await this.prisma.billableService.findFirst({
      where: { id, centerId: tenant.centerId },
      select: serviceSelect,
    });
    if (!row) throw notFound('Service');
    return toService(tenant, row);
  }

  private async therapyType(
    db: Db,
    tenant: TenantContext,
    id: string | null | undefined,
  ) {
    if (!id) return;
    const type = await db.therapyType.findFirst({
      where: { id, centerId: tenant.centerId },
      select: { isActive: true, name: true },
    });
    if (!type) {
      throw fieldError(
        'therapyTypeId',
        'Choose one of the center’s therapies',
        'THERAPY_TYPE_NOT_FOUND',
      );
    }
    if (!type.isActive) {
      throw fieldError(
        'therapyTypeId',
        `${type.name} is inactive. Choose another therapy.`,
        'THERAPY_TYPE_INACTIVE',
      );
    }
  }

  async create(
    tenant: TenantContext,
    dto: CreateServiceDto,
    ip: string | null,
  ) {
    await this.therapyType(this.prisma, tenant, dto.therapyTypeId);
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const row = await tx.billableService.create({
          data: {
            ...dto,
            centerId: tenant.centerId,
            code: dto.code.toUpperCase(),
            therapyTypeId: dto.therapyTypeId ?? null,
            createdById: tenant.userId,
          },
          select: { id: true, code: true, price: true },
        });
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: 'billing_service.created',
            entityType: 'BillableService',
            entityId: row.id,
            metadata: { code: row.code, price: money(row.price) },
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

  /** Future invoice lines only: issued ones keep the price they were made with. */
  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateServiceDto,
    ip: string | null,
  ) {
    const before = await this.prisma.billableService.findFirst({
      where: { id, centerId: tenant.centerId },
      select: { code: true, price: true, therapyTypeId: true },
    });
    if (!before) throw notFound('Service');
    if (dto.therapyTypeId && dto.therapyTypeId !== before.therapyTypeId) {
      await this.therapyType(this.prisma, tenant, dto.therapyTypeId);
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const row = await tx.billableService.update({
          where: { id },
          data: {
            ...dto,
            ...(dto.code && { code: dto.code.toUpperCase() }),
            updatedById: tenant.userId,
          },
          select: { code: true, price: true },
        });
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: 'billing_service.updated',
            entityType: 'BillableService',
            entityId: id,
            metadata: {
              code: row.code,
              fields: Object.keys(dto),
              ...(!row.price.equals(before.price) && {
                price: { from: money(before.price), to: money(row.price) },
              }),
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
    dto: ServiceStatusDto,
    ip: string | null,
  ) {
    const before = await this.prisma.billableService.findFirst({
      where: { id, centerId: tenant.centerId },
      select: { code: true, isActive: true },
    });
    if (!before) throw notFound('Service');
    if (before.isActive !== dto.isActive) {
      await this.prisma.$transaction(async (tx) => {
        await tx.billableService.update({
          where: { id },
          data: { isActive: dto.isActive, updatedById: tenant.userId },
        });
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: dto.isActive
              ? 'billing_service.activated'
              : 'billing_service.deactivated',
            entityType: 'BillableService',
            entityId: id,
            metadata: { code: before.code },
            ipAddress: ip,
          },
          tx,
        );
      });
    }
    return this.get(tenant, id);
  }
}
