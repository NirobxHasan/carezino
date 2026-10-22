/**
 * Interval arithmetic for therapist schedules. All values are minutes since midnight on
 * one calendar day in the center's time zone, half-open [start, end); 1440 is midnight
 * at the end of the day. Pure functions, so booking can reuse and tests can pin them.
 */

export interface Interval {
  start: number;
  end: number;
}

export const DAY_MINUTES = 1440;

/** Sorted, with overlapping or touching intervals merged and empty ones dropped. */
export function normalize(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .map((i) => ({ start: i.start, end: i.end }))
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const interval of sorted) {
    const last = out.at(-1);
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      out.push(interval);
    }
  }
  return out;
}

/** The time covered by both lists. */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of normalize(a)) {
    for (const y of normalize(b)) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return normalize(out);
}

/** `from` with every part covered by `cuts` removed. */
export function subtract(from: Interval[], cuts: Interval[]): Interval[] {
  let remaining = normalize(from);
  for (const cut of normalize(cuts)) {
    remaining = remaining.flatMap((r) => {
      if (cut.end <= r.start || cut.start >= r.end) return [r];
      const pieces: Interval[] = [];
      if (cut.start > r.start) pieces.push({ start: r.start, end: cut.start });
      if (cut.end < r.end) pieces.push({ start: cut.end, end: r.end });
      return pieces;
    });
  }
  return remaining;
}

/** Whether [start, end) lies entirely inside one of the intervals. */
export function covers(intervals: Interval[], start: number, end: number) {
  return normalize(intervals).some((i) => i.start <= start && end <= i.end);
}

/** Whether [start, end) touches any of the intervals. */
export function overlaps(intervals: Interval[], start: number, end: number) {
  return intervals.some((i) => i.start < end && start < i.end);
}

/** Everything the scheduling rules need to know about one day. */
export interface DayFacts {
  therapistActive: boolean;
  /** The therapist's active weekly intervals for this weekday */
  regular: Interval[];
  /** The center's opening intervals for this weekday; empty when closed that weekday */
  centerHours: Interval[];
  /** Active closures on this date, as intervals (a whole-day closure is 0–1440) */
  closures: Interval[];
  /** The therapist's time off, clipped to this date */
  timeOff: Interval[];
  /** CenterSchedulingSettings.allowBookingOnClosedDays */
  allowOnClosedDays: boolean;
}

/**
 * When the therapist is working on a day: their regular hours, inside the center's
 * opening hours, minus closures and time off. If the center allows booking on closed
 * days, closures and weekly closed days don't take time away (opening hours still bound
 * an open day). Appointments and buffers aren't applied here: these are working windows,
 * not free slots.
 */
export function workingWindows(day: DayFacts): Interval[] {
  if (!day.therapistActive) return [];
  let windows = normalize(day.regular);
  if (day.allowOnClosedDays) {
    if (day.centerHours.length) windows = intersect(windows, day.centerHours);
  } else {
    windows = subtract(intersect(windows, day.centerHours), day.closures);
  }
  return subtract(windows, day.timeOff);
}

export type UnavailableReason =
  | 'THERAPIST_INACTIVE'
  | 'NOT_SPECIALIZED'
  | 'OUTSIDE_REGULAR_HOURS'
  | 'OUTSIDE_CENTER_HOURS'
  | 'CENTER_CLOSED'
  | 'TIME_OFF';

/** Every rule a [start, end) period on this day breaks; empty when it's a working window. */
export function unavailableReasons(
  day: DayFacts,
  start: number,
  end: number,
): UnavailableReason[] {
  const reasons: UnavailableReason[] = [];
  if (!day.therapistActive) reasons.push('THERAPIST_INACTIVE');
  if (!covers(day.regular, start, end)) reasons.push('OUTSIDE_REGULAR_HOURS');
  const closedDay = day.centerHours.length === 0;
  if (!closedDay && !covers(day.centerHours, start, end)) {
    reasons.push('OUTSIDE_CENTER_HOURS');
  }
  if (
    !day.allowOnClosedDays &&
    (closedDay || overlaps(day.closures, start, end))
  ) {
    reasons.push('CENTER_CLOSED');
  }
  if (overlaps(day.timeOff, start, end)) reasons.push('TIME_OFF');
  return reasons;
}
