/**
 * Session rules as pure functions: what recording attendance does to an appointment,
 * when a session can be completed, and how session and note states read in lists. The
 * services gather the facts (appointment, attendance, session, note) and these decide,
 * so lists, details and writes can never disagree about what's allowed.
 */
import { OPEN_STATUSES } from '../appointments/rules';
import {
  AppointmentStatus,
  AppointmentType,
  AttendanceStatus,
  SessionNoteStatus,
  TherapySessionStatus,
} from '../generated/prisma/enums';

/** Late still counts as attended: only ABSENT is an absence. */
export const ATTENDED: AttendanceStatus[] = [
  AttendanceStatus.PRESENT,
  AttendanceStatus.LATE,
];

export const attended = (status: AttendanceStatus) => ATTENDED.includes(status);

export const isOpen = (status: AppointmentStatus) =>
  OPEN_STATUSES.includes(status);

/**
 * An appointment's attendance as recorded, or as its status implies when nothing was
 * recorded: a no-show marked before attendance existed (or through its status) is
 * absent, everything else not marked yet.
 */
export function attendanceOf(
  appointmentStatus: AppointmentStatus,
  recorded: AttendanceStatus | null | undefined,
): AttendanceStatus {
  if (recorded) return recorded;
  return appointmentStatus === AppointmentStatus.NO_SHOW
    ? AttendanceStatus.ABSENT
    : AttendanceStatus.NOT_MARKED;
}

export interface Refusal {
  ok: false;
  code: string;
  message: string;
}

/**
 * What a change of attendance does to the appointment:
 * - KEEP: nothing besides attendance changes
 * - NO_SHOW: the appointment becomes a no-show (ABSENT is the attendance of NO_SHOW)
 * - REOPEN: a no-show turns out to have come after all; the appointment is open again
 *
 * `correction` changes come after the appointment closed; they need
 * attendance.correct and a reason.
 */
export type AttendancePlan =
  | {
      ok: true;
      appointment: 'KEEP' | 'NO_SHOW' | 'REOPEN';
      correction: boolean;
    }
  | Refusal;

export function planAttendance(input: {
  appointmentStatus: AppointmentStatus;
  current: AttendanceStatus;
  next: AttendanceStatus;
  /** The appointment's start time has passed */
  started: boolean;
  /** The appointment's center-local date is today or earlier */
  dueOrPast: boolean;
}): AttendancePlan {
  const { appointmentStatus: status, next } = input;
  const refuse = (code: string, message: string): Refusal => ({
    ok: false,
    code,
    message,
  });
  switch (status) {
    case AppointmentStatus.CANCELLED:
      return refuse(
        'APPOINTMENT_CANCELLED',
        'This appointment was cancelled, so attendance can’t be recorded for it.',
      );
    case AppointmentStatus.COMPLETED:
      if (attended(next)) {
        return { ok: true, appointment: 'KEEP', correction: true };
      }
      return refuse(
        'USE_SESSION_CORRECTION',
        'This session is completed. If the patient didn’t attend, correct the session instead.',
      );
    case AppointmentStatus.NO_SHOW:
      if (next === AttendanceStatus.ABSENT) {
        return { ok: true, appointment: 'KEEP', correction: true };
      }
      if (attended(next)) {
        return { ok: true, appointment: 'REOPEN', correction: true };
      }
      return refuse(
        'INVALID_ATTENDANCE',
        'A no-show can only be corrected to present or late.',
      );
  }
  // Scheduled or confirmed.
  if (attended(next) && !input.dueOrPast) {
    return refuse(
      'APPOINTMENT_NOT_DUE',
      'Attendance can be recorded from the day of the appointment.',
    );
  }
  if (next === AttendanceStatus.ABSENT) {
    if (!input.started) {
      return refuse(
        'APPOINTMENT_NOT_STARTED',
        'The patient can be marked absent once the appointment has started. To call it off earlier, cancel it.',
      );
    }
    return { ok: true, appointment: 'NO_SHOW', correction: false };
  }
  return { ok: true, appointment: 'KEEP', correction: false };
}

