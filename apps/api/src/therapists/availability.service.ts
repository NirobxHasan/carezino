import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { toWeek, validateWeek } from '../center-settings/working-hours';
import { apiError } from '../common/errors';
import { formatClock } from '../common/time';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { findVisibleTherapist, lockTherapist } from './access';
import type { AvailabilityDayDto } from './dto';
import { covers, type Interval } from './schedule';

type Tx = Prisma.TransactionClient;

export interface AvailabilityRow {
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
  isActive: boolean;
}

/** Weekly hours at a glance, for lists: working days and total time per week. */
export function summarizeAvailability(
  rows: Pick<AvailabilityRow, 'dayOfWeek' | 'startMinutes' | 'endMinutes'>[],
) {
  const days = [...new Set(rows.map((r) => r.dayOfWeek))].sort();
  const weeklyMinutes = rows.reduce(
    (sum, r) => sum + r.endMinutes - r.startMinutes,
    0,
  );
  return { daysOfWeek: days, weeklyMinutes };
}

/**
 * Checks a full week from the editor and turns it into rows. Same interval rules as the
 * center's opening hours (start before end, no overlaps, same day only); a day switched
 * off keeps its intervals as inactive rows. Errors use the request's field paths.
 */
export function validateAvailability(
  days: AvailabilityDayDto[],
  pathPrefix = '',
) {
  const { rows, errors } = validateWeek(days, {
    endBeforeStart: 'End time must be after start time',
  });
  if (Object.keys(errors).length) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'Please check the highlighted hours',
      'VALIDATION_FAILED',
      Object.fromEntries(
        Object.entries(errors).map(([path, message]) => [
          `${pathPrefix}${path}`,
          message,
        ]),
      ),
    );
  }
  const available = new Map(days.map((d) => [d.dayOfWeek, d.isAvailable]));
  return rows.map((row) => ({
    ...row,
    isActive: available.get(row.dayOfWeek) ?? false,
  }));
}

/** Center opening hours per weekday, 0 = Sunday. */
export async function centerHoursByDay(tx: Tx, centerId: string) {
  const rows = await tx.centerWorkingHour.findMany({
    where: { centerId },
    select: { dayOfWeek: true, startMinutes: true, endMinutes: true },
  });
  const byDay: Interval[][] = Array.from({ length: 7 }, () => []);
  for (const r of rows) {
    byDay[r.dayOfWeek].push({ start: r.startMinutes, end: r.endMinutes });
  }
  return { rows, byDay };
}

/**
 * A therapist's regular weekly hours: when they normally work at this center, kept apart
 * from time off (exceptions) and from bookings. Changing them never moves an existing
 * booking. Times are in the center's time zone.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Sequential on purpose: a transaction is one connection, which can't run queries in parallel. */
  private async read(tx: Tx, centerId: string, therapistId: string) {
    const center = await tx.center.findUniqueOrThrow({
      where: { id: centerId },
      select: { timezone: true },
    });
    const rows = await tx.therapistAvailability.findMany({
      where: { therapistId, centerId },
      select: {
        dayOfWeek: true,
        startMinutes: true,
        endMinutes: true,
        isActive: true,
      },
      orderBy: [{ dayOfWeek: 'asc' }, { startMinutes: 'asc' }],
    });
    const hours = await centerHoursByDay(tx, centerId);
    const active = rows.filter((r) => r.isActive);
    return {
      timezone: center.timezone,
      /** Sunday first. Intervals outside the center's opening hours are flagged, not refused. */
      days: Array.from({ length: 7 }, (_, dayOfWeek) => {
        const ofDay = rows.filter((r) => r.dayOfWeek === dayOfWeek);
        return {
          dayOfWeek,
          isAvailable: ofDay.some((r) => r.isActive),
          intervals: ofDay.map((r) => ({
            start: formatClock(r.startMinutes),
            end: formatClock(r.endMinutes),
            outsideCenterHours: !covers(
              hours.byDay[dayOfWeek],
              r.startMinutes,
              r.endMinutes,
            ),
          })),
        };
      }),
      centerHours: toWeek(hours.rows),
      summary: summarizeAvailability(active),
    };
  }

  async get(tenant: TenantContext, therapistId: string) {
    await findVisibleTherapist(this.prisma, tenant, therapistId);
    return this.read(this.prisma, tenant.centerId, therapistId);
  }

  /** Replaces the whole week in one transaction. */
  async replace(
    tenant: TenantContext,
    therapistId: string,
    days: AvailabilityDayDto[],
    ipAddress: string | null,
  ) {
    const rows = validateAvailability(days);
    return this.prisma.$transaction(async (tx) => {
      const therapist = await findVisibleTherapist(tx, tenant, therapistId);
      await lockTherapist(tx, therapistId);
      const before = await this.read(tx, tenant.centerId, therapistId);
      await this.write(tx, tenant.centerId, therapistId, rows);
      const after = await this.read(tx, tenant.centerId, therapistId);
      const plain = (week: typeof before) =>
        week.days.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          isAvailable: d.isAvailable,
          intervals: d.intervals.map(({ start, end }) => ({ start, end })),
        }));
      if (JSON.stringify(plain(before)) !== JSON.stringify(plain(after))) {
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: 'therapist.availability_updated',
            entityType: 'Therapist',
            entityId: therapistId,
            metadata: {
              therapist: therapist.fullName,
              from: plain(before),
              to: plain(after),
            },
            ipAddress,
          },
          tx,
        );
      }
      return after;
    });
  }

  /** Replaces the stored rows; callers validate and lock first. */
  async write(
    tx: Tx,
    centerId: string,
    therapistId: string,
    rows: AvailabilityRow[],
  ) {
    await tx.therapistAvailability.deleteMany({
      where: { therapistId, centerId },
    });
    await tx.therapistAvailability.createMany({
      data: rows.map((row) => ({ ...row, centerId, therapistId })),
    });
  }
}
