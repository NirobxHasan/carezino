import { HttpStatus, Injectable } from '@nestjs/common';

import {
  localTimes,
  lockPatient,
  recordHistory,
} from '../appointments/appointments.service';
import { overlapViolation, slotTaken } from '../appointments/booking.service';
import { OPEN_STATUSES } from '../appointments/rules';
import type { SessionOutcomes } from '../appointments/sessions.port';
import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { SettingsService } from '../center-settings/settings.service';
import { isUniqueViolation } from '../centers/centers.service';
import { apiError } from '../common/errors';
import {
  addDays,
  formatIsoDate,
  parseClock,
  parseIsoDate,
  todayIn,
  zonedToInstant,
} from '../common/time';
import type { Prisma } from '../generated/prisma/client';
import {
  AppointmentHistoryAction,
  AppointmentStatus,
  AppointmentType,
  AttendanceStatus,
  CancellationReason,
  PackageLedgerMovement,
  TherapyPlanStatus,
  TherapySessionStatus,
} from '../generated/prisma/enums';
import { PackageSessions } from '../packages/sessions.service';
import { assertCan } from '../patients/access';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import { lockTherapist } from '../therapists/access';
import { sessionNotFound, visibleSessions } from './access';
import type {
  CheckInDto,
  CompleteSessionDto,
  CorrectSessionDto,
  RecordAttendanceDto,
} from './dto';
import {
  attendanceOf,
  attendanceTimeErrors,
  attended,
  completionRefusal,
  isOpen,
  planAttendance,
} from './rules';
import {
  changedMeanwhile,
  lockAppointment,
  notTherapySession,
  refused,
  type Db,
  type Tx,
} from './shared';

/** What attendance and session writes check about an appointment. */
const stateSelect = {
  id: true,
  type: true,
  status: true,
  startAt: true,
  endAt: true,
  patientId: true,
  therapistId: true,
  therapyTypeId: true,
  packageEnrollmentId: true,
  patient: { select: { code: true } },
  therapist: { select: { id: true, fullName: true, membershipId: true } },
  attendance: {
    select: {
      status: true,
      checkInAt: true,
      actualStartAt: true,
      actualEndAt: true,
      note: true,
      revision: true,
    },
  },
  session: { select: { status: true, therapyPlanId: true } },
} satisfies Prisma.AppointmentSelect;

export type SessionState = Prisma.AppointmentGetPayload<{
  select: typeof stateSelect;
}>;

type AttendanceRow = NonNullable<SessionState['attendance']>;

interface AttendanceValues {
  status: AttendanceStatus;
  checkInAt: Date | null;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  note: string | null;
}

/** A requested change: left-out values keep what's recorded, null clears. */
interface AttendanceChange {
  status: AttendanceStatus;
  checkInAt?: Date | null;
  actualStartAt?: Date | null;
  actualEndAt?: Date | null;
  note?: string | null;
  reason?: string;
  revision?: number;
}

const TIME_FIELDS = ['checkInAt', 'actualStartAt', 'actualEndAt'] as const;

const STATUS_WORDS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'scheduled',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'a no-show',
};

const invalid = (errors: Record<string, string>) =>
  apiError(
    HttpStatus.BAD_REQUEST,
    'Please check the highlighted fields',
    'VALIDATION_FAILED',
    errors,
  );

/** Attendance as history records it: statuses and times, never the note's text. */
function attendanceSnapshot(a: AttendanceValues | null) {
  return {
    attendance: a?.status ?? AttendanceStatus.NOT_MARKED,
    checkInAt: a?.checkInAt?.toISOString() ?? null,
    actualStartAt: a?.actualStartAt?.toISOString() ?? null,
    actualEndAt: a?.actualEndAt?.toISOString() ?? null,
  };
}

