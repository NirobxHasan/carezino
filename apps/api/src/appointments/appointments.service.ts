import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import { BillingEvents } from '../billing/events.service';
import { LIMITS } from '../center-settings/limits';
import { apiError } from '../common/errors';
import {
  addDays,
  daysInclusive,
  formatClock,
  formatIsoDate,
  instantToZoned,
  zonedToInstant,
} from '../common/time';
import type { Prisma } from '../generated/prisma/client';
import {
  AppointmentHistoryAction,
  AppointmentStatus,
  AttendanceStatus,
  PackageLedgerMovement,
  PackageReleaseReason,
  PackageReservationStatus,
} from '../generated/prisma/enums';
import {
  PackageSessions,
  type BookedSession,
  type SessionPolicy,
} from '../packages/sessions.service';
import { assertCan } from '../patients/access';
import { primaryContactOf } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import { attendanceOf, attended } from '../sessions/rules';
import { lockTherapist } from '../therapists/access';
import { centerHoursByDay } from '../therapists/availability.service';
import { DAY_MINUTES } from '../therapists/schedule';
import { appointmentNotFound, visibleAppointments } from './access';
import {
  BookingService,
  durationText,
  overlapViolation,
  slotTaken,
  type Policy,
} from './booking.service';
import type {
  AvailableSlotsQuery,
  CalendarQuery,
  CancelAppointmentDto,
  ChangeAppointmentPackageDto,
  ChangeAppointmentStatusDto,
  CreateAppointmentDto,
  ListAppointmentsQuery,
  RescheduleAppointmentDto,
  UpdateAppointmentDto,
} from './dto';
import {
  OPEN_STATUSES,
  canTransition,
  dayReason,
  daySlots,
  evaluate,
  isLateCancellation,
  localPeriod,
  needsStarted,
} from './rules';
import { SESSION_OUTCOMES, type SessionOutcomes } from './sessions.port';

type Tx = Prisma.TransactionClient;

export const itemSelect = {
  id: true,
  seriesId: true,
  type: true,
  status: true,
  startAt: true,
  endAt: true,
  durationMinutes: true,
  allowOverlap: true,
  lateCancellation: true,
  cancellationReason: true,
  cancelledAt: true,
  packageEnrollmentId: true,
  createdAt: true,
  updatedAt: true,
  patient: {
    select: {
      id: true,
      code: true,
      fullName: true,
      photoUrl: true,
      status: true,
      deletedAt: true,
    },
  },
  therapist: {
    select: {
      id: true,
      code: true,
      fullName: true,
      photoUrl: true,
      deletedAt: true,
      membershipId: true,
    },
  },
  therapyType: { select: { id: true, name: true, code: true, color: true } },
  attendance: { select: { status: true, checkInAt: true } },
} satisfies Prisma.AppointmentSelect;

const userSelect = { select: { id: true, fullName: true } } as const;