/**
 * Why a session can't be completed now, or null when it can. A completed one is
 * reported by the caller as already done (completing is idempotent).
 */
export function completionRefusal(input: {
  appointmentStatus: AppointmentStatus;
  attendance: AttendanceStatus;
  started: boolean;
  /** Attendance the request records along with completing, if any */
  attendanceGiven: boolean;
}): Refusal | null {
  if (!isOpen(input.appointmentStatus)) {
    return {
      ok: false,
      code: 'INVALID_STATUS_TRANSITION',
      message:
        input.appointmentStatus === AppointmentStatus.CANCELLED
          ? 'This appointment was cancelled, so its session can’t be completed.'
          : 'This appointment is a no-show, so its session can’t be completed. Correct the attendance first if the patient came.',
    };
  }
  if (!input.started) {
    return {
      ok: false,
      code: 'APPOINTMENT_NOT_STARTED',
      message: 'The session can be completed once it has started.',
    };
  }
  if (!attended(input.attendance) && !input.attendanceGiven) {
    return {
      ok: false,
      code: 'ATTENDANCE_REQUIRED',
      message:
        'Mark the patient present or late before completing the session.',
    };
  }
  return null;
}

/** NOT_STARTED is never stored: no session row means the session hasn't started. */
export function sessionStatusOf(
  row: { status: TherapySessionStatus } | null | undefined,
): TherapySessionStatus {
  return row?.status ?? TherapySessionStatus.NOT_STARTED;
}

/** A note's state in lists and filters; NONE when no note has been started. */
export type NoteState = 'NONE' | SessionNoteStatus;

export const NOTE_STATES: NoteState[] = [
  'NONE',
  SessionNoteStatus.DRAFT,
  SessionNoteStatus.COMPLETED,
  SessionNoteStatus.AMENDED,
];

export function noteStateOf(
  note: { status: SessionNoteStatus } | null | undefined,
): NoteState {
  return note?.status ?? 'NONE';
}

/**
 * The session took place but its documentation isn't signed off yet. Only therapy
 * sessions have notes; assessments are documented by the assessments module.
 */
export function notePending(input: {
  type: AppointmentType;
  appointmentStatus: AppointmentStatus;
  note: NoteState;
}) {
  return (
    input.type === AppointmentType.THERAPY_SESSION &&
    input.appointmentStatus === AppointmentStatus.COMPLETED &&
    (input.note === 'NONE' || input.note === SessionNoteStatus.DRAFT)
  );
}

/**
 * Problems with actual times for one appointment, keyed by field: each must fall on
 * the appointment's center-local day ([dayStart, dayEnd)) and not in the future, and
 * the session must end after it starts.
 */
export function attendanceTimeErrors(
  times: {
    checkInAt: Date | null;
    actualStartAt: Date | null;
    actualEndAt: Date | null;
  },
  { now, dayStart, dayEnd }: { now: Date; dayStart: Date; dayEnd: Date },
) {
  const errors: Record<string, string> = {};
  // A minute's grace for clocks that disagree slightly.
  const latest = new Date(now.getTime() + 60_000);
  for (const key of ['checkInAt', 'actualStartAt', 'actualEndAt'] as const) {
    const t = times[key];
    if (!t) continue;
    if (t > latest) errors[key] = 'Can’t be in the future';
    else if (t < dayStart || t >= dayEnd) {
      errors[key] = 'Must be on the day of the appointment';
    }
  }
  if (
    times.actualStartAt &&
    times.actualEndAt &&
    times.actualEndAt <= times.actualStartAt &&
    !errors.actualEndAt
  ) {
    errors.actualEndAt = 'Must be after the session started';
  }
  return errors;
}
