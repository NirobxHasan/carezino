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

const DAY_MS = 86_400_000;

/** A UTC-midnight date plus whole days. */
export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Minutes the zone is ahead of UTC at that instant, e.g. 360 for Asia/Dhaka. */
function zoneOffsetMinutes(timeZone: string, instant: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round(
    (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000,
  );
}

/**
 * The instant a wall-clock time happens in a zone: `date` is a UTC-midnight calendar
 * date (as from parseIsoDate) and `minutes` the time of day; 1440 means the next midnight.
 */
export function zonedToInstant(date: Date, minutes: number, timeZone: string) {
  const wall = date.getTime() + minutes * 60_000;
  const first = wall - zoneOffsetMinutes(timeZone, new Date(wall)) * 60_000;
  // Re-check at the result, in case the offset changes in between (DST).
  const offset = zoneOffsetMinutes(timeZone, new Date(first));
  return new Date(wall - offset * 60_000);
}

/** An instant as a calendar date (UTC-midnight Date) and minutes since midnight in a zone. */
export function instantToZoned(instant: Date, timeZone: string) {
  const local =
    instant.getTime() + zoneOffsetMinutes(timeZone, instant) * 60_000;
  const date = new Date(Math.floor(local / DAY_MS) * DAY_MS);
  return { date, minutes: Math.round((local - date.getTime()) / 60_000) };
}
