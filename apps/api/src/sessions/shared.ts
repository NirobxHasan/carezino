import { HttpStatus } from '@nestjs/common';

import {
  itemSelect,
  localTimes,
  toItem,
  type View,
} from '../appointments/appointments.service';
import { OPEN_STATUSES } from '../appointments/rules';
import { isOwn } from '../assessments/access';
import type { TenantContext } from '../auth/auth-context';
import { apiError } from '../common/errors';
import { formatClock, instantToZoned } from '../common/time';
import type { Prisma } from '../generated/prisma/client';
import {
  AppointmentStatus,
  AppointmentType,
  AttendanceStatus,
  PackageLedgerMovement,
  PackageReservationStatus,
  SessionNoteStatus,
  TherapySessionStatus,
} from '../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';
import {
  attendanceOf,
  attended,
  noteStateOf,
  notePending,
  sessionStatusOf,
} from './rules';

export type Tx = Prisma.TransactionClient;
export type Db = Tx | PrismaService;

export const userSelect = { select: { id: true, fullName: true } } as const;

/** What every session row needs: the appointment plus its attendance, session and note. */
export const sessionItemSelect = {
  ...itemSelect,
  attendance: {
    select: {
      status: true,
      checkInAt: true,
      actualStartAt: true,
      actualEndAt: true,
    },
  },
  session: {
    select: {
      status: true,
      startedAt: true,
      completedAt: true,
      therapyPlan: { select: { id: true, code: true, status: true } },
      note: {
        select: {
          id: true,
          status: true,
          completedAt: true,
          updatedAt: true,
          therapist: { select: { membershipId: true } },
        },
      },
    },
  },
  // Package usage without enrollments, prices or balances (therapists see these rows).
  packageReservations: {
    select: { status: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  packageMovements: {
    where: { movement: PackageLedgerMovement.SESSION_CONSUMPTION },
    select: { chargeReason: true, reversedBy: { select: { id: true } } },
  },
} satisfies Prisma.AppointmentSelect;

export type SessionItemRow = Prisma.AppointmentGetPayload<{
  select: typeof sessionItemSelect;
}>;

/** An appointment view plus the center's today, for what can be done on which day. */
export interface SessionView extends View {
  /** Center-local "YYYY-MM-DD" */
  today: string;
  /** IDs of the notes on the page whose content the caller may read */
  readableNotes: Set<string>;
}

/**
 * HELD: a package session is reserved. CHARGED: one was used. REVERSED: charged, then
 * given back. RELEASED: given back without being used. Null: no package involved.
 */
export function packageUsage(row: {
  packageReservations: { status: PackageReservationStatus }[];
  packageMovements: { reversedBy: { id: string } | null }[];
}) {
  const charge = row.packageMovements[0];
  if (charge) return charge.reversedBy ? 'REVERSED' : 'CHARGED';
  const reservation = row.packageReservations[0];
  if (!reservation) return null;
  return reservation.status === PackageReservationStatus.ACTIVE
    ? 'HELD'
    : 'RELEASED';
}

/**
 * What the caller may do with a session now, so the today list, history, session page
 * and "My sessions" offer the same choices. The API still checks every request.
 */
export function sessionActions(row: SessionItemRow, view: SessionView) {
  const can = (p: TenantContext['permissions'][number]) =>
    view.tenant.permissions.includes(p);
  const { date } = localTimes(row.startAt, row.endAt, view.timeZone);
  const open = OPEN_STATUSES.includes(row.status);
  const started = row.startAt <= view.now;
  const due = date <= view.today;
  const attendance = attendanceOf(row.status, row.attendance?.status);
  const therapy = row.type === AppointmentType.THERAPY_SESSION;
  const own = isOwn(view.tenant, row.therapist);
  const session = sessionStatusOf(row.session);
  const note = row.session?.note ?? null;
  const record = open && can('attendance.record');
  const documentable =
    row.status !== AppointmentStatus.CANCELLED &&
    row.status !== AppointmentStatus.NO_SHOW &&
    session !== TherapySessionStatus.VOIDED;
  return {
    /** Records arrival now: present (or late) with a check-in time; today only */
    checkIn: record && date === view.today && !row.attendance?.checkInAt,
    markPresent: record && due && attendance !== AttendanceStatus.PRESENT,
    markLate: record && due && attendance !== AttendanceStatus.LATE,
    /** Also makes the appointment a no-show */
    markAbsent: record && started,
    /** After the appointment closed, with a reason */
    correctAttendance:
      (row.status === AppointmentStatus.COMPLETED ||
        row.status === AppointmentStatus.NO_SHOW) &&
      can('attendance.correct'),
    start:
      therapy &&
      open &&
      due &&
      session === TherapySessionStatus.NOT_STARTED &&
      can('sessions.complete'),
    /** Needs attendance; when it isn't marked, completing asks for it */
    complete:
      open &&
      started &&
      attendance !== AttendanceStatus.ABSENT &&
      can('sessions.complete') &&
      (attended(attendance) || can('attendance.record')),
    /** Void a completed session; its package charge is reversed */
    correct:
      row.status === AppointmentStatus.COMPLETED && can('sessions.correct'),
    writeNote:
      therapy &&
      own &&
      !note &&
      documentable &&
      due &&
      can('session_notes.create'),
    editNote:
      own &&
      note?.status === SessionNoteStatus.DRAFT &&
      can('session_notes.update_draft'),
    viewNote: note !== null && view.readableNotes.has(note.id),
    amendNote:
      own &&
      note !== null &&
      note.status !== SessionNoteStatus.DRAFT &&
      can('session_notes.amend'),
  };
}

/** An instant as the center's "HH:mm", so screens never convert time zones. */
export function clockOf(instant: Date | null | undefined, timeZone: string) {
  return instant
    ? formatClock(instantToZoned(instant, timeZone).minutes)
    : null;
}

export function toSessionItem(row: SessionItemRow, view: SessionView) {
  const note = row.session?.note ?? null;
  const noteStatus = noteStateOf(note);
  const a = row.attendance;
  return {
    ...toItem(row, view),
    attendance: {
      status: attendanceOf(row.status, a?.status),
      checkInAt: a?.checkInAt ?? null,
      actualStartAt: a?.actualStartAt ?? null,
      actualEndAt: a?.actualEndAt ?? null,
      /** The same times as the center's wall clock */
      checkInTime: clockOf(a?.checkInAt, view.timeZone),
      actualStartTime: clockOf(a?.actualStartAt, view.timeZone),
      actualEndTime: clockOf(a?.actualEndAt, view.timeZone),
    },
    sessionStatus: sessionStatusOf(row.session),
    /** The plan the session belongs to, once it started (code only) */
    plan: row.session?.therapyPlan ?? null,
    note: note && {
      id: note.id,
      status: note.status,
      completedAt: note.completedAt,
      updatedAt: note.updatedAt,
    },
    noteStatus,
    /** The session took place but its note isn't signed off yet */
    notePending: notePending({
      type: row.type,
      appointmentStatus: row.status,
      note: noteStatus,
    }),
    packageUsage: packageUsage(row),
    sessionActions: sessionActions(row, view),
  };
}

/** Locks an appointment row until the transaction ends (therapist, patient, appointment, enrollment). */
export async function lockAppointment(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id = ${id}::uuid FOR UPDATE`;
}

export const changedMeanwhile = () =>
  apiError(
    HttpStatus.CONFLICT,
    'This session was just changed by someone else. Reload and try again.',
    'SESSION_CHANGED',
  );

export const refused = (refusal: { code: string; message: string }) =>
  apiError(HttpStatus.CONFLICT, refusal.message, refusal.code);

export const notTherapySession = () =>
  apiError(
    HttpStatus.CONFLICT,
    'Assessment appointments are documented as assessments, not session notes.',
    'NOT_A_THERAPY_SESSION',
  );

export const notResponsible = (therapist: string) =>
  apiError(
    HttpStatus.FORBIDDEN,
    `Only ${therapist}, the session’s therapist, can write its note.`,
    'NOT_RESPONSIBLE_THERAPIST',
  );
