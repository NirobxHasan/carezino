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
  /** Therapy types one therapist can be assigned */
  specializationsPerTherapist: 20,
  /** Longest single time-off entry, in days */
  timeOffDays: 366,
  /** Most days one schedule overview request can cover (six weeks, for a month grid) */
  scheduleDays: 42,
  yearsOfExperience: { min: 0, max: 70 },
  /** Most appointments one recurring booking can create */
  seriesOccurrences: 100,
  /** Furthest a recurring booking's end date can be from its start date, in days */
  seriesSpanDays: 365,
  /** Repeat every N days, weeks or months */
  seriesInterval: { min: 1, max: 12 },
} as const;
