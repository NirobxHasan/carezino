/**
 * Validation limits for therapy and scheduling configuration, in one place so they can
 * be tuned without touching DTOs or the database (whose CHECK constraints are looser).
 * The web app mirrors these in lib/settings-limits.ts.
 */
export const LIMITS = {
  /** Session length, in minutes */
  durationMinutes: { min: 5, max: 480 },
  durationOptionsPerType: 12,
  therapyTypesPerCenter: 100,
  /** Opening intervals per weekday (e.g. a morning and an afternoon shift) */
  intervalsPerDay: 6,
  /** Longest single closure, in days */
  closureDays: 366,
  slotIntervalMinutes: [5, 10, 15, 20, 30, 45, 60] as readonly number[],
  bookingBufferMinutes: { min: 0, max: 120 },
  advanceBookingLimitDays: { min: 1, max: 730 },
  /** Up to 30 days */
  minimumBookingNoticeMinutes: { min: 0, max: 43_200 },
  cancellationCutoffMinutes: { min: 0, max: 43_200 },
} as const;
