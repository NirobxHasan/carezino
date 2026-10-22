/**
 * Booking rules as pure functions: whether a period can be booked, which start times a
 * day offers, and how an appointment's status may change. The services gather the facts
 * (schedules, settings, existing bookings) and these decide, so slot listing and booking
 * confirmation can never disagree.
 */
import {
  addDays,
  formatIsoDate,
  instantToZoned,
  zonedToInstant,
} from '../common/time';
import { AppointmentStatus } from '../generated/prisma/enums';
import {
  DAY_MINUTES,
  covers,
  unavailableReasons,
  workingWindows,
  type DayFacts,
  type UnavailableReason,
} from '../therapists/schedule';

/**
 * Statuses that hold the therapist's and patient's time. Must match the WHERE clause of
 * the overlap exclusion constraints in the appointments migration.
 */
export const BLOCKING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.COMPLETED,
];

/** Statuses of appointments that haven't happened yet and can still be moved or cancelled. */
export const OPEN_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
];

/**
 * Every allowed status change. Confirming is optional, so a scheduled appointment can be
 * completed or marked a no-show directly. Completed, cancelled and no-show are final:
 * there is no correction workflow yet. Cancelling goes through its own endpoint, which
 * records a reason.
 */
const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'NO_SHOW', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus) {
  return TRANSITIONS[from].includes(to);
}

/** Completed and no-show describe something that happened, so they need a started appointment. */
export function needsStarted(status: AppointmentStatus) {
  return (
    status === AppointmentStatus.COMPLETED ||
    status === AppointmentStatus.NO_SHOW
  );
}

/** Cancelled with less notice than the cutoff (minutes). A cutoff of 0 turns this off. */
export function isLateCancellation(
  startAt: Date,
  now: Date,
  cutoffMinutes: number,
) {
  return (
    cutoffMinutes > 0 &&
    startAt.getTime() - now.getTime() < cutoffMinutes * 60_000
  );
}

export type ConflictReason =
  | UnavailableReason
  /** Not a same-day period in the center's time zone */
  | 'INVALID_PERIOD'
  | 'IN_THE_PAST'
  /** Sooner than the center's minimum booking notice */
  | 'TOO_SOON'
  /** Beyond the center's advance booking limit */
  | 'TOO_FAR_AHEAD'
  | 'THERAPIST_BUSY'
  | 'PATIENT_BUSY';

/** Clashes the center may allow on purpose (double booking); every other reason is a hard stop. */
const OVERLAP_REASONS: ConflictReason[] = ['THERAPIST_BUSY', 'PATIENT_BUSY'];

export interface Conflict {
  reason: ConflictReason;
  /** The clashing appointment, for THERAPIST_BUSY and PATIENT_BUSY */
  appointmentId?: string;
  startAt?: Date;
  endAt?: Date;
}

/** An existing booking that holds time (one of BLOCKING_STATUSES). */
export interface Booked {
  id: string;
  startAt: Date;
  endAt: Date;
  /** Minutes the therapist is kept free after it */
  bufferMinutes: number;
}

export interface BookingPolicy {
  timeZone: string;
  now: Date;
  /** Buffer the new booking keeps after itself */
  bufferMinutes: number;
  minimumNoticeMinutes: number;
  advanceBookingLimitDays: number;
  allowPastDateBooking: boolean;
}

/** Everything needed to judge periods for one therapist (and optionally one patient). */
export interface BookingContext {
  policy: BookingPolicy;
  /** Schedule facts by center-local ISO date; must cover every date asked about */
  days: Map<string, DayFacts>;
  /** The therapist offers the therapy type (an active specialization) */
  specialized: boolean;
  therapistBookings: Booked[];
  /** Empty when no patient is involved, e.g. listing slots without one */
  patientBookings: Booked[];
}

/**
 * [startAt, endAt) as the center's wall clock: its date and start/end minutes. Null when
 * the period isn't within one day there (ending exactly at midnight is fine).
 */
export function localPeriod(startAt: Date, endAt: Date, timeZone: string) {
  if (endAt <= startAt) return null;
  const start = instantToZoned(startAt, timeZone);
  const end = instantToZoned(endAt, timeZone);
  let endMinutes: number;
  if (end.date.getTime() === start.date.getTime()) endMinutes = end.minutes;
  else if (
    end.date.getTime() === addDays(start.date, 1).getTime() &&
    end.minutes === 0
  )
    endMinutes = DAY_MINUTES;
  else return null;
  return { date: start.date, start: start.minutes, end: endMinutes };
}

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart < bEnd && bStart < aEnd;

const plusMinutes = (date: Date, minutes: number) =>
  new Date(date.getTime() + minutes * 60_000);

/**
 * Every rule booking [startAt, endAt) would break; empty when it can be booked.
 * `excludeId` leaves out the appointment being rescheduled.
 */
