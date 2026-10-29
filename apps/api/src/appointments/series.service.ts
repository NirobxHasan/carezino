import { HttpStatus, Injectable } from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import { BillingEvents } from '../billing/events.service';
import { LIMITS } from '../center-settings/limits';
import { apiError } from '../common/errors';
import {
  addDays,
  formatIsoDate,
  instantToZoned,
  parseClock,
  zonedToInstant,
} from '../common/time';
import type { Prisma } from '../generated/prisma/client';
import {
  AppointmentHistoryAction,
  AppointmentSeriesStatus,
  AppointmentStatus,
  AppointmentType,
} from '../generated/prisma/enums';
import { PackageSessions } from '../packages/sessions.service';
import { assertCan } from '../patients/access';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import { lockTherapist } from '../therapists/access';
import { seriesNotFound, visibleAppointments, visibleSeries } from './access';
import {
  assertLateCancellation,
  itemSelect,
  localTimes,
  lockPatient,
  recordHistory,
  toItem,
  type View,
} from './appointments.service';
import {
  BookingService,
  overlapViolation,
  slotTaken,
  type Names,
  type Policy,
} from './booking.service';
import type { CancelSeriesDto, CreateSeriesDto, SeriesDto } from './dto';
import { expandRecurrence, type Recurrence } from './recurrence';
import {
  OPEN_STATUSES,
  evaluate,
  isLateCancellation,
  type BookingContext,
  type Conflict,
} from './rules';

type Tx = Prisma.TransactionClient;

/** One date a recurring booking produced, with whatever stops it being booked. */
interface Occurrence {
  date: Date;
  startAt: Date;
  endAt: Date;
  adjusted: boolean;
  conflicts: Conflict[];
}

/**
 * Recurring bookings. The rule is expanded up front into a bounded list of dates, every
 * date is checked like a single booking, and the bookable ones become ordinary
 * appointments sharing a series. By default it's all or nothing: any conflict rejects the
 * whole booking and lists every problem date. With skipConflicts the free dates are
 * booked and the others recorded on the series as skipped, and returned, never silently
 * dropped. Changing one occurrence later never touches the others.
 */
