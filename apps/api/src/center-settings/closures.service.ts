import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { apiError } from '../common/errors';
import {
  daysInclusive,
  formatClock,
  formatIsoDate,
  parseClock,
  parseIsoDate,
  todayIn,
} from '../common/time';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateClosureDto,
  ListClosuresQuery,
  UpdateClosureDto,
} from './dto';
import { LIMITS } from './limits';

const closureSelect = {
  id: true,
  title: true,
  startDate: true,
  endDate: true,
  reason: true,
  allDay: true,
  startMinutes: true,
  endMinutes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CenterClosureSelect;

type ClosureRow = Prisma.CenterClosureGetPayload<{
  select: typeof closureSelect;
}>;

/** Where the closure stands relative to the center's today. */
function stateOf(row: ClosureRow, today: Date) {
  if (row.endDate < today) return 'past' as const;
  if (row.startDate > today) return 'upcoming' as const;
  return 'ongoing' as const;
}

function toClosure(row: ClosureRow, today: Date) {
  const { startMinutes, endMinutes, ...rest } = row;
  const state = stateOf(row, today);
  return {
    ...rest,
    startDate: formatIsoDate(row.startDate),
    endDate: formatIsoDate(row.endDate),
    startTime: startMinutes === null ? null : formatClock(startMinutes),
    endTime: endMinutes === null ? null : formatClock(endMinutes),
    days: daysInclusive(row.startDate, row.endDate),
    state,
    /** Only closures that never took effect can be deleted */
    canDelete: state === 'upcoming' || !row.isActive,
  };
}

const notFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Closure not found', 'NOT_FOUND');

interface ClosureFields {
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
}

/** Cross-field rules for a closure's dates and times. Errors use the request's paths. */
function validateSchedule(fields: ClosureFields) {
  const errors: Record<string, string> = {};
  const start = parseIsoDate(fields.startDate);
  const end = parseIsoDate(fields.endDate);
  if (!start) errors.startDate = 'Choose a valid date';
  if (!end) errors.endDate = 'Choose a valid date';
  let startMinutes: number | null = null;
  let endMinutes: number | null = null;

  if (start && end) {
    if (end < start) {
      errors.endDate = 'The end date can’t be before the start date';
    } else if (daysInclusive(start, end) > LIMITS.closureDays) {
      errors.endDate = `A closure can last up to ${LIMITS.closureDays} days`;
    } else if (!fields.allDay && end.getTime() !== start.getTime()) {
      errors.endDate =
        'A part-day closure covers one date. Make it all-day to span several days.';
    }
  }
  if (!fields.allDay) {
    startMinutes = fields.startTime ? parseClock(fields.startTime) : null;
    endMinutes = fields.endTime ? parseClock(fields.endTime) : null;
    if (startMinutes === null)
      errors.startTime = 'Choose when the closure starts';
    if (endMinutes === null) errors.endTime = 'Choose when the closure ends';
    if (
      startMinutes !== null &&
      endMinutes !== null &&
      startMinutes >= endMinutes
    ) {
      errors.endTime = 'The end time must be after the start time';
    }
  }
  if (Object.keys(errors).length) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'Please check the highlighted fields',
      'VALIDATION_FAILED',
      errors,
    );
  }
  return { startDate: start!, endDate: end!, startMinutes, endMinutes };
}

/**
 * Holidays and other closures. This module only records them; future booking logic
 * reads active closures to block availability. Existing bookings are never changed here.
 */
