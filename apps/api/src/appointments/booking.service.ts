import { HttpStatus, Injectable } from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import { LIMITS } from '../center-settings/limits';
import { SettingsService } from '../center-settings/settings.service';
import { apiError } from '../common/errors';
import {
  formatClock,
  formatIsoDate,
  instantToZoned,
  parseClock,
  parseIsoDate,
  zonedToInstant,
} from '../common/time';
import { Prisma } from '../generated/prisma/client';
import {
  PatientStatus,
  TherapistStatus,
  type TimeDisplayFormat,
} from '../generated/prisma/enums';
import { visiblePatients } from '../patients/access';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import { DAY_MINUTES } from '../therapists/schedule';
import { visibleTherapists } from '../therapists/access';
import { ScheduleService } from '../therapists/schedule.service';
import {
  BLOCKING_STATUSES,
  onlyOverlaps,
  type Booked,
  type BookingContext,
  type Conflict,
} from './rules';

type Db = Prisma.TransactionClient | PrismaService;

/** The center's booking settings and display preferences, read once per request. */
export interface Policy {
  timeZone: string;
  slotIntervalMinutes: number;
  bufferMinutes: number;
  allowCustomDuration: boolean;
  advanceBookingLimitDays: number;
  minimumNoticeMinutes: number;
  allowDoubleBooking: boolean;
  allowPastDateBooking: boolean;
  cancellationCutoffMinutes: number;
  weekStartsOn: number;
  timeFormat: TimeDisplayFormat;
}

/** Names used to explain conflicts. */
export interface Names {
  therapist: string;
  patient?: string;
  therapyType: string;
}

/** Bookings are looked up this far either side of a period, so any row's buffer is seen. */
const BUFFER_MARGIN_MS = LIMITS.bookingBufferMinutes.max * 60_000;

/** "09:30" in the center's 24-hour format or "9:30 AM" in its 12-hour one. */
export function clockText(minutes: number, format: TimeDisplayFormat) {
  if (format === 'H24') return formatClock(minutes);
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** 90 → "1 hour 30 minutes", 2880 → "2 days" */
export function durationText(minutes: number) {
  const plural = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (minutes % 1440 === 0) return plural(minutes / 1440, 'day');
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h && plural(h, 'hour'), m && plural(m, 'minute')]
    .filter(Boolean)
    .join(' ');
}

/** Which overlap constraint rejected a write, if one did (Postgres exclusion_violation). */
export function overlapViolation(
  error: unknown,
): 'THERAPIST' | 'PATIENT' | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const cause = (
    error.meta as
      | { driverAdapterError?: { cause?: { code?: string; message?: string } } }
      | undefined
  )?.driverAdapterError?.cause;
  if (cause?.code !== '23P01') return null;
  return cause.message?.includes('Appointment_patient_overlap')
    ? 'PATIENT'
    : 'THERAPIST';
}

/** The database turned a booking down because another one got there first. */
export function slotTaken(which: 'THERAPIST' | 'PATIENT') {
  return apiError(
    HttpStatus.CONFLICT,
    which === 'PATIENT'
      ? 'The patient was booked at this time a moment ago. Choose another time.'
      : 'This time was booked a moment ago. Choose another time.',
    'SLOT_TAKEN',
    undefined,
    { conflicts: [{ reason: `${which}_BUSY` }] },
  );
}

/**
 * Everything booking needs besides the rules themselves: the center's policy, checks on
 * the patient, therapy and therapist, schedule facts and existing bookings, and plain
 * explanations of conflicts. Single and recurring bookings and rescheduling all use it.
 */
