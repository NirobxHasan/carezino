/**
 * Mirror of the API's validation limits (apps/api/src/center-settings/limits.ts), so
 * forms catch mistakes before a round trip. The API remains the authority.
 */
export const LIMITS = {
  durationMinutes: { min: 5, max: 480 },
  intervalsPerDay: 6,
  closureDays: 366,
  slotIntervalMinutes: [5, 10, 15, 20, 30, 45, 60],
  bookingBufferMinutes: { min: 0, max: 120 },
  advanceBookingLimitDays: { min: 1, max: 730 },
  minimumBookingNoticeMinutes: { min: 0, max: 43_200 },
  cancellationCutoffMinutes: { min: 0, max: 43_200 },
} as const;

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Day numbers (0 = Sunday) in display order, starting from the center's first day. */
export function weekOrder(weekStartsOn = 6) {
  return Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7);
}

/** 90 → "1 h 30 min", 45 → "45 min" */
export function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