@Injectable()
export class SeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly booking: BookingService,
    private readonly packages: PackageSessions,
    private readonly billing: BillingEvents,
  ) {}

  /** The rule as dates, rejecting rules that would book too much or nothing. */
  private recurrence(dto: SeriesDto): Recurrence {
    const r = dto.recurrence;
    const startDate = this.booking.date(r.startDate, 'recurrence.startDate');
    const until =
      r.endType === 'UNTIL'
        ? this.booking.date(r.until!, 'recurrence.until')
        : null;
    if (until && until < startDate) {
      throw fieldError(
        'recurrence.until',
        'The end date can’t be before the start date',
        'VALIDATION_FAILED',
      );
    }
    if (until && until > addDays(startDate, LIMITS.seriesSpanDays)) {
      throw fieldError(
        'recurrence.until',
        `A recurring booking can cover up to ${LIMITS.seriesSpanDays} days. Book another series for later dates.`,
        'VALIDATION_FAILED',
      );
    }
    return {
      frequency: r.frequency,
      interval: r.interval,
      daysOfWeek:
        r.frequency === 'WEEKLY' ? [...(r.daysOfWeek ?? [])].sort() : [],
      startDate,
      until,
      count: r.endType === 'COUNT' ? r.count! : null,
    };
  }

  /** Everything preview and booking share: checked entities, dates and their conflicts. */
  private async plan(tenant: TenantContext, dto: SeriesDto) {
    const policy = await this.booking.policy(tenant);
    const rule = this.recurrence(dto);
    const { dates, exceeded } = expandRecurrence(rule, {
      weekStartsOn: policy.weekStartsOn,
      max: LIMITS.seriesOccurrences,
    });
    if (exceeded) {
      throw fieldError(
        'recurrence.until',
        `This would book more than ${LIMITS.seriesOccurrences} sessions. Choose an earlier end date.`,
        'TOO_MANY_OCCURRENCES',
      );
    }
    if (!dates.length) {
      throw fieldError(
        'recurrence.daysOfWeek',
        'No dates match these settings. Check the days and end date.',
        'NO_OCCURRENCES',
      );
    }
    const startMinutes = parseClock(dto.startTime);
    if (startMinutes === null) {
      throw fieldError('startTime', 'Choose a time', 'VALIDATION_FAILED');
    }
    const patient = await this.booking.patient(tenant, dto.patientId);
    const type = await this.booking.therapyType(tenant, dto.therapyTypeId);
    const therapist = await this.booking.therapist(
      tenant,
      dto.therapistId,
      type.id,
    );
    this.booking.assertDuration(type, dto.durationMinutes, policy);
    const names: Names = {
      therapist: therapist.fullName,
      patient: patient.fullName,
      therapyType: type.name,
    };
    const ids = { therapistId: therapist.id, patientId: patient.id };
    const first = dates[0].date;
    const last = dates[dates.length - 1].date;
    const ctx = await this.booking.context(tenant, policy, {
      ...ids,
      therapyTypeId: type.id,
      first,
      last,
    });
    const occurrences: Occurrence[] = dates.map(({ date, adjusted }) => {
      const startAt = zonedToInstant(date, startMinutes, policy.timeZone);
      const endAt = new Date(startAt.getTime() + dto.durationMinutes * 60_000);
      const local = instantToZoned(startAt, policy.timeZone);
      // A start time a daylight-saving change skips on this date can't be booked as asked.
      const exists =
        local.date.getTime() === date.getTime() &&
        local.minutes === startMinutes;
      return {
        date,
        startAt,
        endAt,
        adjusted,
        conflicts: exists
          ? evaluate(ctx, startAt, endAt)
          : [{ reason: 'INVALID_PERIOD' }],
      };
    });
    return {
      policy,
      rule,
      patient,
      type,
      therapist,
      names,
      ids,
      ctx,
      occurrences,
      range: this.booking.range(first, last, policy.timeZone),
    };
  }

  private bookable(
    o: Occurrence,
    policy: Policy,
    allowOverlap: boolean | undefined,
  ) {
    return (
      !o.conflicts.length ||
      (Boolean(allowOverlap) && this.booking.overridable(o.conflicts, policy))
    );
  }

  private describe(
    occurrences: Occurrence[],
    policy: Policy,
    names: Names,
    allowOverlap: boolean | undefined,
  ) {
    return occurrences.map((o) => ({
      ...localTimes(o.startAt, o.endAt, policy.timeZone),
      startAt: o.startAt,
      endAt: o.endAt,
      /** MONTHLY: moved to the month's last day, which has no such date */
      adjusted: o.adjusted,
      available: this.bookable(o, policy, allowOverlap),
      /** Clashes only, which the center lets staff book over */
      overridable:
        o.conflicts.length > 0 && this.booking.overridable(o.conflicts, policy),
      conflicts: this.booking.details(o.conflicts, names, policy),
    }));
  }

  private summary(list: { available: boolean }[]) {
    const available = list.filter((o) => o.available).length;
    return {
      total: list.length,
      available,
      conflicts: list.length - available,
    };
  }

  /** Every date the rule produces and whether each can be booked. Nothing is saved. */
  async preview(tenant: TenantContext, dto: SeriesDto) {
    const plan = await this.plan(tenant, dto);
    const occurrences = this.describe(
      plan.occurrences,
      plan.policy,
      plan.names,
      dto.allowOverlap,
    );
    return {
      timezone: plan.policy.timeZone,
      summary: this.summary(occurrences),
      occurrences,
    };
  }

  /** Checks every date again under locks and books them in one transaction. */
  async create(tenant: TenantContext, dto: CreateSeriesDto) {
    if (dto.packageEnrollmentId) assertCan(tenant, 'package_enrollments.read');
    const plan = await this.plan(tenant, dto);
    const { policy, ids, names } = plan;
    const conflictError = (occurrences: Occurrence[], message: string) => {
      const list = this.describe(occurrences, policy, names, dto.allowOverlap);
      return apiError(
        HttpStatus.CONFLICT,
        message,
        'SERIES_CONFLICTS',
        undefined,
        { summary: this.summary(list), occurrences: list },
      );
    };
    const check = (occurrences: Occurrence[]) => {
      const blocked = occurrences.filter(
        (o) => !this.bookable(o, policy, dto.allowOverlap),
      );
      if (blocked.length && !dto.skipConflicts) {
        throw conflictError(
          occurrences,
          `${blocked.length} of ${occurrences.length} dates can’t be booked. Book the others only, or change the schedule.`,
        );
      }
      if (blocked.length === occurrences.length) {
        throw conflictError(
          occurrences,
          'None of these dates can be booked. Change the schedule and try again.',
        );
      }
      return blocked;
    };
    check(plan.occurrences);

    const result = await this.write(async (tx) => {
      await lockTherapist(tx, ids.therapistId);
      await lockPatient(tx, ids.patientId);
      const fresh: BookingContext = await this.booking.refresh(
        tx,
        tenant,
        plan.ctx,
        ids,
        plan.range,
      );
      const occurrences = plan.occurrences.map((o) =>
        o.conflicts.some((c) => c.reason === 'INVALID_PERIOD')
          ? o
          : { ...o, conflicts: evaluate(fresh, o.startAt, o.endAt) },
      );
      const skipped = check(occurrences);
      const toBook = occurrences.filter((o) => !skipped.includes(o));
      const skippedList = this.describe(
        skipped,
        policy,
        names,
        dto.allowOverlap,
      );
      const r = dto.recurrence;
      const series = await tx.appointmentSeries.create({
        data: {
          centerId: tenant.centerId,
          ...ids,
          therapyTypeId: plan.type.id,
          type: dto.type,
          recurrenceRule: {
            frequency: plan.rule.frequency,
            interval: plan.rule.interval,
            daysOfWeek: plan.rule.daysOfWeek,
            startTime: dto.startTime,
            endType: r.endType,
            until: plan.rule.until && formatIsoDate(plan.rule.until),
            count: plan.rule.count,
          },
          timezone: policy.timeZone,
          durationMinutes: dto.durationMinutes,
          startsOn: plan.rule.startDate,
          endsOn: plan.rule.until ?? occurrences[occurrences.length - 1].date,
          skippedOccurrences: skippedList.length
            ? skippedList.map((o) => ({
                date: o.date,
                startTime: o.startTime,
                reasons: o.conflicts.map((c) => c.reason),
              }))
            : undefined,
          createdById: tenant.userId,
        },
        select: { id: true },
      });
      const created = await tx.appointment.createManyAndReturn({
        data: toBook.map((o) => ({
          centerId: tenant.centerId,
          seriesId: series.id,
          ...ids,
          therapyTypeId: plan.type.id,
          type: dto.type,
          startAt: o.startAt,
          endAt: o.endAt,
          durationMinutes: dto.durationMinutes,
          bufferMinutes: policy.bufferMinutes,
          allowOverlap: o.conflicts.length > 0,
          internalNotes: dto.internalNotes ?? null,
          createdById: tenant.userId,
        })),
        select: { id: true, startAt: true, endAt: true, allowOverlap: true },
      });
      if (dto.packageEnrollmentId) {
        // Every booked occurrence holds a session, or none is booked.
        await this.packages.reserve(
          tx,
          tenant,
          dto.packageEnrollmentId,
          created.map((a) => ({
            appointmentId: a.id,
            patientId: ids.patientId,
            therapyTypeId: plan.type.id,
            type: dto.type,
            startAt: a.startAt,
          })),
          policy,
        );
        await tx.appointment.updateMany({
          where: { id: { in: created.map((a) => a.id) } },
          data: { packageEnrollmentId: dto.packageEnrollmentId },
        });
      }
      await tx.appointmentHistory.createMany({
        data: created.map((a) => ({
          centerId: tenant.centerId,
          appointmentId: a.id,
          action: AppointmentHistoryAction.CREATED,
          performedById: tenant.userId,
          newValues: {
            ...localTimes(a.startAt, a.endAt, policy.timeZone),
            startAt: a.startAt.toISOString(),
            endAt: a.endAt.toISOString(),
            durationMinutes: dto.durationMinutes,
            status: AppointmentStatus.SCHEDULED,
            therapist: {
              id: plan.therapist.id,
              fullName: plan.therapist.fullName,
            },
            therapyType: { id: plan.type.id, name: plan.type.name },
            type: dto.type,
            allowOverlap: a.allowOverlap,
            seriesId: series.id,
            ...(dto.packageEnrollmentId && {
              packageEnrollmentId: dto.packageEnrollmentId,
            }),
          },
        })),
      });
      return {
        id: series.id,
        created: created.length,
        ids: created.map((a) => a.id),
        skipped: skippedList,
      };
    });
    // After the booking has committed: billing never undoes it.
    if (dto.type === AppointmentType.ASSESSMENT) {
      for (const appointmentId of result.ids) {
        await this.billing.appointmentBooked(tenant, appointmentId);
      }
    }
    return {
      series: await this.get(tenant, result.id),
      created: result.created,
      skipped: result.skipped,
    };
  }

  private async write<T>(fn: (tx: Tx) => Promise<T>) {
    try {
      return await this.prisma.$transaction(fn, { timeout: 15_000 });
    } catch (error) {
      const which = overlapViolation(error);
      if (which) throw slotTaken(which);
      throw error;
    }
  }

  private async view(tenant: TenantContext): Promise<View> {
    const policy = await this.booking.policy(tenant);
    return {
      tenant,
      timeZone: policy.timeZone,
      now: new Date(),
      cancellationCutoffMinutes: policy.cancellationCutoffMinutes,
    };
  }

  async get(tenant: TenantContext, id: string) {
    const row = await this.prisma.appointmentSeries.findFirst({
      where: { id, ...visibleSeries(tenant) },
      select: {
        id: true,
        type: true,
        status: true,
        recurrenceRule: true,
        timezone: true,
        durationMinutes: true,
        startsOn: true,
        endsOn: true,
        skippedOccurrences: true,
        createdAt: true,
        createdBy: { select: { id: true, fullName: true } },
        patient: { select: { id: true, code: true, fullName: true } },
        therapist: { select: { id: true, code: true, fullName: true } },
        therapyType: {
          select: { id: true, name: true, code: true, color: true },
        },
        appointments: {
          where: visibleAppointments(tenant),
          select: itemSelect,
          orderBy: { startAt: 'asc' },
        },
      },
    });
    if (!row) throw seriesNotFound();
    const view = await this.view(tenant);
    const { appointments, ...series } = row;
    const items = appointments.map((a) => toItem(a, view));
    return {
      ...series,
      startsOn: formatIsoDate(row.startsOn),
      endsOn: formatIsoDate(row.endsOn),
      appointments: items,
      counts: {
        total: items.length,
        open: items.filter((a) => OPEN_STATUSES.includes(a.status)).length,
        upcoming: items.filter(
          (a) => OPEN_STATUSES.includes(a.status) && a.startAt >= view.now,
        ).length,
      },
    };
  }

  /**
   * Cancels the series' open appointments from one occurrence (default: from now) on.
   * Completed, no-show and earlier ones are kept as they are. The first one decides
   * whether this is a late cancellation; each is flagged late on its own merits.
   */
  async cancelFuture(tenant: TenantContext, id: string, dto: CancelSeriesDto) {
    const series = await this.prisma.appointmentSeries.findFirst({
      where: { id, ...visibleSeries(tenant) },
      select: { id: true },
    });
    if (!series) throw seriesNotFound();
    const now = new Date();
    let from = now;
    if (dto.fromAppointmentId) {
      const anchor = await this.prisma.appointment.findFirst({
        where: {
          id: dto.fromAppointmentId,
          seriesId: id,
          ...visibleAppointments(tenant),
        },
        select: { startAt: true },
      });
      if (!anchor) {
        throw fieldError(
          'fromAppointmentId',
          'That appointment isn’t part of this recurring booking',
          'VALIDATION_FAILED',
        );
      }
      from = anchor.startAt;
    }
    const policy = await this.booking.policy(tenant);
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const targets = await tx.appointment.findMany({
        where: {
          seriesId: id,
          centerId: tenant.centerId,
          status: { in: OPEN_STATUSES },
          startAt: { gte: from },
        },
        select: { id: true, status: true, startAt: true },
        orderBy: { startAt: 'asc' },
      });
      if (!targets.length) {
        throw apiError(
          HttpStatus.CONFLICT,
          'There are no upcoming appointments left to cancel in this series.',
          'NOTHING_TO_CANCEL',
        );
      }
      if (
        isLateCancellation(
          targets[0].startAt,
          now,
          policy.cancellationCutoffMinutes,
        )
      ) {
        assertLateCancellation(tenant, policy);
      }
      let cancelled = 0;
      for (const t of targets) {
        const late = isLateCancellation(
          t.startAt,
          now,
          policy.cancellationCutoffMinutes,
        );
        // One changed by someone else meanwhile (e.g. completed) is left as it is.
        const { count } = await tx.appointment.updateMany({
          where: { id: t.id, status: t.status },
          data: {
            status: AppointmentStatus.CANCELLED,
            cancelledAt: now,
            cancelledById: tenant.userId,
            cancellationReason: dto.reason,
            cancellationNote: dto.note ?? null,
            lateCancellation: late,
            updatedById: tenant.userId,
          },
        });
        if (!count) continue;
        cancelled += 1;
        await this.packages.settle(tx, tenant, t.id, 'CANCELLED', { late });
        await recordHistory(tx, tenant, {
          appointmentId: t.id,
          action: AppointmentHistoryAction.CANCELLED,
          previousValues: { status: t.status },
          newValues: {
            status: AppointmentStatus.CANCELLED,
            cancellationReason: dto.reason,
            lateCancellation: late,
            series: true,
          },
          reason: dto.note,
        });
      }
      const remaining = await tx.appointment.count({
        where: { seriesId: id, status: { in: OPEN_STATUSES } },
      });
      if (!remaining) {
        await tx.appointmentSeries.update({
          where: { id },
          data: { status: AppointmentSeriesStatus.CANCELLED },
        });
      }
      return cancelled;
    });
    return { cancelled, series: await this.get(tenant, id) };
  }
}