@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly schedule: ScheduleService,
  ) {}

  async policy(tenant: TenantContext): Promise<Policy> {
    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: { timezone: true },
    });
    const scheduling = await this.settings.getScheduling(tenant);
    const general = await this.settings.getGeneral(tenant);
    return {
      timeZone: center.timezone,
      slotIntervalMinutes: scheduling.slotIntervalMinutes,
      bufferMinutes: scheduling.bookingBufferMinutes,
      allowCustomDuration: scheduling.allowCustomDuration,
      advanceBookingLimitDays: scheduling.advanceBookingLimitDays,
      minimumNoticeMinutes: scheduling.minimumBookingNoticeMinutes,
      allowDoubleBooking: scheduling.allowDoubleBooking,
      allowPastDateBooking: scheduling.allowPastDateBooking,
      cancellationCutoffMinutes: scheduling.cancellationCutoffMinutes,
      weekStartsOn: general.weekStartsOn,
      timeFormat: general.timeFormat,
    };
  }

  /** A center-local date, rejecting impossible ones (e.g. 2026-02-30). */
  date(value: string, field: string) {
    const date = parseIsoDate(value);
    if (!date)
      throw fieldError(field, 'Choose a valid date', 'VALIDATION_FAILED');
    return date;
  }

  /**
   * The instant a center-local date and "HH:mm" happen. Rejects wall-clock times that a
   * daylight-saving change skips, rather than quietly moving them.
   */
  instant(date: Date, time: string, timeZone: string, field = 'startTime') {
    const minutes = parseClock(time);
    if (minutes === null) {
      throw fieldError(field, 'Choose a time', 'VALIDATION_FAILED');
    }
    const startAt = zonedToInstant(date, minutes, timeZone);
    const local = instantToZoned(startAt, timeZone);
    if (local.date.getTime() !== date.getTime() || local.minutes !== minutes) {
      throw fieldError(
        field,
        'This time doesn’t exist on this date because the clocks change. Choose another time.',
        'VALIDATION_FAILED',
      );
    }
    return startAt;
  }

  /**
   * A patient who can be booked: in this center and not deleted. Inactive patients are
   * out of day-to-day work, so new bookings for them are refused unless `allowInactive`
   * (moving an appointment they already have).
   */
  async patient(
    tenant: TenantContext,
    id: string,
    { allowInactive = false } = {},
  ) {
    const patient = await this.prisma.patient.findFirst({
      where: { id, ...visiblePatients(tenant) },
      select: { id: true, code: true, fullName: true, status: true },
    });
    if (!patient) {
      throw fieldError(
        'patientId',
        'This patient no longer exists. Search again.',
        'PATIENT_NOT_FOUND',
      );
    }
    if (patient.status === PatientStatus.INACTIVE && !allowInactive) {
      throw fieldError(
        'patientId',
        `${patient.fullName} is inactive. Reactivate them on their profile to book.`,
        'PATIENT_INACTIVE',
      );
    }
    return patient;
  }

  /**
   * A therapy type of this center, with its active duration options. Inactive types
   * can't be newly booked; `keepInactive` lets an appointment that already has one keep it.
   */
  async therapyType(
    tenant: TenantContext,
    id: string,
    { keepInactive = false } = {},
  ) {
    const type = await this.prisma.therapyType.findFirst({
      where: { id, centerId: tenant.centerId },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        durationOptions: {
          where: { isActive: true },
          select: { durationMinutes: true },
        },
      },
    });
    if (!type) {
      throw fieldError(
        'therapyTypeId',
        'This therapy no longer exists. Reload and try again.',
        'THERAPY_TYPE_NOT_FOUND',
      );
    }
    if (!type.isActive && !keepInactive) {
      throw fieldError(
        'therapyTypeId',
        `${type.name} is inactive, so it can’t be booked. Activate it in Settings first.`,
        'THERAPY_TYPE_INACTIVE',
      );
    }
    return {
      ...type,
      durations: type.durationOptions.map((o) => o.durationMinutes),
    };
  }

  /** A therapist who can take this therapy: in this center, active and specialized in it. */
  async therapist(tenant: TenantContext, id: string, therapyTypeId: string) {
    const therapist = await this.prisma.therapist.findFirst({
      where: { id, ...visibleTherapists(tenant) },
      select: {
        id: true,
        code: true,
        fullName: true,
        status: true,
        specializations: {
          where: { therapyTypeId },
          select: { therapyType: { select: { name: true } } },
        },
      },
    });
    if (!therapist) {
      throw fieldError(
        'therapistId',
        'This therapist no longer exists. Choose another.',
        'THERAPIST_NOT_FOUND',
      );
    }
    if (therapist.status !== TherapistStatus.ACTIVE) {
      throw fieldError(
        'therapistId',
        `${therapist.fullName} is inactive, so they can’t be booked.`,
        'THERAPIST_INACTIVE',
      );
    }
    if (!therapist.specializations.length) {
      throw fieldError(
        'therapistId',
        `${therapist.fullName} doesn’t provide this therapy. Choose another therapist.`,
        'THERAPIST_NOT_SPECIALIZED',
      );
    }
    return therapist;
  }

  /**
   * One of the therapy type's duration options, or any length within limits when the
   * center allows custom durations. `keep` is an appointment's current length, which may
   * stay even if that option has since been removed.
   */
  assertDuration(
    type: { name: string; durations: number[] },
    minutes: number,
    policy: Policy,
    keep?: number,
  ) {
    if (type.durations.includes(minutes) || minutes === keep) return;
    if (policy.allowCustomDuration && minutes % 5 === 0) return;
    const options = [...type.durations].sort((a, b) => a - b).join(', ');
    throw fieldError(
      'durationMinutes',
      policy.allowCustomDuration
        ? 'Use a length in steps of 5 minutes'
        : `${type.name} can be booked for ${options || 'no'} minutes`,
      'DURATION_NOT_ALLOWED',
    );
  }

  /**
   * Time-holding bookings of the therapist and the patient around the center-local dates
   * `first`…`last`. Reads only plain columns, so it's safe inside a transaction.
   */
  async bookings(
    db: Db,
    tenant: TenantContext,
    ids: { therapistId: string; patientId?: string },
    range: { from: Date; to: Date },
  ) {
    const rows = await db.appointment.findMany({
      where: {
        centerId: tenant.centerId,
        status: { in: BLOCKING_STATUSES },
        OR: [
          { therapistId: ids.therapistId },
          ...(ids.patientId ? [{ patientId: ids.patientId }] : []),
        ],
        startAt: { lt: new Date(range.to.getTime() + BUFFER_MARGIN_MS) },
        endAt: { gt: new Date(range.from.getTime() - BUFFER_MARGIN_MS) },
      },
      select: {
        id: true,
        therapistId: true,
        patientId: true,
        startAt: true,
        endAt: true,
        bufferMinutes: true,
      },
    });
    const booked = (r: (typeof rows)[number]): Booked => ({
      id: r.id,
      startAt: r.startAt,
      endAt: r.endAt,
      bufferMinutes: r.bufferMinutes,
    });
    return {
      therapist: rows
        .filter((r) => r.therapistId === ids.therapistId)
        .map(booked),
      patient: ids.patientId
        ? rows.filter((r) => r.patientId === ids.patientId).map(booked)
        : [],
    };
  }

  /** The instants covering center-local dates `first`…`last`. */
  range(first: Date, last: Date, timeZone: string) {
    return {
      from: zonedToInstant(first, 0, timeZone),
      to: zonedToInstant(last, DAY_MINUTES, timeZone),
    };
  }

  /**
   * Schedule facts and bookings for judging periods on `first`…`last`, plus the
   * therapist's name for messages. A therapist the caller can't see is a 404.
   */
  async context(
    tenant: TenantContext,
    policy: Policy,
    input: {
      therapistId: string;
      therapyTypeId: string;
      patientId?: string;
      first: Date;
      last: Date;
      now?: Date;
    },
  ): Promise<BookingContext & { therapistName: string }> {
    const { therapist, days } = await this.schedule.facts(
      tenant,
      input.therapistId,
      input.first,
      input.last,
    );
    const bookings = await this.bookings(
      this.prisma,
      tenant,
      input,
      this.range(input.first, input.last, policy.timeZone),
    );
    return {
      policy: {
        timeZone: policy.timeZone,
        now: input.now ?? new Date(),
        bufferMinutes: policy.bufferMinutes,
        minimumNoticeMinutes: policy.minimumNoticeMinutes,
        advanceBookingLimitDays: policy.advanceBookingLimitDays,
        allowPastDateBooking: policy.allowPastDateBooking,
      },
      days: new Map(days.map((d) => [formatIsoDate(d.date), d.facts])),
      specialized: therapist.specializations.some(
        (s) =>
          s.therapyTypeId === input.therapyTypeId && s.therapyType.isActive,
      ),
      therapistBookings: bookings.therapist,
      patientBookings: bookings.patient,
      therapistName: therapist.fullName,
    };
  }

  /** Re-reads bookings (e.g. inside the booking transaction) without re-reading schedules. */
  async refresh(
    db: Db,
    tenant: TenantContext,
    ctx: BookingContext,
    ids: { therapistId: string; patientId?: string },
    range: { from: Date; to: Date },
  ): Promise<BookingContext> {
    const bookings = await this.bookings(db, tenant, ids, range);
    return {
      ...ctx,
      therapistBookings: bookings.therapist,
      patientBookings: bookings.patient,
    };
  }

  /** "10:00 AM–11:00 AM" in the center's time zone and clock format. */
  private periodText(startAt: Date, endAt: Date, policy: Policy) {
    const start = instantToZoned(startAt, policy.timeZone);
    const end = instantToZoned(endAt, policy.timeZone);
    return `${clockText(start.minutes, policy.timeFormat)}–${clockText(end.minutes, policy.timeFormat)}`;
  }

  describe(conflict: Conflict, names: Names, policy: Policy): string {
    const clash = () =>
      conflict.startAt && conflict.endAt
        ? ` (${this.periodText(conflict.startAt, conflict.endAt, policy)})`
        : '';
    switch (conflict.reason) {
      case 'THERAPIST_INACTIVE':
        return `${names.therapist} is inactive, so they can’t be booked`;
      case 'NOT_SPECIALIZED':
        return `${names.therapist} doesn’t provide ${names.therapyType}`;
      case 'OUTSIDE_REGULAR_HOURS':
        return `${names.therapist} isn’t working at this time`;
      case 'OUTSIDE_CENTER_HOURS':
        return 'The center isn’t open at this time';
      case 'CENTER_CLOSED':
        return 'The center is closed';
      case 'TIME_OFF':
        return `${names.therapist} is on time off`;
      case 'INVALID_PERIOD':
        return 'Appointments must start and end on the same day';
      case 'IN_THE_PAST':
        return 'This time has already passed';
      case 'TOO_SOON':
        return `Appointments need at least ${durationText(policy.minimumNoticeMinutes)} notice`;
      case 'TOO_FAR_AHEAD':
        return `Appointments can be booked up to ${policy.advanceBookingLimitDays} days ahead`;
      case 'THERAPIST_BUSY':
        return `${names.therapist} already has an appointment${clash()}`;
      case 'PATIENT_BUSY':
        return `${names.patient ?? 'The patient'} already has an appointment${clash()}`;
    }
  }

  /** Conflicts in the shape the API returns them: reason codes plus readable messages. */
  details(conflicts: Conflict[], names: Names, policy: Policy) {
    return conflicts.map((c) => ({
      reason: c.reason,
      message: this.describe(c, names, policy),
      ...(c.appointmentId && {
        appointmentId: c.appointmentId,
        startAt: c.startAt,
        endAt: c.endAt,
      }),
    }));
  }

  /** A clash the center lets staff book over on purpose (double booking). */
  overridable(conflicts: Conflict[], policy: Policy) {
    return policy.allowDoubleBooking && onlyOverlaps(conflicts);
  }

  /**
   * Decides one booking: false when it's free, true when it clashes only with other
   * bookings and staff chose to double-book where the center allows it. Anything else
   * is a 409 with every conflict, so the screen can show exactly what's wrong.
   */
  settle(
    conflicts: Conflict[],
    policy: Policy,
    names: Names,
    allowOverlap = false,
  ) {
    if (!conflicts.length) return false;
    const overridable = this.overridable(conflicts, policy);
    if (overridable && allowOverlap) return true;
    const details = this.details(conflicts, names, policy);
    throw apiError(
      HttpStatus.CONFLICT,
      details[0].message,
      'APPOINTMENT_CONFLICT',
      undefined,
      { conflicts: details, overridable },
    );
  }
}
