import { formatClock, parseClock } from '../common/time';
import { LIMITS } from './limits';

export interface DayInput {
  dayOfWeek: number;
  intervals: { start: string; end: string }[];
}

export interface IntervalRow {
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
}

/** A type, not an interface, so it can go into audit metadata as JSON. */
export type WorkingDay = {
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
  isOpen: boolean;
  /** Ordered by start time; empty when closed */
  intervals: { start: string; end: string }[];
};

const OPENING_HOURS_MESSAGES = {
  endBeforeStart: 'Closing time must be after opening time',
};

/**
 * Checks a full week of opening hours and turns it into rows. Errors are keyed by the
 * request's field paths (e.g. "days.2.intervals.1.end") so forms can show them inline.
 * Intervals are same-day only; touching intervals (09:00–13:00, 13:00–18:00) are fine.
 */
export function validateWeek(
  days: DayInput[],
  messages: { endBeforeStart: string } = OPENING_HOURS_MESSAGES,
) {
  const errors: Record<string, string> = {};
  const rows: IntervalRow[] = [];
  const seen = new Set<number>();

  days.forEach((day, d) => {
    if (seen.has(day.dayOfWeek)) {
      errors[`days.${d}.dayOfWeek`] = 'Each day can only appear once';
      return;
    }
    seen.add(day.dayOfWeek);
    if (day.intervals.length > LIMITS.intervalsPerDay) {
      errors[`days.${d}.intervals`] =
        `Use at most ${LIMITS.intervalsPerDay} time ranges a day`;
      return;
    }

    const parsed: { index: number; start: number; end: number }[] = [];
    day.intervals.forEach((interval, i) => {
      const path = `days.${d}.intervals.${i}`;
      const start = parseClock(interval.start);
      const end = parseClock(interval.end);
      if (start === null) errors[`${path}.start`] = 'Enter a time like 09:00';
      if (end === null) errors[`${path}.end`] = 'Enter a time like 18:00';
      if (start === null || end === null) return;
      if (start >= end) {
        errors[`${path}.end`] = messages.endBeforeStart;
        return;
      }
      parsed.push({ index: i, start, end });
    });

    parsed.sort((a, b) => a.start - b.start);
    for (let i = 1; i < parsed.length; i++) {
      const prev = parsed[i - 1];
      const current = parsed[i];
      if (current.start < prev.end) {
        errors[`days.${d}.intervals.${current.index}.start`] =
          `Overlaps ${formatClock(prev.start)}–${formatClock(prev.end)}`;
      }
    }
    for (const { start, end } of parsed) {
      rows.push({
        dayOfWeek: day.dayOfWeek,
        startMinutes: start,
        endMinutes: end,
      });
    }
  });

  return { rows, errors };
}

/** Rows → all seven days, Sunday first, intervals in time order. */
export function toWeek(rows: IntervalRow[]): WorkingDay[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const intervals = rows
      .filter((r) => r.dayOfWeek === dayOfWeek)
      .sort((a, b) => a.startMinutes - b.startMinutes)
      .map((r) => ({
        start: formatClock(r.startMinutes),
        end: formatClock(r.endMinutes),
      }));
    return { dayOfWeek, isOpen: intervals.length > 0, intervals };
  });
}