const detailSelect = {
  ...itemSelect,
  bufferMinutes: true,
  internalNotes: true,
  cancellationNote: true,
  createdBy: userSelect,
  updatedBy: userSelect,
  cancelledBy: userSelect,
  patient: {
    select: {
      ...itemSelect.patient.select,
      mobile: true,
      primaryContactIsSelf: true,
      guardians: {
        where: { isPrimary: true },
        take: 1,
        select: {
          isPrimary: true,
          contactType: true,
          relationship: true,
          customRelationship: true,
          guardian: { select: { fullName: true, mobile: true } },
        },
      },
    },
  },
  series: {
    select: {
      id: true,
      status: true,
      recurrenceRule: true,
      timezone: true,
      startsOn: true,
      endsOn: true,
    },
  },
  assessment: { select: { id: true, status: true } },
  packageEnrollment: {
    select: { id: true, code: true, packageName: true },
  },
  // The latest reservation says whether the package still holds a session for it.
  packageReservations: {
    select: { enrollmentId: true, status: true, releaseReason: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  packageMovements: {
    where: { movement: PackageLedgerMovement.SESSION_CONSUMPTION },
    select: {
      id: true,
      enrollmentId: true,
      chargeReason: true,
      reversedBy: { select: { id: true } },
    },
  },
  history: {
    select: {
      id: true,
      action: true,
      previousValues: true,
      newValues: true,
      reason: true,
      createdAt: true,
      performedBy: userSelect,
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.AppointmentSelect;

export type ItemRow = Prisma.AppointmentGetPayload<{
  select: typeof itemSelect;
}>;
type DetailRow = Prisma.AppointmentGetPayload<{ select: typeof detailSelect }>;

/** What a list or detail needs to describe rows for one caller. */
export interface View {
  tenant: TenantContext;
  timeZone: string;
  now: Date;
  cancellationCutoffMinutes: number;
}

/** Center-local date and clock times; an appointment ending at midnight ends at "24:00". */
export function localTimes(startAt: Date, endAt: Date, timeZone: string) {
  const period = localPeriod(startAt, endAt, timeZone);
  const start = instantToZoned(startAt, timeZone);
  return {
    date: formatIsoDate(start.date),
    startTime: formatClock(start.minutes),
    endTime: formatClock(
      period ? period.end : instantToZoned(endAt, timeZone).minutes,
    ),
  };
}

/**
 * What the caller may do with an appointment now, so every screen offers the same
 * actions. The API still checks each request.
 */
function allowedActions(row: ItemRow, view: View) {
  const can = (p: Parameters<typeof assertCan>[1]) =>
    view.tenant.permissions.includes(p);
  const open = OPEN_STATUSES.includes(row.status);
  const started = row.startAt <= view.now;
  const late =
    open &&
    isLateCancellation(row.startAt, view.now, view.cancellationCutoffMinutes);
  const manage = open && can('appointments.manage_status');
  // Completing needs attendance (marked, or given when completing); a no-show is the
  // patient being absent, so it isn't offered once they've arrived.
  const attendance = attendanceOf(row.status, row.attendance?.status);
  return {
    confirm: manage && row.status === AppointmentStatus.SCHEDULED,
    complete:
      manage &&
      started &&
      can('sessions.complete') &&
      (attended(attendance) || can('attendance.record')),
    noShow:
      manage && started && !attended(attendance) && can('attendance.record'),
    reschedule: open && can('appointments.reschedule'),
    cancel:
      open &&
      can('appointments.cancel') &&
      (!late || can('appointments.cancel_late')),
    edit:
      row.status !== AppointmentStatus.CANCELLED && can('appointments.update'),
    /** Choosing, changing or removing the package that pays for it */
    changePackage:
      open && can('appointments.update') && can('package_enrollments.read'),
    /** Cancelling now would count as a late cancellation */
    lateCancellation: late,
  };
}

export function toItem(row: ItemRow, view: View) {
  const { patient, therapist } = row;
  return {
    id: row.id,
    seriesId: row.seriesId,
    type: row.type,
    status: row.status,
    startAt: row.startAt,
    endAt: row.endAt,
    ...localTimes(row.startAt, row.endAt, view.timeZone),
    durationMinutes: row.durationMinutes,
    patient: {
      id: patient.id,
      code: patient.code,
      fullName: patient.fullName,
      photoUrl: patient.photoUrl,
      status: patient.status,
      isDeleted: patient.deletedAt !== null,
    },
    therapist: {
      id: therapist.id,
      code: therapist.code,
      fullName: therapist.fullName,
      photoUrl: therapist.photoUrl,
      isDeleted: therapist.deletedAt !== null,
      isYou:
        therapist.membershipId !== null &&
        therapist.membershipId === view.tenant.membershipId,
    },
    therapyType: row.therapyType,
    /** Whether the patient came; ABSENT for no-shows (see the sessions module) */
    attendance: {
      status: attendanceOf(row.status, row.attendance?.status),
      checkInAt: row.attendance?.checkInAt ?? null,
      checkInTime: row.attendance?.checkInAt
        ? formatClock(
            instantToZoned(row.attendance.checkInAt, view.timeZone).minutes,
          )
        : null,
    },
    /** Booked over a clash on purpose (the center allows double booking) */
    allowOverlap: row.allowOverlap,
    lateCancellation: row.lateCancellation,
    cancellationReason: row.cancellationReason,
    cancelledAt: row.cancelledAt,
    /** The package enrollment it's assigned to, if any (see the detail for coverage) */
    packageEnrollmentId: row.packageEnrollmentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    actions: allowedActions(row, view),
  };
}

/**
 * Which package pays for the appointment and where that stands: HELD (a session is
 * reserved), CHARGED (one was used), REVERSED (charged, then given back) or RELEASED
 * (it was given back, e.g. on cancellation). No prices or balances: therapists see this.
 */
function packageCoverage(row: DetailRow) {
  const enrollment = row.packageEnrollment;
  if (!enrollment) return null;
  const charge = row.packageMovements.find(
    (m) => m.enrollmentId === enrollment.id,
  );
  const reservation = row.packageReservations.find(
    (r) => r.enrollmentId === enrollment.id,
  );
  return {
    enrollmentId: enrollment.id,
    code: enrollment.code,
    name: enrollment.packageName,
    coverage: charge
      ? charge.reversedBy
        ? ('REVERSED' as const)
        : ('CHARGED' as const)
      : reservation?.status === PackageReservationStatus.ACTIVE
        ? ('HELD' as const)
        : ('RELEASED' as const),
    chargeReason: charge?.chargeReason ?? null,
    releaseReason: charge ? null : (reservation?.releaseReason ?? null),
    /** The consumption entry, for reversing it from the enrollment */
    consumptionId: charge?.id ?? null,
  };
}

/** Locks an appointment row until the transaction ends, before its package is changed. */
async function lockAppointment(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id = ${id}::uuid FOR UPDATE`;
}

/** The booking as history records it: times as staff saw them, people by ID and name. */
function snapshot(
  row: {
    startAt: Date;
    endAt: Date;
    durationMinutes: number;
    status: AppointmentStatus;
    therapist: { id: string; fullName: string };
    therapyType: { id: string; name: string };
  },
  timeZone: string,
) {
  return {
    ...localTimes(row.startAt, row.endAt, timeZone),
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    durationMinutes: row.durationMinutes,
    status: row.status,
    therapist: { id: row.therapist.id, fullName: row.therapist.fullName },
    therapyType: { id: row.therapyType.id, name: row.therapyType.name },
  };
}

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'scheduled',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no-show',
};

/** Someone else changed the appointment between reading and writing it. */
const changedMeanwhile = () =>
  apiError(
    HttpStatus.CONFLICT,
    'This appointment was just changed by someone else. Reload and try again.',
    'APPOINTMENT_CHANGED',
  );

const notOpen = (status: AppointmentStatus, action: string) =>
  apiError(
    HttpStatus.CONFLICT,
    `This appointment is ${STATUS_LABELS[status]}, so it can’t be ${action}.`,
    'INVALID_STATUS_TRANSITION',
  );

/** Locks the patient row until the transaction ends; with the therapist lock, serializes bookings. */
export async function lockPatient(tx: Tx, patientId: string) {
  await tx.$queryRaw`SELECT id FROM "Patient" WHERE id = ${patientId}::uuid FOR UPDATE`;
}

/**
 * Appointments whose patient (name, ID, mobile or a guardian's mobile) or therapist
 * (name) matches. "+880 1712-…" finds 01712…, which is how BD mobiles are stored.
 */
export function appointmentSearch(
  search: string,
): Prisma.AppointmentWhereInput {
  const digits = search.replace(/[\s\-().]/g, '').replace(/^\+?88(?=01)/, '');
  const phoneLike = /^\+?\d{3,}$/.test(digits);
  return {
    OR: [
      { patient: { fullName: { contains: search, mode: 'insensitive' } } },
      { patient: { code: { contains: search, mode: 'insensitive' } } },
      { therapist: { fullName: { contains: search, mode: 'insensitive' } } },
      ...(phoneLike
        ? [
            { patient: { mobile: { contains: digits } } },
            {
              patient: {
                guardians: {
                  some: {
                    guardian: {
                      OR: [
                        { mobile: { contains: digits } },
                        { secondaryMobile: { contains: digits } },
                      ],
                    },
                  },
                },
              },
            },
          ]
        : []),
    ],
  };
}

/** Records one entry of an appointment's history in the same transaction as the change. */
export function recordHistory(
  tx: Tx,
  tenant: TenantContext,
  entry: {
    appointmentId: string;
    action: AppointmentHistoryAction;
    previousValues?: Prisma.InputJsonValue;
    newValues?: Prisma.InputJsonValue;
    reason?: string | null;
  },
) {
  return tx.appointmentHistory.create({
    data: {
      centerId: tenant.centerId,
      performedById: tenant.userId,
      reason: entry.reason ?? null,
      appointmentId: entry.appointmentId,
      action: entry.action,
      previousValues: entry.previousValues,
      newValues: entry.newValues,
    },
  });
}

/**
 * Single appointments: listing, the calendar, available slots, booking, rescheduling,
 * cancelling and status changes, each recorded in AppointmentHistory. Bookings are
 * checked against the center's rules here and protected against concurrent
 * double booking by the database (see the appointments migration).
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly booking: BookingService,
    private readonly packages: PackageSessions,
    @Inject(SESSION_OUTCOMES) private readonly sessions: SessionOutcomes,
    private readonly billing: BillingEvents,
  ) {}

  async view(tenant: TenantContext, policy?: Policy): Promise<View> {
    const p = policy ?? (await this.booking.policy(tenant));
    return {
      tenant,
      timeZone: p.timeZone,
      now: new Date(),
      cancellationCutoffMinutes: p.cancellationCutoffMinutes,
    };
  }

  /** Runs a booking write, turning the database's overlap check into a clean 409. */
  private async write<T>(fn: (tx: Tx) => Promise<T>) {
    try {
      return await this.prisma.$transaction(fn);
    } catch (error) {
      const which = overlapViolation(error);
      if (which) throw slotTaken(which);
      throw error;
    }
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  /** Center-local dates, both included, as a half-open range of instants. */
  private dateRange(
    from: string | undefined,
    to: string | undefined,
    timeZone: string,
  ) {
    const first = from ? this.booking.date(from, 'from') : null;
    const last = to ? this.booking.date(to, 'to') : null;
    return {
      ...(first && { gte: zonedToInstant(first, 0, timeZone) }),
      ...(last && { lt: zonedToInstant(addDays(last, 1), 0, timeZone) }),
    };
  }

  private filters(
    query: Pick<
      ListAppointmentsQuery,
      'therapistId' | 'therapyTypeId' | 'patientId' | 'type' | 'status'
    >,
  ): Prisma.AppointmentWhereInput {
    return {
      ...(query.therapistId && { therapistId: query.therapistId }),
      ...(query.therapyTypeId && { therapyTypeId: query.therapyTypeId }),
      ...(query.patientId && { patientId: query.patientId }),
      ...(query.type && { type: query.type }),
      ...(query.status?.length && { status: { in: query.status } }),
    };
  }

  async list(tenant: TenantContext, query: ListAppointmentsQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const view = await this.view(tenant);
    const startAt = this.dateRange(query.from, query.to, view.timeZone);
    const where: Prisma.AppointmentWhereInput = {
      AND: [
        visibleAppointments(tenant),
        this.filters(query),
        Object.keys(startAt).length ? { startAt } : {},
        query.timeframe === 'upcoming' ? { startAt: { gte: view.now } } : {},
        query.timeframe === 'past' ? { startAt: { lt: view.now } } : {},
        query.search ? appointmentSearch(query.search) : {},
      ],
    };
    const order =
      query.sortOrder ?? (query.timeframe === 'past' ? 'desc' : 'asc');
    // Not a batch transaction: the page loads relations, which Prisma fetches in
    // parallel, and a transaction's single connection can't run queries in parallel.
    const [total, rows] = await Promise.all([
      this.prisma.appointment.count({ where }),
      this.prisma.appointment.findMany({
        where,
        select: itemSelect,
        orderBy: [{ startAt: order }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => toItem(r, view)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Appointments for a calendar range (up to six weeks), with the center's opening
   * hours and closures per day so the grid can shade them.
   */
  async calendar(tenant: TenantContext, query: CalendarQuery) {
    const view = await this.view(tenant);
    const first = this.booking.date(query.startDate, 'startDate');
    const last = this.booking.date(query.endDate, 'endDate');
    if (last < first || daysInclusive(first, last) > LIMITS.scheduleDays) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        `Show up to ${LIMITS.scheduleDays} days at a time`,
        'VALIDATION_FAILED',
        { endDate: `Show up to ${LIMITS.scheduleDays} days at a time` },
      );
    }
    const from = zonedToInstant(first, 0, view.timeZone);
    const to = zonedToInstant(last, DAY_MINUTES, view.timeZone);
    const rows = await this.prisma.appointment.findMany({
      where: {
        AND: [
          visibleAppointments(tenant),
          this.filters(query),
          { startAt: { lt: to }, endAt: { gt: from } },
        ],
      },
      select: itemSelect,
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });
    const hours = await centerHoursByDay(this.prisma, tenant.centerId);
    const closures = await this.prisma.centerClosure.findMany({
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
    });
    const clock = (i: { start: number; end: number }) => ({
      start: formatClock(i.start),
      end: formatClock(i.end),
    });
    return {
      timezone: view.timeZone,
      startDate: formatIsoDate(first),
      endDate: formatIsoDate(last),
      days: Array.from({ length: daysInclusive(first, last) }, (_, i) => {
        const date = addDays(first, i);
        return {
          date: formatIsoDate(date),
          dayOfWeek: date.getUTCDay(),
          centerHours: hours.byDay[date.getUTCDay()].map(clock),
          closures: closures
            .filter((c) => c.startDate <= date && c.endDate >= date)
            .map((c) => ({
              id: c.id,
              title: c.title,
              allDay: c.allDay,
              ...clock(
                c.allDay
                  ? { start: 0, end: DAY_MINUTES }
                  : {
                      start: c.startMinutes ?? 0,
                      end: c.endMinutes ?? DAY_MINUTES,
                    },
              ),
            })),
        };
      }),
      appointments: rows.map((r) => toItem(r, view)),
    };
  }

  async get(tenant: TenantContext, id: string) {
    const row = await this.prisma.appointment.findFirst({
      where: { id, ...visibleAppointments(tenant) },
      select: detailSelect,
    });
    if (!row) throw appointmentNotFound();
    const view = await this.view(tenant);
    let position: { index: number; total: number } | null = null;
    if (row.seriesId) {
      const [before, total] = await Promise.all([
        this.prisma.appointment.count({
          where: { seriesId: row.seriesId, startAt: { lt: row.startAt } },
        }),
        this.prisma.appointment.count({ where: { seriesId: row.seriesId } }),
      ]);
      position = { index: before + 1, total };
    }
    return this.toDetail(row, view, position);
  }

  private toDetail(
    row: DetailRow,
    view: View,
    position: { index: number; total: number } | null,
  ) {
    const canSeeContact = view.tenant.permissions.includes('patients.read');
    return {
      ...toItem(row, view),
      bufferMinutes: row.bufferMinutes,
      internalNotes: row.internalNotes,
      cancellationNote: row.cancellationNote,
      /** Only for callers who can read patients */
      primaryContact: canSeeContact ? primaryContactOf(row.patient) : null,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      cancelledBy: row.cancelledBy,
      /** The assessment recording this booking, if any (status only; see assessments) */
      assessment: row.assessment,
      /** The package paying for it, if any, and whether it holds or used a session */
      package: packageCoverage(row),
      series: row.series && {
        id: row.series.id,
        status: row.series.status,
        rule: row.series.recurrenceRule,
        timezone: row.series.timezone,
        startsOn: formatIsoDate(row.series.startsOn),
        endsOn: formatIsoDate(row.series.endsOn),
        /** This appointment's place in the series, by start time */
        position,
      },
      history: row.history,
    };
  }

  // ── Availability ──────────────────────────────────────────────────────────

  /**
   * Start times a booking of the given length can take on one day, in order, after
   * every rule: schedules, closures, time off, other appointments, buffers, notice and
   * advance limits. A day without any explains why in `unavailable`.
   */
  async availableSlots(tenant: TenantContext, query: AvailableSlotsQuery) {
    const policy = await this.booking.policy(tenant);
    const date = this.booking.date(query.date, 'date');
    let keep: { therapyTypeId: string; durationMinutes: number } | undefined;
    if (query.excludeAppointmentId) {
      const current = await this.prisma.appointment.findFirst({
        where: {
          id: query.excludeAppointmentId,
          ...visibleAppointments(tenant),
        },
        select: { therapyTypeId: true, durationMinutes: true },
      });
      if (!current) throw appointmentNotFound();
      keep = current;
    }
    const sameType = keep?.therapyTypeId === query.therapyTypeId;
    const type = await this.booking.therapyType(tenant, query.therapyTypeId, {
      keepInactive: sameType,
    });
    this.booking.assertDuration(
      type,
      query.durationMinutes,
      policy,
      sameType ? keep?.durationMinutes : undefined,
    );
    const ctx = await this.booking.context(tenant, policy, {
      therapistId: query.therapistId,
      therapyTypeId: type.id,
      patientId: query.patientId,
      first: date,
      last: date,
    });
    const { slots, rejected } = daySlots(
      ctx,
      date,
      query.durationMinutes,
      policy.slotIntervalMinutes,
      query.excludeAppointmentId,
    );
    const reason = slots.length
      ? null
      : dayReason(ctx.days.get(formatIsoDate(date))!, rejected);
    return {
      date: formatIsoDate(date),
      timezone: policy.timeZone,
      durationMinutes: query.durationMinutes,
      slotIntervalMinutes: policy.slotIntervalMinutes,
      slots: slots.map((s) => ({
        startTime: formatClock(s.start),
        endTime: formatClock(s.end),
        startAt: s.startAt,
        endAt: s.endAt,
      })),
      unavailable: reason && {
        reason,
        message:
          reason === 'OUTSIDE_REGULAR_HOURS'
            ? `${ctx.therapistName} isn’t working on this day`
            : this.booking.describe(
                { reason },
                { therapist: ctx.therapistName, therapyType: type.name },
                policy,
              ),
      },
    };
  }

  // ── Booking ───────────────────────────────────────────────────────────────

  async create(tenant: TenantContext, dto: CreateAppointmentDto) {
    if (dto.packageEnrollmentId) assertCan(tenant, 'package_enrollments.read');
    const policy = await this.booking.policy(tenant);
    const date = this.booking.date(dto.date, 'date');
    const startAt = this.booking.instant(date, dto.startTime, policy.timeZone);
    const patient = await this.booking.patient(tenant, dto.patientId);
    const type = await this.booking.therapyType(tenant, dto.therapyTypeId);
    const therapist = await this.booking.therapist(
      tenant,
      dto.therapistId,
      type.id,
    );
    this.booking.assertDuration(type, dto.durationMinutes, policy);
    const endAt = new Date(startAt.getTime() + dto.durationMinutes * 60_000);
    const names = {
      therapist: therapist.fullName,
      patient: patient.fullName,
      therapyType: type.name,
    };
    const ids = { therapistId: therapist.id, patientId: patient.id };
    // Checked before taking locks, so most conflicts are reported cheaply…
    const ctx = await this.booking.context(tenant, policy, {
      ...ids,
      therapyTypeId: type.id,
      first: date,
      last: date,
    });
    this.booking.settle(
      evaluate(ctx, startAt, endAt),
      policy,
      names,
      dto.allowOverlap,
    );
    const range = this.booking.range(date, date, policy.timeZone);
    const id = await this.write(async (tx) => {
      // …and again under the locks, against bookings committed meanwhile. The overlap
      // constraints still catch anything that slips between.
      await lockTherapist(tx, therapist.id);
      await lockPatient(tx, patient.id);
      const fresh = await this.booking.refresh(tx, tenant, ctx, ids, range);
      const allowOverlap = this.booking.settle(
        evaluate(fresh, startAt, endAt),
        policy,
        names,
        dto.allowOverlap,
      );
      const row = await tx.appointment.create({
        data: {
          centerId: tenant.centerId,
          ...ids,
          therapyTypeId: type.id,
          type: dto.type,
          startAt,
          endAt,
          durationMinutes: dto.durationMinutes,
          bufferMinutes: policy.bufferMinutes,
          allowOverlap,
          internalNotes: dto.internalNotes ?? null,
          createdById: tenant.userId,
        },
        select: { id: true },
      });
      if (dto.packageEnrollmentId) {
        await this.attachPackage(tx, tenant, dto.packageEnrollmentId, policy, {
          appointmentId: row.id,
          patientId: patient.id,
          therapyTypeId: type.id,
          type: dto.type,
          startAt,
        });
      }
      await recordHistory(tx, tenant, {
        appointmentId: row.id,
        action: AppointmentHistoryAction.CREATED,
        newValues: {
          ...snapshot(
            {
              startAt,
              endAt,
              durationMinutes: dto.durationMinutes,
              status: AppointmentStatus.SCHEDULED,
              therapist,
              therapyType: type,
            },
            policy.timeZone,
          ),
          type: dto.type,
          allowOverlap,
          ...(dto.packageEnrollmentId && {
            packageEnrollmentId: dto.packageEnrollmentId,
          }),
        },
      });
      return row.id;
    });
    // After the booking has committed: billing never undoes it.
    await this.billing.appointmentBooked(tenant, id);
    return this.get(tenant, id);
  }

  /**
   * Holds a session of the enrollment for the appointment, then records the link. The
   * enrollment is checked (same center and patient, covered, valid, sessions free)
   * before the appointment points at it.
   */
  private async attachPackage(
    tx: Tx,
    tenant: TenantContext,
    enrollmentId: string,
    policy: SessionPolicy,
    session: BookedSession,
  ) {
    await this.packages.reserve(tx, tenant, enrollmentId, [session], policy);
    await tx.appointment.update({
      where: { id: session.appointmentId },
      data: { packageEnrollmentId: enrollmentId },
    });
  }

  /**
   * After a move: keeps the package if it still covers the appointment (left out), or
   * takes it off (null) or switches it (an ID). Returns whether the package changed.
   */
  private async repackage(
    tx: Tx,
    tenant: TenantContext,
    current: { packageEnrollmentId: string | null },
    change: string | null | undefined,
    policy: SessionPolicy,
    session: BookedSession,
  ) {
    if (change === undefined || change === current.packageEnrollmentId) {
      await this.packages.move(tx, tenant, session, policy);
      return false;
    }
    await this.packages.release(
      tx,
      tenant,
      session.appointmentId,
      PackageReleaseReason.REMOVED,
    );
    if (change) {
      await this.attachPackage(tx, tenant, change, policy, session);
    } else {
      await tx.appointment.update({
        where: { id: session.appointmentId },
        data: { packageEnrollmentId: null },
      });
    }
    return true;
  }

  /**
   * Chooses, changes or removes the package paying for an open appointment. The old
   * one's held session is given back; the new one must cover it like a new booking.
   */
  async setPackage(
    tenant: TenantContext,
    id: string,
    dto: ChangeAppointmentPackageDto,
  ) {
    const current = await this.current(tenant, id);
    if (!OPEN_STATUSES.includes(current.status)) {
      throw notOpen(current.status, 'changed');
    }
    const held = await this.prisma.packageSessionReservation.findFirst({
      where: { appointmentId: id, status: PackageReservationStatus.ACTIVE },
      select: { enrollmentId: true },
    });
    if (
      dto.packageEnrollmentId === current.packageEnrollmentId &&
      (held?.enrollmentId ?? null) === dto.packageEnrollmentId
    ) {
      return this.get(tenant, id);
    }
    const policy = await this.booking.policy(tenant);
    await this.prisma.$transaction(async (tx) => {
      // Same lock order as booking: patient, appointment, then enrollments.
      await lockPatient(tx, current.patientId);
      await lockAppointment(tx, id);
      const { count } = await tx.appointment.updateMany({
        where: {
          id,
          centerId: tenant.centerId,
          status: current.status,
          startAt: current.startAt,
        },
        data: { updatedById: tenant.userId },
      });
      if (!count) throw changedMeanwhile();
      await this.packages.release(tx, tenant, id, PackageReleaseReason.REMOVED);
      if (dto.packageEnrollmentId) {
        await this.attachPackage(tx, tenant, dto.packageEnrollmentId, policy, {
          appointmentId: id,
          patientId: current.patientId,
          therapyTypeId: current.therapyTypeId,
          type: current.type,
          startAt: current.startAt,
        });
      } else {
        await tx.appointment.update({
          where: { id },
          data: { packageEnrollmentId: null },
        });
      }
      await recordHistory(tx, tenant, {
        appointmentId: id,
        action: AppointmentHistoryAction.UPDATED,
        previousValues: { packageEnrollmentId: current.packageEnrollmentId },
        newValues: {
          fields: ['package'],
          packageEnrollmentId: dto.packageEnrollmentId,
        },
      });
    });
    return this.get(tenant, id);
  }

  /** An appointment the caller can see, with what changes need to compare against. */
  private async current(tenant: TenantContext, id: string) {
    const row = await this.prisma.appointment.findFirst({
      where: { id, ...visibleAppointments(tenant) },
      select: {
        id: true,
        status: true,
        type: true,
        internalNotes: true,
        patientId: true,
        therapistId: true,
        therapyTypeId: true,
        startAt: true,
        endAt: true,
        durationMinutes: true,
        packageEnrollmentId: true,
        therapist: { select: { id: true, fullName: true } },
        therapyType: { select: { id: true, name: true } },
        attendance: { select: { status: true } },
      },
    });
    if (!row) throw appointmentNotFound();
    return row;
  }

  /** Internal notes and the appointment type; nothing that affects the schedule. */
  async update(tenant: TenantContext, id: string, dto: UpdateAppointmentDto) {
    const current = await this.current(tenant, id);
    if (current.status === AppointmentStatus.CANCELLED) {
      throw notOpen(current.status, 'edited');
    }
    const data: Prisma.AppointmentUpdateManyMutationInput = {};
    if (dto.type !== undefined && dto.type !== current.type)
      data.type = dto.type;
    if (
      dto.internalNotes !== undefined &&
      dto.internalNotes !== current.internalNotes
    ) {
      data.internalNotes = dto.internalNotes;
    }
    const fields = Object.keys(data);
    if (!fields.length) return this.get(tenant, id);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.appointment.updateMany({
        where: { id, centerId: tenant.centerId, status: current.status },
        data: { ...data, updatedById: tenant.userId },
      });
      if (!count) throw changedMeanwhile();
      // Note text can hold health details, so history only names the changed fields.
      await recordHistory(tx, tenant, {
        appointmentId: id,
        action: AppointmentHistoryAction.UPDATED,
        previousValues: data.type ? { type: current.type } : undefined,
        newValues: { fields, ...(data.type && { type: data.type }) },
      });
    });
    return this.get(tenant, id);
  }

  /**
   * Moves one appointment, optionally to another therapist, length or therapy, keeping
   * its ID, series and history. The new time is checked like a new booking. A confirmed
   * appointment goes back to scheduled, since the new time hasn't been confirmed.
   */
  async reschedule(
    tenant: TenantContext,
    id: string,
    dto: RescheduleAppointmentDto,
  ) {
    const current = await this.current(tenant, id);
    if (!OPEN_STATUSES.includes(current.status)) {
      throw notOpen(current.status, 'rescheduled');
    }
    const therapyTypeId = dto.therapyTypeId ?? current.therapyTypeId;
    const sameType = therapyTypeId === current.therapyTypeId;
    if (!sameType) assertCan(tenant, 'appointments.update');
    const packageChange = dto.packageEnrollmentId;
    if (packageChange !== undefined) {
      assertCan(tenant, 'package_enrollments.read');
    }
    const policy = await this.booking.policy(tenant);
    const date = this.booking.date(dto.date, 'date');
    const startAt = this.booking.instant(date, dto.startTime, policy.timeZone);
    // The patient already has this booking, so an inactive one can still be moved.
    const patient = await this.booking.patient(tenant, current.patientId, {
      allowInactive: true,
    });
    const type = await this.booking.therapyType(tenant, therapyTypeId, {
      keepInactive: sameType,
    });
    const therapist = await this.booking.therapist(
      tenant,
      dto.therapistId ?? current.therapistId,
      type.id,
    );
    const durationMinutes = dto.durationMinutes ?? current.durationMinutes;
    this.booking.assertDuration(
      type,
      durationMinutes,
      policy,
      sameType ? current.durationMinutes : undefined,
    );
    const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
    // Attendance belongs to the day the patient came; moving that to another day would
    // leave it describing a visit that didn't happen then.
    if (
      current.attendance &&
      attended(current.attendance.status) &&
      localTimes(startAt, endAt, policy.timeZone).date !==
        localTimes(current.startAt, current.endAt, policy.timeZone).date
    ) {
      throw apiError(
        HttpStatus.CONFLICT,
        'The patient has already arrived for this appointment, so it can only move within the same day. Correct the attendance first if that was a mistake.',
        'ATTENDANCE_RECORDED',
      );
    }
    if (
      startAt.getTime() === current.startAt.getTime() &&
      durationMinutes === current.durationMinutes &&
      therapist.id === current.therapistId &&
      sameType
    ) {
      // Only the package changed: that has its own operation.
      if (
        packageChange !== undefined &&
        packageChange !== current.packageEnrollmentId
      ) {
        return this.setPackage(tenant, id, {
          packageEnrollmentId: packageChange,
        });
      }
      return this.get(tenant, id);
    }
    const names = {
      therapist: therapist.fullName,
      patient: patient.fullName,
      therapyType: type.name,
    };
    const ids = { therapistId: therapist.id, patientId: patient.id };
    const ctx = await this.booking.context(tenant, policy, {
      ...ids,
      therapyTypeId: type.id,
      first: date,
      last: date,
    });
    this.booking.settle(
      evaluate(ctx, startAt, endAt, id),
      policy,
      names,
      dto.allowOverlap,
    );
    const range = this.booking.range(date, date, policy.timeZone);
    await this.write(async (tx) => {
      await lockTherapist(tx, therapist.id);
      await lockPatient(tx, patient.id);
      const fresh = await this.booking.refresh(tx, tenant, ctx, ids, range);
      const allowOverlap = this.booking.settle(
        evaluate(fresh, startAt, endAt, id),
        policy,
        names,
        dto.allowOverlap,
      );
      await lockAppointment(tx, id);
      const { count } = await tx.appointment.updateMany({
        where: {
          id,
          centerId: tenant.centerId,
          status: current.status,
          startAt: current.startAt,
          therapistId: current.therapistId,
        },
        data: {
          startAt,
          endAt,
          durationMinutes,
          therapistId: therapist.id,
          therapyTypeId: type.id,
          bufferMinutes: policy.bufferMinutes,
          allowOverlap,
          status: AppointmentStatus.SCHEDULED,
          updatedById: tenant.userId,
        },
      });
      if (!count) throw changedMeanwhile();
      // The held package session moves with it, or the package changes as asked.
      const repackaged = await this.repackage(
        tx,
        tenant,
        current,
        packageChange,
        policy,
        {
          appointmentId: id,
          patientId: patient.id,
          therapyTypeId: type.id,
          type: current.type,
          startAt,
        },
      );
      await recordHistory(tx, tenant, {
        appointmentId: id,
        action: AppointmentHistoryAction.RESCHEDULED,
        previousValues: {
          ...snapshot(current, policy.timeZone),
          ...(repackaged && {
            packageEnrollmentId: current.packageEnrollmentId,
          }),
        },
        newValues: {
          ...snapshot(
            {
              startAt,
              endAt,
              durationMinutes,
              status: AppointmentStatus.SCHEDULED,
              therapist,
              therapyType: type,
            },
            policy.timeZone,
          ),
          ...(repackaged && { packageEnrollmentId: packageChange }),
        },
        reason: dto.reason,
      });
    });
    return this.get(tenant, id);
  }

  /**
   * Cancels without deleting: the row, its history and its place in any series stay.
   * Inside the center's cutoff it counts as late and needs appointments.cancel_late.
   * A held package session is given back, or charged when the package charges late
   * cancellations and this one is late. Payments aren't touched.
   */
  async cancel(tenant: TenantContext, id: string, dto: CancelAppointmentDto) {
    const current = await this.current(tenant, id);
    if (!OPEN_STATUSES.includes(current.status)) {
      throw notOpen(current.status, 'cancelled');
    }
    const policy = await this.booking.policy(tenant);
    const now = new Date();
    const late = isLateCancellation(
      current.startAt,
      now,
      policy.cancellationCutoffMinutes,
    );
    if (late) assertLateCancellation(tenant, policy);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.appointment.updateMany({
        where: { id, centerId: tenant.centerId, status: current.status },
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
      if (!count) throw changedMeanwhile();
      await this.packages.settle(tx, tenant, id, 'CANCELLED', { late });
      await recordHistory(tx, tenant, {
        appointmentId: id,
        action: AppointmentHistoryAction.CANCELLED,
        previousValues: { status: current.status },
        newValues: {
          status: AppointmentStatus.CANCELLED,
          cancellationReason: dto.reason,
          lateCancellation: late,
        },
        reason: dto.note,
      });
    });
    return this.get(tenant, id);
  }

  /**
   * Confirm, complete or mark a no-show, following the allowed transitions (rules.ts).
   * Completing and no-shows belong to the session lifecycle (sessions.port.ts):
   * completing needs the patient present or late (given here when not marked) and uses
   * the held package session; a no-show marks them absent and uses the session only if
   * the package charges no-shows, giving it back otherwise.
   */
  async setStatus(
    tenant: TenantContext,
    id: string,
    dto: ChangeAppointmentStatusDto,
  ) {
    const current = await this.current(tenant, id);
    if (current.status === dto.status) return this.get(tenant, id);
    if (!canTransition(current.status, dto.status)) {
      throw apiError(
        HttpStatus.CONFLICT,
        `A ${STATUS_LABELS[current.status]} appointment can’t be marked ${STATUS_LABELS[dto.status]}.`,
        'INVALID_STATUS_TRANSITION',
      );
    }
    if (needsStarted(dto.status) && current.startAt > new Date()) {
      throw apiError(
        HttpStatus.CONFLICT,
        `It can be marked ${STATUS_LABELS[dto.status]} once it has started.`,
        'APPOINTMENT_NOT_STARTED',
      );
    }
    if (dto.status === AppointmentStatus.COMPLETED) {
      assertCan(tenant, 'sessions.complete');
      await this.sessions.complete(tenant, id, { attendance: dto.attendance });
      return this.get(tenant, id);
    }
    if (dto.status === AppointmentStatus.NO_SHOW) {
      assertCan(tenant, 'attendance.record');
      if (current.attendance && attended(current.attendance.status)) {
        throw apiError(
          HttpStatus.CONFLICT,
          `The patient was marked ${current.attendance.status === AttendanceStatus.LATE ? 'late' : 'present'}. Change their attendance to absent if they didn’t come.`,
          'ATTENDANCE_RECORDED',
        );
      }
      await this.sessions.markAbsent(tenant, id);
      return this.get(tenant, id);
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.appointment.updateMany({
        where: { id, centerId: tenant.centerId, status: current.status },
        data: { status: dto.status, updatedById: tenant.userId },
      });
      if (!count) throw changedMeanwhile();
      await recordHistory(tx, tenant, {
        appointmentId: id,
        action: AppointmentHistoryAction.STATUS_CHANGED,
        previousValues: { status: current.status },
        newValues: { status: dto.status },
      });
    });
    return this.get(tenant, id);
  }
}

/** Late cancellations need appointments.cancel_late. */
export function assertLateCancellation(tenant: TenantContext, policy: Policy) {
  if (tenant.permissions.includes('appointments.cancel_late')) return;
  throw apiError(
    HttpStatus.FORBIDDEN,
    `This appointment starts within the ${durationText(policy.cancellationCutoffMinutes)} cancellation cutoff. Ask a manager to cancel it.`,
    'LATE_CANCELLATION_NOT_ALLOWED',
  );
}
