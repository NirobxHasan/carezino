import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import { LIMITS } from '../center-settings/limits';
import { SettingsService } from '../center-settings/settings.service';
import { apiError } from '../common/errors';
import {
  addDays,
  daysInclusive,
  formatClock,
  formatIsoDate,
  instantToZoned,
  parseIsoDate,
  zonedToInstant,
} from '../common/time';
import { TherapistStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { therapistNotFound, visibleTherapists } from './access';
import {
  THERAPIST_APPOINTMENTS,
  type TherapistAppointments,
} from './appointments.port';
import { centerHoursByDay } from './availability.service';
import {
  DAY_MINUTES,
  unavailableReasons,
  workingWindows,
  type DayFacts,
  type Interval,
  type UnavailableReason,
} from './schedule';

const toClock = (i: Interval) => ({
  start: formatClock(i.start),
  end: formatClock(i.end),
});

/**
 * Therapist schedules computed on demand from regular availability, center hours,
 * closures and time off. Nothing here is stored as slots, and nothing here books.
 *
 * "Available" means the therapist is working then, not that the time is free: the
 * overview lists booked appointments alongside, and free slots come from the
 * appointments module, which applies bookings, buffers and policies on top of facts().
 */
@Injectable()
export class ScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(THERAPIST_APPOINTMENTS)
    private readonly appointments: TherapistAppointments,
  ) {}

  /**
   * Everything the rules need for each date from `first` to `last` (UTC-midnight dates,
   * center-local). Booking builds on this, so slots and schedules always agree.
   */
  async facts(
    tenant: TenantContext,
    therapistId: string,
    first: Date,
    last: Date,
  ) {
    const therapist = await this.prisma.therapist.findFirst({
      where: { id: therapistId, ...visibleTherapists(tenant) },
      select: {
        id: true,
        code: true,
        fullName: true,
        status: true,
        availability: {
          where: { isActive: true },
          select: { dayOfWeek: true, startMinutes: true, endMinutes: true },
        },
        specializations: {
          select: {
            therapyTypeId: true,
            therapyType: { select: { isActive: true } },
          },
        },
      },
    });
    if (!therapist) throw therapistNotFound();

    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: { timezone: true },
    });
    const timeZone = center.timezone;
    const rangeStart = zonedToInstant(first, 0, timeZone);
    const rangeEnd = zonedToInstant(last, DAY_MINUTES, timeZone);
    const [hours, closures, timeOff, scheduling] = await Promise.all([
      centerHoursByDay(this.prisma, tenant.centerId),
      this.prisma.centerClosure.findMany({
        where: {
          centerId: tenant.centerId,
          isActive: true,
          startDate: { lte: last },
          endDate: { gte: first },
        },
        select: {
          id: true,
          title: true,
          startDate: true,
          endDate: true,
          allDay: true,
          startMinutes: true,
          endMinutes: true,
        },
      }),
      this.prisma.therapistTimeOff.findMany({
        where: {
          therapistId,
          centerId: tenant.centerId,
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
        },
        select: {
          id: true,
          startAt: true,
          endAt: true,
          isAllDay: true,
          reason: true,
        },
        orderBy: { startAt: 'asc' },
      }),
      this.settings.getScheduling(tenant),
    ]);

    const days = Array.from({ length: daysInclusive(first, last) }, (_, i) => {
      const date = addDays(first, i);
      const dayOfWeek = date.getUTCDay();
      const dayStart = zonedToInstant(date, 0, timeZone);
      const dayEnd = zonedToInstant(date, DAY_MINUTES, timeZone);
      const dayClosures = closures
        .filter((c) => c.startDate <= date && c.endDate >= date)
        .map((c) => ({
          ...c,
          interval: c.allDay
            ? { start: 0, end: DAY_MINUTES }
            : { start: c.startMinutes ?? 0, end: c.endMinutes ?? DAY_MINUTES },
        }));
      // Time off clipped to this day, in the center's minutes.
      const dayTimeOff = timeOff
        .filter((t) => t.startAt < dayEnd && t.endAt > dayStart)
        .map((t) => ({
          ...t,
          interval: {
            start:
              t.startAt <= dayStart
                ? 0
                : instantToZoned(t.startAt, timeZone).minutes,
            end:
              t.endAt >= dayEnd
                ? DAY_MINUTES
                : instantToZoned(t.endAt, timeZone).minutes,
          },
        }));
      const facts: DayFacts = {
        therapistActive: therapist.status === TherapistStatus.ACTIVE,
        regular: therapist.availability
          .filter((a) => a.dayOfWeek === dayOfWeek)
          .map((a) => ({ start: a.startMinutes, end: a.endMinutes })),
        centerHours: hours.byDay[dayOfWeek],
        closures: dayClosures.map((c) => c.interval),
        timeOff: dayTimeOff.map((t) => t.interval),
        allowOnClosedDays: scheduling.allowBookingOnClosedDays,
      };
      return {
        date,
        dayOfWeek,
        dayStart,
        dayEnd,
        facts,
        dayClosures,
        dayTimeOff,
      };
    });
    return { therapist, timeZone, rangeStart, rangeEnd, days };
  }

  private parseRange(startDate: string, endDate: string) {
    const first = parseIsoDate(startDate);
    const last = parseIsoDate(endDate);
    const errors: Record<string, string> = {};
    if (!first) errors.startDate = 'Choose a valid date';
    if (!last) errors.endDate = 'Choose a valid date';
    if (first && last && last < first) {
      errors.endDate = 'The end date can’t be before the start date';
    } else if (
      first &&
      last &&
      daysInclusive(first, last) > LIMITS.scheduleDays
    ) {
      errors.endDate = `Show up to ${LIMITS.scheduleDays} days at a time`;
    }
    if (Object.keys(errors).length) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        Object.values(errors)[0],
        'VALIDATION_FAILED',
        errors,
      );
    }
    return { first: first!, last: last! };
  }

  /** Day-by-day overview for the schedule screen. */
  async overview(
    tenant: TenantContext,
    therapistId: string,
    startDate: string,
    endDate: string,
  ) {
    const { first, last } = this.parseRange(startDate, endDate);
    const { therapist, timeZone, rangeStart, rangeEnd, days } =
      await this.facts(tenant, therapistId, first, last);
    const booked = await this.appointments.overlapping(
      tenant.centerId,
      therapistId,
      rangeStart,
      rangeEnd,
    );
    return {
      therapist: {
        id: therapist.id,
        code: therapist.code,
        fullName: therapist.fullName,
        status: therapist.status,
      },
      timezone: timeZone,
      startDate: formatIsoDate(first),
      endDate: formatIsoDate(last),
      /** False until an appointment module is installed; then days list bookings too */
      appointmentsIncluded: booked !== null,
      days: days.map((d) => ({
        date: formatIsoDate(d.date),
        dayOfWeek: d.dayOfWeek,
        /** Center opening hours; empty on a weekly closed day */
        centerHours: d.facts.centerHours.map(toClock),
        closures: d.dayClosures.map((c) => ({
          id: c.id,
          title: c.title,
          allDay: c.allDay,
          ...toClock(c.interval),
        })),
        /** The therapist's regular weekly hours for this weekday */
        regularHours: d.facts.regular.map(toClock),
        timeOff: d.dayTimeOff.map((t) => ({
          id: t.id,
          reason: t.reason,
          isAllDay: t.isAllDay,
          ...toClock(t.interval),
        })),
        /** When the therapist is working: regular hours after every exception. Not free slots. */
        available: workingWindows(d.facts).map(toClock),
        appointments:
          booked === null
            ? null
            : booked
                .filter((a) => a.startAt < d.dayEnd && a.endAt > d.dayStart)
                .map((a) => ({
                  ...a,
                  startAt: a.startAt.toISOString(),
                  endAt: a.endAt.toISOString(),
                  // Clipped to this day in the center's minutes, like time off.
                  ...toClock({
                    start:
                      a.startAt <= d.dayStart
                        ? 0
                        : instantToZoned(a.startAt, timeZone).minutes,
                    end:
                      a.endAt >= d.dayEnd
                        ? DAY_MINUTES
                        : instantToZoned(a.endAt, timeZone).minutes,
                  }),
                })),
      })),
    };
  }

  /**
   * Whether the therapist is working for the whole of [startAt, endAt). Checks status,
   * specialization, regular hours, center hours, closures and time off, but NOT existing
   * appointments, buffers, notice or other booking policies (appointmentsChecked: false).
   * Booking uses the appointments module's rules (appointments/rules.ts) instead.
   */
  async checkPeriod(
    tenant: TenantContext,
    input: {
      therapistId: string;
      startAt: Date;
      endAt: Date;
      therapyTypeId?: string;
    },
  ): Promise<{
    available: boolean;
    reasons: (UnavailableReason | 'INVALID_PERIOD')[];
    appointmentsChecked: false;
  }> {
    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: { timezone: true },
    });
    const start = instantToZoned(input.startAt, center.timezone);
    const end = instantToZoned(input.endAt, center.timezone);
    // Same-day periods only, like availability itself; ending at midnight is allowed.
    const endMinutes =
      end.date.getTime() === addDays(start.date, 1).getTime() &&
      end.minutes === 0
        ? DAY_MINUTES
        : end.date.getTime() === start.date.getTime()
          ? end.minutes
          : -1;
    if (input.endAt <= input.startAt || endMinutes < 0) {
      return {
        available: false,
        reasons: ['INVALID_PERIOD'],
        appointmentsChecked: false,
      };
    }
    const { therapist, days } = await this.facts(
      tenant,
      input.therapistId,
      start.date,
      start.date,
    );
    const reasons: (UnavailableReason | 'INVALID_PERIOD')[] =
      unavailableReasons(days[0].facts, start.minutes, endMinutes);
    if (
      input.therapyTypeId &&
      !therapist.specializations.some(
        (s) =>
          s.therapyTypeId === input.therapyTypeId && s.therapyType.isActive,
      )
    ) {
      reasons.push('NOT_SPECIALIZED');
    }
    return {
      available: reasons.length === 0,
      reasons,
      appointmentsChecked: false,
    };
  }
}
