import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { LIMITS } from '../center-settings/limits';
import { apiError } from '../common/errors';
import {
  addDays,
  formatClock,
  formatIsoDate,
  instantToZoned,
  parseClock,
  parseIsoDate,
  zonedToInstant,
} from '../common/time';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { findVisibleTherapist, lockTherapist } from './access';
import {
  THERAPIST_APPOINTMENTS,
  type TherapistAppointments,
} from './appointments.port';
import type {
  CreateTimeOffDto,
  ListTimeOffQuery,
  UpdateTimeOffDto,
} from './dto';

type Tx = Prisma.TransactionClient;

const timeOffSelect = {
  id: true,
  startAt: true,
  endAt: true,
  isAllDay: true,
  reason: true,
  note: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TherapistTimeOffSelect;

type TimeOffRow = Prisma.TherapistTimeOffGetPayload<{
  select: typeof timeOffSelect;
}>;

/**
 * The stored instants as the center's wall clock. All-day entries end at midnight, so
 * their last day is the day before endAt.
 */
function toTimeOff(row: TimeOffRow, timeZone: string, now: Date) {
  const start = instantToZoned(row.startAt, timeZone);
  const end = instantToZoned(row.endAt, timeZone);
  const lastDay =
    row.isAllDay && end.minutes === 0 ? addDays(end.date, -1) : end.date;
  return {
    ...row,
    startDate: formatIsoDate(start.date),
    endDate: formatIsoDate(lastDay),
    startTime: row.isAllDay ? null : formatClock(start.minutes),
    endTime: row.isAllDay ? null : formatClock(end.minutes),
    state:
      row.endAt <= now
        ? ('past' as const)
        : row.startAt > now
          ? ('upcoming' as const)
          : ('ongoing' as const),
  };
}

const notFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Time off not found', 'NOT_FOUND');

interface RangeFields {
  startDate: string;
  endDate: string;
  isAllDay: boolean;
  startTime: string | null;
  endTime: string | null;
}

/** Turns wall-clock input into a half-open [startAt, endAt). Errors use the request's paths. */
function toRange(fields: RangeFields, timeZone: string) {
  const errors: Record<string, string> = {};
  const startDate = parseIsoDate(fields.startDate);
  const endDate = parseIsoDate(fields.endDate);
  if (!startDate) errors.startDate = 'Choose a valid date';
  if (!endDate) errors.endDate = 'Choose a valid date';
  let startMinutes = 0;
  let endMinutes = 1440;
  if (!fields.isAllDay) {
    const s = fields.startTime ? parseClock(fields.startTime) : null;
    const e = fields.endTime ? parseClock(fields.endTime) : null;
    if (s === null) errors.startTime = 'Choose a start time';
    if (e === null) errors.endTime = 'Choose an end time';
    startMinutes = s ?? 0;
    endMinutes = e ?? 0;
  }
  let startAt: Date | null = null;
  let endAt: Date | null = null;
  if (startDate && endDate && !Object.keys(errors).length) {
    startAt = zonedToInstant(startDate, startMinutes, timeZone);
    endAt = zonedToInstant(endDate, endMinutes, timeZone);
    const days = (endAt.getTime() - startAt.getTime()) / 86_400_000;
    if (endDate < startDate) {
      errors.endDate = 'The end date can’t be before the start date';
    } else if (endAt <= startAt) {
      errors.endTime = 'The end must be after the start';
    } else if (days > LIMITS.timeOffDays) {
      errors.endDate = `Time off can last up to ${LIMITS.timeOffDays} days. Add another entry for longer.`;
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
  return { startAt: startAt!, endAt: endAt! };
}

/**
 * Dates and periods a therapist is away: exceptions to their weekly availability. Saving
 * time off never cancels or moves bookings; once appointments exist, overlapping ones
 * are reported back so staff can resolve them through the booking workflow.
 */
@Injectable()
export class TimeOffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(THERAPIST_APPOINTMENTS)
    private readonly appointments: TherapistAppointments,
  ) {}

  private async timezone(tenant: TenantContext) {
    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: { timezone: true },
    });
    return center.timezone;
  }

  async list(
    tenant: TenantContext,
    therapistId: string,
    query: ListTimeOffQuery,
  ) {
    await findVisibleTherapist(this.prisma, tenant, therapistId);
    const timeZone = await this.timezone(tenant);
    const now = new Date();
    const past = query.period === 'past';
    const rows = await this.prisma.therapistTimeOff.findMany({
      where: {
        therapistId,
        centerId: tenant.centerId,
        endAt: past ? { lte: now } : { gt: now },
      },
      select: timeOffSelect,
      // Soonest first when looking ahead; most recent first when looking back.
      orderBy: past ? [{ startAt: 'desc' }] : [{ startAt: 'asc' }],
    });
    return rows.map((row) => toTimeOff(row, timeZone, now));
  }

  /** Other time off of the same therapist can't overlap: one entry per absence. */
  private async assertNoOverlap(
    tx: Tx,
    therapistId: string,
    range: { startAt: Date; endAt: Date },
    exceptId?: string,
  ) {
    const clash = await tx.therapistTimeOff.findFirst({
      where: {
        therapistId,
        startAt: { lt: range.endAt },
        endAt: { gt: range.startAt },
        ...(exceptId && { id: { not: exceptId } }),
      },
      select: { id: true },
    });
    if (clash) {
      const message = 'This overlaps other time off. Edit that entry instead.';
      throw apiError(HttpStatus.CONFLICT, message, 'TIME_OFF_OVERLAP', {
        startDate: message,
      });
    }
  }

  private record(
    tx: Tx,
    tenant: TenantContext,
    action: string,
    therapist: { id: string; fullName: string },
    row: TimeOffRow,
    ipAddress: string | null,
  ) {
    return this.audit.record(
      {
        centerId: tenant.centerId,
        actorUserId: tenant.userId,
        action,
        entityType: 'TherapistTimeOff',
        entityId: row.id,
        metadata: {
          therapistId: therapist.id,
          therapist: therapist.fullName,
          startAt: row.startAt.toISOString(),
          endAt: row.endAt.toISOString(),
          // The note may hold health details, so it stays out of the audit log.
          reason: row.reason,
        },
        ipAddress,
      },
      tx,
    );
  }

  /** The saved entry plus bookings it overlaps (null: no appointment module to ask yet). */
  private async withConflicts(
    tenant: TenantContext,
    therapistId: string,
    row: TimeOffRow,
    timeZone: string,
  ) {
    const conflicts = await this.appointments.overlapping(
      tenant.centerId,
      therapistId,
      row.startAt,
      row.endAt,
    );
    return {
      timeOff: toTimeOff(row, timeZone, new Date()),
      conflictingAppointments: conflicts,
    };
  }

  async create(
    tenant: TenantContext,
    therapistId: string,
    dto: CreateTimeOffDto,
    ipAddress: string | null,
  ) {
    const timeZone = await this.timezone(tenant);
    const isAllDay = dto.isAllDay ?? true;
    const range = toRange(
      {
        startDate: dto.startDate,
        endDate: dto.endDate,
        isAllDay,
        startTime: dto.startTime ?? null,
        endTime: dto.endTime ?? null,
      },
      timeZone,
    );
    const row = await this.prisma.$transaction(async (tx) => {
      const therapist = await findVisibleTherapist(tx, tenant, therapistId);
      await lockTherapist(tx, therapistId);
      await this.assertNoOverlap(tx, therapistId, range);
      const created = await tx.therapistTimeOff.create({
        data: {
          centerId: tenant.centerId,
          therapistId,
          ...range,
          isAllDay,
          reason: dto.reason ?? null,
          note: dto.note ?? null,
        },
        select: timeOffSelect,
      });
      await this.record(
        tx,
        tenant,
        'therapist.time_off_added',
        therapist,
        created,
        ipAddress,
      );
      return created;
    });
    return this.withConflicts(tenant, therapistId, row, timeZone);
  }

  private async find(
    tx: Tx,
    tenant: TenantContext,
    therapistId: string,
    id: string,
  ) {
    const row = await tx.therapistTimeOff.findFirst({
      where: { id, therapistId, centerId: tenant.centerId },
      select: timeOffSelect,
    });
    if (!row) throw notFound();
    return row;
  }

  /** Partial update; the date and time rules are checked against the merged result. */
  async update(
    tenant: TenantContext,
    therapistId: string,
    id: string,
    dto: UpdateTimeOffDto,
    ipAddress: string | null,
  ) {
    const timeZone = await this.timezone(tenant);
    const row = await this.prisma.$transaction(async (tx) => {
      const therapist = await findVisibleTherapist(tx, tenant, therapistId);
      await lockTherapist(tx, therapistId);
      const before = toTimeOff(
        await this.find(tx, tenant, therapistId, id),
        timeZone,
        new Date(),
      );
      const isAllDay = dto.isAllDay ?? before.isAllDay;
      const range = toRange(
        {
          startDate: dto.startDate ?? before.startDate,
          endDate: dto.endDate ?? before.endDate,
          isAllDay,
          startTime:
            dto.startTime !== undefined ? dto.startTime : before.startTime,
          endTime: dto.endTime !== undefined ? dto.endTime : before.endTime,
        },
        timeZone,
      );
      await this.assertNoOverlap(tx, therapistId, range, id);
      const updated = await tx.therapistTimeOff.update({
        where: { id },
        data: {
          ...range,
          isAllDay,
          ...(dto.reason !== undefined && { reason: dto.reason }),
          ...(dto.note !== undefined && { note: dto.note }),
        },
        select: timeOffSelect,
      });
      await this.record(
        tx,
        tenant,
        'therapist.time_off_updated',
        therapist,
        updated,
        ipAddress,
      );
      return updated;
    });
    return this.withConflicts(tenant, therapistId, row, timeZone);
  }

  async remove(
    tenant: TenantContext,
    therapistId: string,
    id: string,
    ipAddress: string | null,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const therapist = await findVisibleTherapist(tx, tenant, therapistId);
      const row = await this.find(tx, tenant, therapistId, id);
      await tx.therapistTimeOff.delete({ where: { id } });
      await this.record(
        tx,
        tenant,
        'therapist.time_off_removed',
        therapist,
        row,
        ipAddress,
      );
    });
  }
}