@Injectable()
export class ClosuresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async today(tenant: TenantContext) {
    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: { timezone: true },
    });
    return todayIn(center.timezone);
  }

  async list(tenant: TenantContext, query: ListClosuresQuery) {
    const today = await this.today(tenant);
    const rows = await this.prisma.centerClosure.findMany({
      where: {
        centerId: tenant.centerId,
        ...(query.period === 'upcoming' && { endDate: { gte: today } }),
        ...(query.period === 'past' && { endDate: { lt: today } }),
      },
      select: closureSelect,
      // Soonest first when looking ahead; most recent first when looking back.
      orderBy:
        query.period === 'past'
          ? [{ startDate: 'desc' }, { endDate: 'desc' }]
          : [{ startDate: 'asc' }, { endDate: 'asc' }],
    });
    return rows.map((row) => toClosure(row, today));
  }

  private async find(tenant: TenantContext, id: string) {
    const row = await this.prisma.centerClosure.findFirst({
      where: { id, centerId: tenant.centerId },
      select: closureSelect,
    });
    if (!row) throw notFound();
    return row;
  }

  async get(tenant: TenantContext, id: string) {
    return toClosure(await this.find(tenant, id), await this.today(tenant));
  }

  private record(
    tx: Prisma.TransactionClient,
    tenant: TenantContext,
    action: string,
    row: ClosureRow,
    ipAddress: string | null,
  ) {
    return this.audit.record(
      {
        centerId: tenant.centerId,
        actorUserId: tenant.userId,
        action,
        entityType: 'CenterClosure',
        entityId: row.id,
        metadata: {
          title: row.title,
          startDate: formatIsoDate(row.startDate),
          endDate: formatIsoDate(row.endDate),
        },
        ipAddress,
      },
      tx,
    );
  }

  async create(
    tenant: TenantContext,
    dto: CreateClosureDto,
    ipAddress: string | null,
  ) {
    const allDay = dto.allDay ?? true;
    const schedule = validateSchedule({
      startDate: dto.startDate,
      endDate: dto.endDate,
      allDay,
      startTime: dto.startTime ?? null,
      endTime: dto.endTime ?? null,
    });
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.centerClosure.create({
        data: {
          centerId: tenant.centerId,
          title: dto.title,
          reason: dto.reason ?? null,
          allDay,
          isActive: dto.isActive ?? true,
          ...schedule,
        },
        select: closureSelect,
      });
      await this.record(tx, tenant, 'closure.created', created, ipAddress);
      return created;
    });
    return toClosure(row, await this.today(tenant));
  }

  /** Partial update; date and time rules are checked against the merged result. */
  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateClosureDto,
    ipAddress: string | null,
  ) {
    const before = await this.find(tenant, id);
    const allDay = dto.allDay ?? before.allDay;
    const schedule = validateSchedule({
      startDate: dto.startDate ?? formatIsoDate(before.startDate),
      endDate: dto.endDate ?? formatIsoDate(before.endDate),
      allDay,
      startTime:
        dto.startTime !== undefined
          ? dto.startTime
          : before.startMinutes === null
            ? null
            : formatClock(before.startMinutes),
      endTime:
        dto.endTime !== undefined
          ? dto.endTime
          : before.endMinutes === null
            ? null
            : formatClock(before.endMinutes),
    });
    const row = await this.prisma.$transaction(async (tx) => {
      // Scoped by center in the write itself, not just the read above.
      const { count } = await tx.centerClosure.updateMany({
        where: { id, centerId: tenant.centerId },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.reason !== undefined && { reason: dto.reason }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          allDay,
          ...schedule,
        },
      });
      if (!count) throw notFound();
      const updated = await tx.centerClosure.findUniqueOrThrow({
        where: { id },
        select: closureSelect,
      });
      await this.record(tx, tenant, 'closure.updated', updated, ipAddress);
      return updated;
    });
    return toClosure(row, await this.today(tenant));
  }

  /**
   * Deletes a closure that never took effect: one that hasn't started, or an inactive
   * one. Past and ongoing active closures are kept as a record of when the center was
   * shut; deactivate them instead.
   */
  async remove(tenant: TenantContext, id: string, ipAddress: string | null) {
    const row = await this.find(tenant, id);
    if (!toClosure(row, await this.today(tenant)).canDelete) {
      throw apiError(
        HttpStatus.CONFLICT,
        'This closure has already started, so it’s kept as a record. Deactivate it if it no longer applies.',
        'CLOSURE_STARTED',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.centerClosure.deleteMany({
        where: { id, centerId: tenant.centerId },
      });
      if (!count) throw notFound();
      await this.record(tx, tenant, 'closure.deleted', row, ipAddress);
    });
  }
}