const sameTime = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * Attendance and the session lifecycle of appointments: checking in, recording and
 * correcting attendance, starting, completing and voiding sessions. Each change is one
 * transaction with the appointment row locked (lock order: therapist, patient,
 * appointment, enrollment, as in booking), records AppointmentHistory, and moves the
 * appointment's status and its held package session together:
 *
 * - ABSENT is the attendance of a NO_SHOW appointment: recording one sets the other,
 *   and the package settles the no-show by its own policy.
 * - Completing needs PRESENT or LATE and charges the held package session. It's the
 *   only way an appointment becomes COMPLETED (the appointments module calls it too).
 * - A completed session is never reopened: voiding it reverses its package charge, and
 *   an appointment is charged at most once (packages migration).
 */
@Injectable()
export class SessionLifecycle implements SessionOutcomes {
  constructor(
    private readonly prisma: PrismaService,
    private readonly packages: PackageSessions,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async center(tenant: TenantContext) {
    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: { timezone: true },
    });
    const now = new Date();
    return {
      timeZone: center.timezone,
      now,
      today: formatIsoDate(todayIn(center.timezone, now)),
    };
  }

  async load(db: Db, tenant: TenantContext, id: string) {
    const row = await db.appointment.findFirst({
      where: { id, ...visibleSessions(tenant) },
      select: stateSelect,
    });
    if (!row) throw sessionNotFound();
    return row;
  }

  /** The patient's open (active or paused) plan for a therapy: at most one exists. */
  openPlan(
    db: Db,
    tenant: TenantContext,
    patientId: string,
    therapyTypeId: string,
  ) {
    return db.therapyPlan.findFirst({
      where: {
        centerId: tenant.centerId,
        patientId,
        therapyTypeId,
        status: { in: [TherapyPlanStatus.ACTIVE, TherapyPlanStatus.PAUSED] },
      },
      select: { id: true },
    });
  }

  /** Runs a write, turning the database's overlap and uniqueness checks into 409s. */
  private async write<T>(fn: (tx: Tx) => Promise<T>) {
    try {
      return await this.prisma.$transaction(fn);
    } catch (error) {
      const which = overlapViolation(error);
      if (which) throw slotTaken(which);
      // Two first recordings of the same appointment's attendance or session.
      if (isUniqueViolation(error)) throw changedMeanwhile();
      throw error;
    }
  }

  // ── Attendance ────────────────────────────────────────────────────────────

  /**
   * Records the patient's arrival now, today only: present, or late when asked (there's
   * no automatic lateness rule). Doesn't complete anything or touch packages. Checking
   * in twice changes nothing.
   */
  async checkIn(
    tenant: TenantContext,
    id: string,
    dto: CheckInDto,
    ip: string | null,
  ) {
    const row = await this.load(this.prisma, tenant, id);
    const { now, today, timeZone } = await this.center(tenant);
    if (!isOpen(row.status)) {
      throw apiError(
        HttpStatus.CONFLICT,
        `This appointment is ${STATUS_WORDS[row.status]}, so the patient can’t be checked in.`,
        'INVALID_STATUS_TRANSITION',
      );
    }
    if (localTimes(row.startAt, row.endAt, timeZone).date !== today) {
      throw apiError(
        HttpStatus.CONFLICT,
        'Patients can be checked in on the day of their appointment. Record attendance instead.',
        'CHECK_IN_NOT_TODAY',
      );
    }
    if (row.attendance?.checkInAt) return;
    const current = attendanceOf(row.status, row.attendance?.status);
    const status = dto.late
      ? AttendanceStatus.LATE
      : attended(current)
        ? current
        : AttendanceStatus.PRESENT;
    await this.changeAttendance(tenant, row, { status, checkInAt: now }, ip);
  }

  /** A no-show marked from the appointment: absent attendance, by the same rules. */
  async markAbsent(tenant: TenantContext, id: string) {
    const row = await this.load(this.prisma, tenant, id);
    await this.changeAttendance(
      tenant,
      row,
      { status: AttendanceStatus.ABSENT },
      null,
    );
  }

  async recordAttendance(
    tenant: TenantContext,
    id: string,
    dto: RecordAttendanceDto,
    ip: string | null,
  ) {
    const row = await this.load(this.prisma, tenant, id);
    const { timeZone } = await this.center(tenant);
    // Times are the center's wall clock on the appointment's own date.
    const day = parseIsoDate(
      localTimes(row.startAt, row.endAt, timeZone).date,
    )!;
    const instant = (v: string | null | undefined) =>
      v === undefined || v === null
        ? v
        : zonedToInstant(day, parseClock(v)!, timeZone);
    await this.changeAttendance(
      tenant,
      row,
      {
        status: dto.status,
        checkInAt: instant(dto.checkInTime),
        actualStartAt: instant(dto.actualStartTime),
        actualEndAt: instant(dto.actualEndTime),
        note: dto.note,
        reason: dto.reason,
        revision: dto.revision,
      },
      ip,
    );
  }

  /**
   * Applies an attendance change by the rules (rules.ts planAttendance): while the
   * appointment is open, routinely; after it closed, as a correction with a reason.
   * Marking absent makes the appointment a no-show; correcting a no-show to present or
   * late reopens it (if its no-show wasn't charged), holding its package session again.
   */
  private async changeAttendance(
    tenant: TenantContext,
    row: SessionState,
    change: AttendanceChange,
    ip: string | null,
  ) {
    const { now, today, timeZone } = await this.center(tenant);
    const { date } = localTimes(row.startAt, row.endAt, timeZone);
    const current = attendanceOf(row.status, row.attendance?.status);
    const plan = planAttendance({
      appointmentStatus: row.status,
      current,
      next: change.status,
      started: row.startAt <= now,
      dueOrPast: date <= today,
    });
    if (!plan.ok) throw refused(plan);
    if (
      change.revision !== undefined &&
      row.attendance &&
      row.attendance.revision !== change.revision
    ) {
      throw changedMeanwhile();
    }

    const prev: AttendanceValues | null = row.attendance;
    const keep = <T>(value: T | undefined, recorded: T) =>
      value === undefined ? recorded : value;
    const next: AttendanceValues = {
      status: change.status,
      checkInAt: keep(change.checkInAt, prev?.checkInAt ?? null),
      actualStartAt: keep(change.actualStartAt, prev?.actualStartAt ?? null),
      actualEndAt: keep(change.actualEndAt, prev?.actualEndAt ?? null),
      note: keep(change.note, prev?.note ?? null),
    };
    if (attended(next.status)) {
      const day = parseIsoDate(date)!;
      const errors = attendanceTimeErrors(next, {
        now,
        dayStart: zonedToInstant(day, 0, timeZone),
        dayEnd: zonedToInstant(addDays(day, 1), 0, timeZone),
      });
      if (Object.keys(errors).length) {
        throw invalid(
          Object.fromEntries(
            Object.entries(errors).map(([k, m]) => [
              k.replace(/At$/, 'Time'),
              m,
            ]),
          ),
        );
      }
    } else {
      const given = TIME_FIELDS.find((k) => change[k]);
      if (given) {
        throw invalid({
          [given.replace(/At$/, 'Time')]:
            'Only attended sessions have arrival and session times',
        });
      }
      for (const k of TIME_FIELDS) next[k] = null;
    }
    const changed = [
      ...(next.status !== current ? ['status'] : []),
      ...TIME_FIELDS.filter((k) => !sameTime(next[k], prev?.[k] ?? null)),
      ...(next.note !== (prev?.note ?? null) ? ['note'] : []),
    ];
    // Nothing new, e.g. the same button pressed twice.
    if (!changed.length) return;
    if (plan.correction) {
      assertCan(tenant, 'attendance.correct');
      if (!change.reason) {
        throw fieldError(
          'reason',
          'Say why the attendance is being corrected',
          'VALIDATION_FAILED',
        );
      }
    }

    await this.write(async (tx) => {
      if (plan.appointment === 'REOPEN') {
        // Reopening holds the time again, like booking: same locks, same order.
        await lockTherapist(tx, row.therapistId);
        await lockPatient(tx, row.patientId);
      }
      await lockAppointment(tx, row.id);
      const fresh = await tx.appointment.findFirst({
        where: { id: row.id, centerId: tenant.centerId },
        select: { status: true, attendance: { select: { revision: true } } },
      });
      if (
        fresh?.status !== row.status ||
        (fresh.attendance?.revision ?? 0) !== (row.attendance?.revision ?? 0)
      ) {
        throw changedMeanwhile();
      }
      await this.writeAttendance(tx, tenant, row.id, row.attendance, next, now);
      await recordHistory(tx, tenant, {
        appointmentId: row.id,
        action: plan.correction
          ? AppointmentHistoryAction.ATTENDANCE_CORRECTED
          : AppointmentHistoryAction.ATTENDANCE_RECORDED,
        previousValues: attendanceSnapshot(prev),
        newValues: { ...attendanceSnapshot(next), fields: changed },
        reason: change.reason,
      });
      if (plan.appointment === 'NO_SHOW') {
        await this.markNoShow(tx, tenant, row);
      } else if (plan.appointment === 'REOPEN') {
        await this.reopen(tx, tenant, row, change.reason!);
      }
      if (plan.correction) {
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: 'attendance.corrected',
            entityType: 'Appointment',
            entityId: row.id,
            metadata: {
              patientCode: row.patient.code,
              from: current,
              to: next.status,
              fields: changed,
              reopened: plan.appointment === 'REOPEN',
            },
            ipAddress: ip,
          },
          tx,
        );
      }
    });
  }

  private async writeAttendance(
    tx: Tx,
    tenant: TenantContext,
    appointmentId: string,
    recorded: Pick<AttendanceRow, 'revision'> | null,
    values: AttendanceValues,
    now: Date,
  ) {
    const data = {
      ...values,
      recordedById: tenant.userId,
      recordedAt: now,
    };
    if (!recorded) {
      await tx.sessionAttendance.create({
        data: { appointmentId, centerId: tenant.centerId, ...data },
      });
      return;
    }
    const { count } = await tx.sessionAttendance.updateMany({
      where: { appointmentId, revision: recorded.revision },
      data: { ...data, revision: { increment: 1 } },
    });
    if (!count) throw changedMeanwhile();
  }

  /** Absent: the appointment is a no-show, and the package settles it by its policy. */
  private async markNoShow(tx: Tx, tenant: TenantContext, row: SessionState) {
    const { count } = await tx.appointment.updateMany({
      where: {
        id: row.id,
        centerId: tenant.centerId,
        status: { in: OPEN_STATUSES },
      },
      data: { status: AppointmentStatus.NO_SHOW, updatedById: tenant.userId },
    });
    if (!count) throw changedMeanwhile();
    await this.packages.settle(tx, tenant, row.id, 'NO_SHOW');
    await recordHistory(tx, tenant, {
      appointmentId: row.id,
      action: AppointmentHistoryAction.STATUS_CHANGED,
      previousValues: { status: row.status },
      newValues: { status: AppointmentStatus.NO_SHOW },
    });
  }

  /**
   * A no-show who came after all: the appointment is scheduled again (its time must
   * still be free) and its package holds a session again. Refused when the no-show was
   * charged or its session voided, since an appointment is charged at most once.
   */
  private async reopen(
    tx: Tx,
    tenant: TenantContext,
    row: SessionState,
    reason: string,
  ) {
    const charged = await tx.packageSessionLedger.findFirst({
      where: {
        appointmentId: row.id,
        movement: PackageLedgerMovement.SESSION_CONSUMPTION,
      },
      select: { id: true },
    });
    if (charged || row.session?.status === TherapySessionStatus.VOIDED) {
      throw apiError(
        HttpStatus.CONFLICT,
        charged
          ? 'This no-show was charged to a package, so the appointment can’t be reopened. Book a new appointment instead.'
          : 'This session was voided, so the appointment can’t be reopened. Book a new appointment instead.',
        'APPOINTMENT_CANNOT_REOPEN',
      );
    }
    const { count } = await tx.appointment.updateMany({
      where: {
        id: row.id,
        centerId: tenant.centerId,
        status: AppointmentStatus.NO_SHOW,
      },
      data: { status: AppointmentStatus.SCHEDULED, updatedById: tenant.userId },
    });
    if (!count) throw changedMeanwhile();
    if (row.packageEnrollmentId) {
      const center = await tx.center.findUniqueOrThrow({
        where: { id: tenant.centerId },
        select: { timezone: true },
      });
      const general = await this.settings.getGeneral(tenant);
      await this.packages.reserve(
        tx,
        tenant,
        row.packageEnrollmentId,
        [
          {
            appointmentId: row.id,
            patientId: row.patientId,
            therapyTypeId: row.therapyTypeId,
            type: row.type,
            startAt: row.startAt,
          },
        ],
        { timeZone: center.timezone, weekStartsOn: general.weekStartsOn },
      );
    }
    await recordHistory(tx, tenant, {
      appointmentId: row.id,
      action: AppointmentHistoryAction.STATUS_CHANGED,
      previousValues: { status: AppointmentStatus.NO_SHOW },
      newValues: { status: AppointmentStatus.SCHEDULED },
      reason,
    });
  }

  // ── Session ───────────────────────────────────────────────────────────────

  /**
   * Starts a therapy session explicitly (it also starts when its note is first opened).
   * From the appointment's day on, while it's open. Starting twice changes nothing.
   */
  async start(tenant: TenantContext, id: string) {
    const row = await this.load(this.prisma, tenant, id);
    if (row.type !== AppointmentType.THERAPY_SESSION) throw notTherapySession();
    if (row.session) return;
    const { now, today, timeZone } = await this.center(tenant);
    if (!isOpen(row.status)) {
      throw apiError(
        HttpStatus.CONFLICT,
        `This appointment is ${STATUS_WORDS[row.status]}, so its session can’t start.`,
        'INVALID_STATUS_TRANSITION',
      );
    }
    if (localTimes(row.startAt, row.endAt, timeZone).date > today) {
      throw apiError(
        HttpStatus.CONFLICT,
        'A session can start on the day of its appointment.',
        'APPOINTMENT_NOT_DUE',
      );
    }
    try {
      await this.prisma.$transaction((tx) =>
        this.ensureSession(tx, tenant, row, now),
      );
    } catch (error) {
      // Started by someone else at the same moment: that's fine.
      if (!isUniqueViolation(error)) throw error;
    }
  }

  /**
   * The session row, started now if it wasn't, linked to the patient's open plan for
   * the therapy. For a voided session, null. Call inside the writing transaction.
   */
  async ensureSession(
    tx: Tx,
    tenant: TenantContext,
    row: Pick<SessionState, 'id' | 'patientId' | 'therapyTypeId'>,
    now: Date,
  ) {
    const existing = await tx.therapySession.findUnique({
      where: { appointmentId: row.id },
      select: { status: true, therapyPlanId: true },
    });
    if (existing?.status === TherapySessionStatus.VOIDED) return null;
    if (existing) {
      if (existing.therapyPlanId) return existing;
      const plan = await this.openPlan(
        tx,
        tenant,
        row.patientId,
        row.therapyTypeId,
      );
      if (!plan) return existing;
      await tx.therapySession.update({
        where: { appointmentId: row.id },
        data: { therapyPlanId: plan.id },
      });
      return { ...existing, therapyPlanId: plan.id };
    }
    const plan = await this.openPlan(
      tx,
      tenant,
      row.patientId,
      row.therapyTypeId,
    );
    const created = await tx.therapySession.create({
      data: {
        appointmentId: row.id,
        centerId: tenant.centerId,
        status: TherapySessionStatus.IN_PROGRESS,
        startedAt: now,
        startedById: tenant.userId,
        therapyPlanId: plan?.id ?? null,
      },
      select: { status: true, therapyPlanId: true },
    });
    await recordHistory(tx, tenant, {
      appointmentId: row.id,
      action: AppointmentHistoryAction.SESSION_STARTED,
    });
    return created;
  }

  /**
   * Completes the session: the appointment becomes COMPLETED, its held package session
   * is charged (by PackageSessions.settle, in the same transaction) and a therapy
   * session records who completed it. Needs PRESENT or LATE attendance, which may be
   * given with the request when it isn't marked. The note may still be a draft: it's
   * shown as pending until signed off. Idempotent: completing a completed session (or
   * two requests at once) changes nothing and charges once.
   */
  async complete(tenant: TenantContext, id: string, dto: CompleteSessionDto) {
    const row = await this.load(this.prisma, tenant, id);
    if (row.status === AppointmentStatus.COMPLETED) return;
    const { now } = await this.center(tenant);
    const attendance = attendanceOf(row.status, row.attendance?.status);
    if (dto.attendance && !attended(attendance)) {
      assertCan(tenant, 'attendance.record');
    }
    const refusal = completionRefusal({
      appointmentStatus: row.status,
      attendance,
      started: row.startAt <= now,
      attendanceGiven: dto.attendance !== undefined,
    });
    if (refusal) throw refused(refusal);

    await this.write(async (tx) => {
      await lockAppointment(tx, row.id);
      const fresh = await tx.appointment.findFirst({
        where: { id: row.id, centerId: tenant.centerId },
        select: {
          status: true,
          attendance: { select: stateSelect.attendance.select },
        },
      });
      // Completed by a request that got here first: nothing left to do.
      if (fresh?.status === AppointmentStatus.COMPLETED) return;
      if (!fresh || !isOpen(fresh.status)) throw changedMeanwhile();
      const recorded = attendanceOf(fresh.status, fresh.attendance?.status);
      if (!attended(recorded)) {
        // It was attended when checked above, so someone changed it meanwhile.
        if (!dto.attendance) throw changedMeanwhile();
        const next: AttendanceValues = {
          status: dto.attendance,
          checkInAt: null,
          actualStartAt: null,
          actualEndAt: null,
          note: fresh.attendance?.note ?? null,
        };
        await this.writeAttendance(
          tx,
          tenant,
          row.id,
          fresh.attendance,
          next,
          now,
        );
        await recordHistory(tx, tenant, {
          appointmentId: row.id,
          action: AppointmentHistoryAction.ATTENDANCE_RECORDED,
          previousValues: attendanceSnapshot(fresh.attendance),
          newValues: { ...attendanceSnapshot(next), fields: ['status'] },
        });
      }
      const { count } = await tx.appointment.updateMany({
        where: {
          id: row.id,
          centerId: tenant.centerId,
          status: { in: OPEN_STATUSES },
        },
        data: {
          status: AppointmentStatus.COMPLETED,
          updatedById: tenant.userId,
        },
      });
      if (!count) throw changedMeanwhile();
      await this.packages.settle(tx, tenant, row.id, 'COMPLETED');
      if (row.type === AppointmentType.THERAPY_SESSION) {
        await this.completeSession(tx, tenant, row, now);
      }
      await recordHistory(tx, tenant, {
        appointmentId: row.id,
        action: AppointmentHistoryAction.STATUS_CHANGED,
        previousValues: { status: fresh.status },
        newValues: { status: AppointmentStatus.COMPLETED },
      });
    });
  }

  private async completeSession(
    tx: Tx,
    tenant: TenantContext,
    row: SessionState,
    now: Date,
  ) {
    const existing = await tx.therapySession.findUnique({
      where: { appointmentId: row.id },
      select: { status: true, therapyPlanId: true },
    });
    const plan =
      existing?.therapyPlanId ??
      (await this.openPlan(tx, tenant, row.patientId, row.therapyTypeId))?.id ??
      null;
    const completion = {
      status: TherapySessionStatus.COMPLETED,
      completedAt: now,
      completedById: tenant.userId,
      therapyPlanId: plan,
    };
    if (!existing) {
      await tx.therapySession.create({
        data: {
          appointmentId: row.id,
          centerId: tenant.centerId,
          ...completion,
        },
      });
    } else if (existing.status === TherapySessionStatus.IN_PROGRESS) {
      await tx.therapySession.update({
        where: { appointmentId: row.id },
        data: completion,
      });
    } else {
      throw changedMeanwhile();
    }
  }

  /**
   * Voids a session that was completed by mistake, with a reason. What really happened
   * decides the appointment's status: NOT_ATTENDED makes it a no-show (attendance
   * absent), NOT_DELIVERED cancels it. Its package charge is reversed through the
   * ledger, never charged again, and the note (if any) stays as it is.
   */
  async correct(
    tenant: TenantContext,
    id: string,
    dto: CorrectSessionDto,
    ip: string | null,
  ) {
    const row = await this.load(this.prisma, tenant, id);
    if (row.status !== AppointmentStatus.COMPLETED) {
      throw apiError(
        HttpStatus.CONFLICT,
        'Only completed sessions can be corrected.',
        'SESSION_NOT_COMPLETED',
      );
    }
    const { now } = await this.center(tenant);
    const notAttended = dto.outcome === 'NOT_ATTENDED';
    const status = notAttended
      ? AppointmentStatus.NO_SHOW
      : AppointmentStatus.CANCELLED;
    await this.write(async (tx) => {
      await lockAppointment(tx, row.id);
      const { count } = await tx.appointment.updateMany({
        where: {
          id: row.id,
          centerId: tenant.centerId,
          status: AppointmentStatus.COMPLETED,
        },
        data: notAttended
          ? { status, updatedById: tenant.userId }
          : {
              status,
              cancelledAt: now,
              cancelledById: tenant.userId,
              cancellationReason: CancellationReason.OTHER,
              cancellationNote: dto.reason,
              lateCancellation: false,
              updatedById: tenant.userId,
            },
      });
      if (!count) throw changedMeanwhile();
      if (notAttended) {
        const recorded = await tx.sessionAttendance.findUnique({
          where: { appointmentId: row.id },
          select: stateSelect.attendance.select,
        });
        const next: AttendanceValues = {
          status: AttendanceStatus.ABSENT,
          checkInAt: null,
          actualStartAt: null,
          actualEndAt: null,
          note: recorded?.note ?? null,
        };
        await this.writeAttendance(tx, tenant, row.id, recorded, next, now);
      }
      const voided = {
        status: TherapySessionStatus.VOIDED,
        voidedAt: now,
        voidedById: tenant.userId,
        voidReason: dto.reason,
      };
      const session = await tx.therapySession.findUnique({
        where: { appointmentId: row.id },
        select: { status: true },
      });
      if (session) {
        await tx.therapySession.update({
          where: { appointmentId: row.id },
          data: voided,
        });
      } else if (row.type === AppointmentType.THERAPY_SESSION) {
        // Completed before sessions were recorded.
        await tx.therapySession.create({
          data: { appointmentId: row.id, centerId: tenant.centerId, ...voided },
        });
      }
      const enrollmentId = await this.packages.reverse(
        tx,
        tenant,
        row.id,
        `Session corrected: ${dto.reason}`.slice(0, 1000),
      );
      await recordHistory(tx, tenant, {
        appointmentId: row.id,
        action: AppointmentHistoryAction.SESSION_CORRECTED,
        previousValues: { status: AppointmentStatus.COMPLETED },
        newValues: {
          status,
          outcome: dto.outcome,
          packageReversed: enrollmentId !== null,
        },
        reason: dto.reason,
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'session.corrected',
          entityType: 'Appointment',
          entityId: row.id,
          metadata: {
            patientCode: row.patient.code,
            outcome: dto.outcome,
            packageReversed: enrollmentId !== null,
            ...(enrollmentId && { enrollmentId }),
          },
          ipAddress: ip,
        },
        tx,
      );
    });
  }
}
