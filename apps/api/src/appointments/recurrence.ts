/**
 * Recurring booking rules, expanded into a bounded list of center-local calendar dates
 * (UTC-midnight Dates, as from parseIsoDate). Times aren't involved: every occurrence
 * starts at the series' wall-clock start time on its date, so a daylight-saving change
 * moves no session.
 *
 * - DAILY: every `interval` days from the start date.
 * - WEEKLY: on `daysOfWeek`, every `interval` weeks. Weeks begin on the center's first
 *   day of the week, counted from the week holding the start date; dates before the
 *   start date in that week are left out.
 * - MONTHLY: on the start date's day of the month, every `interval` months. When a month
 *   is too short (the 29th–31st), that occurrence falls on the month's last day and is
 *   flagged `adjusted`; the next month goes back to the original day. Dates never drift.
 *
 * A rule always ends, by `until` (inclusive) or by `count`.
 */
import { addDays } from '../common/time';

export const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export interface Recurrence {
  frequency: Frequency;
  interval: number;
  /** WEEKLY only: 0 = Sunday … 6 = Saturday */
  daysOfWeek: number[];
  startDate: Date;
  until: Date | null;
  count: number | null;
}

export interface OccurrenceDate {
  date: Date;
  /** MONTHLY only: moved to the month's last day because it has no such date */
  adjusted: boolean;
}

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** Candidate dates in order, without the end condition applied. */
function* candidates(
  rule: Recurrence,
  weekStartsOn: number,
): Generator<OccurrenceDate> {
  const start = rule.startDate;
  if (rule.frequency === 'DAILY') {
    for (let i = 0; ; i += rule.interval) {
      yield { date: addDays(start, i), adjusted: false };
    }
  }
  if (rule.frequency === 'WEEKLY') {
    // Nothing would ever match; the DTO requires days, but never loop forever.
    if (!rule.daysOfWeek.length) return;
    const offset = (start.getUTCDay() - weekStartsOn + 7) % 7;
    const firstWeek = addDays(start, -offset);
    for (let week = 0; ; week += rule.interval) {
      for (let d = 0; d < 7; d++) {
        const date = addDays(firstWeek, week * 7 + d);
        if (date < start) continue;
        if (rule.daysOfWeek.includes(date.getUTCDay())) {
          yield { date, adjusted: false };
        }
      }
    }
  }
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const dayOfMonth = start.getUTCDate();
  for (let i = 0; ; i += rule.interval) {
    const y = year + Math.floor((month + i) / 12);
    const m = (month + i) % 12;
    const day = Math.min(dayOfMonth, daysInMonth(y, m));
    yield { date: new Date(Date.UTC(y, m, day)), adjusted: day !== dayOfMonth };
  }
}

/**
 * The rule's dates, up to `max`. `exceeded` is true when it would produce more than
 * `max`, which callers should reject rather than truncate silently.
 */
export function expandRecurrence(
  rule: Recurrence,
  { weekStartsOn, max }: { weekStartsOn: number; max: number },
) {
  const dates: OccurrenceDate[] = [];
  for (const candidate of candidates(rule, weekStartsOn)) {
    if (rule.until && candidate.date > rule.until) break;
    if (rule.count !== null && dates.length >= rule.count) break;
    if (dates.length >= max) return { dates, exceeded: true };
    dates.push(candidate);
  }
  return { dates, exceeded: false };
}
