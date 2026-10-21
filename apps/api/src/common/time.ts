/**
 * Wall-clock helpers for center schedules. Times of day are stored as minutes since
 * midnight and exchanged as "HH:mm"; calendar dates as "YYYY-MM-DD". Both are in the
 * center's own time zone, so they never go through the server's local time.
 */

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "09:30" → 570. Returns null for anything that isn't a 24-hour HH:mm time. */
export function parseClock(value: string): number | null {
  const match = CLOCK.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** 570 → "09:30" */
export function formatClock(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "2026-10-21" → a Date at UTC midnight, as Prisma stores @db.Date. Null if invalid. */
export function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Rejects dates like 2026-02-30, which Date.UTC would roll over.
  return date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
    ? date
    : null;
}

/** A @db.Date value → "2026-10-21" */
export function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Today's date where the center is, e.g. in Asia/Dhaka, as a UTC-midnight Date. */
export function todayIn(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parseIsoDate(parts)!;
}

/** Whole days from start to end, both included. */
export function daysInclusive(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}