export function evaluate(
  ctx: BookingContext,
  startAt: Date,
  endAt: Date,
  excludeId?: string,
): Conflict[] {
  const { policy } = ctx;
  const period = localPeriod(startAt, endAt, policy.timeZone);
  if (!period) return [{ reason: 'INVALID_PERIOD' }];
  const day = ctx.days.get(formatIsoDate(period.date));
  if (!day)
    throw new Error(`No schedule facts for ${formatIsoDate(period.date)}`);

  const conflicts: Conflict[] = unavailableReasons(
    day,
    period.start,
    period.end,
  ).map((reason) => ({ reason }));
  if (!ctx.specialized) conflicts.push({ reason: 'NOT_SPECIALIZED' });

  const today = instantToZoned(policy.now, policy.timeZone).date;
  if (startAt < policy.now) {
    if (!policy.allowPastDateBooking) conflicts.push({ reason: 'IN_THE_PAST' });
  } else if (startAt < plusMinutes(policy.now, policy.minimumNoticeMinutes)) {
    conflicts.push({ reason: 'TOO_SOON' });
  }
  if (period.date > addDays(today, policy.advanceBookingLimitDays)) {
    conflicts.push({ reason: 'TOO_FAR_AHEAD' });
  }

  // Each booking keeps its own buffer free after it, the new one included.
  const heldUntil = plusMinutes(endAt, policy.bufferMinutes);
  for (const b of ctx.therapistBookings) {
    if (b.id === excludeId) continue;
    if (
      overlaps(
        startAt,
        heldUntil,
        b.startAt,
        plusMinutes(b.endAt, b.bufferMinutes),
      )
    ) {
      conflicts.push({
        reason: 'THERAPIST_BUSY',
        appointmentId: b.id,
        startAt: b.startAt,
        endAt: b.endAt,
      });
    }
  }
  for (const b of ctx.patientBookings) {
    if (b.id === excludeId) continue;
    if (overlaps(startAt, endAt, b.startAt, b.endAt)) {
      conflicts.push({
        reason: 'PATIENT_BUSY',
        appointmentId: b.id,
        startAt: b.startAt,
        endAt: b.endAt,
      });
    }
  }
  return conflicts;
}

/** Only clashes with other bookings, which a center that allows double booking may accept. */
export function onlyOverlaps(conflicts: Conflict[]) {
  return (
    conflicts.length > 0 &&
    conflicts.every((c) => OVERLAP_REASONS.includes(c.reason))
  );
}

export interface Slot {
  startAt: Date;
  endAt: Date;
  /** Center-local minutes since midnight */
  start: number;
  end: number;
}

/**
 * Start times on `date` (a center-local calendar date) where a booking of `duration`
 * minutes breaks no rule, in order. Candidates sit on a grid of `interval` minutes from
 * local midnight (09:00, 09:30, … for 30), so offered times are predictable; local times
 * that don't exist (a daylight-saving gap) are skipped, and durations are real elapsed
 * minutes. Also returns why candidates during the therapist's regular hours were
 * rejected, so an empty day can be explained.
 */
export function daySlots(
  ctx: BookingContext,
  date: Date,
  durationMinutes: number,
  intervalMinutes: number,
  excludeId?: string,
) {
  const { timeZone } = ctx.policy;
  const day = ctx.days.get(formatIsoDate(date));
  if (!day) throw new Error(`No schedule facts for ${formatIsoDate(date)}`);
  const windows = workingWindows(day);
  const slots: Slot[] = [];
  const rejected = new Set<ConflictReason>();
  for (let m = 0; m < DAY_MINUTES; m += intervalMinutes) {
    const inWindow = windows.some((w) => w.start <= m && m < w.end);
    const inRegular = day.regular.some((r) => r.start <= m && m < r.end);
    if (!inWindow && !inRegular) continue;
    const startAt = zonedToInstant(date, m, timeZone);
    const local = instantToZoned(startAt, timeZone);
    if (local.date.getTime() !== date.getTime() || local.minutes !== m)
      continue;
    const endAt = plusMinutes(startAt, durationMinutes);
    const conflicts = evaluate(ctx, startAt, endAt, excludeId);
    if (!conflicts.length) {
      const period = localPeriod(startAt, endAt, timeZone)!;
      slots.push({ startAt, endAt, start: period.start, end: period.end });
    } else if (inRegular) {
      for (const c of conflicts) rejected.add(c.reason);
    }
  }
  return { slots, rejected };
}

/** Most telling first: why a day offers nothing, from the reasons its candidates failed. */
const DAY_REASON_PRIORITY: ConflictReason[] = [
  'THERAPIST_INACTIVE',
  'NOT_SPECIALIZED',
  'IN_THE_PAST',
  'TOO_FAR_AHEAD',
  'CENTER_CLOSED',
  'TIME_OFF',
  'THERAPIST_BUSY',
  'PATIENT_BUSY',
  'TOO_SOON',
  'OUTSIDE_CENTER_HOURS',
  'OUTSIDE_REGULAR_HOURS',
  'INVALID_PERIOD',
];

/**
 * The reason to show when a day has no slots. A day without regular hours is
 * OUTSIDE_REGULAR_HOURS (the therapist doesn't work that weekday) unless something
 * weightier applies to the whole day: an inactive therapist or a closed center.
 */
export function dayReason(
  day: DayFacts,
  rejected: Set<ConflictReason>,
): ConflictReason {
  if (!day.therapistActive) return 'THERAPIST_INACTIVE';
  const found = DAY_REASON_PRIORITY.find((r) => rejected.has(r));
  if (found) return found;
  const closed =
    !day.centerHours.length || covers(day.closures, 0, DAY_MINUTES);
  return closed && !day.allowOnClosedDays
    ? 'CENTER_CLOSED'
    : 'OUTSIDE_REGULAR_HOURS';
}
