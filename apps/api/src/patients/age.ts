/**
 * Patient ages. A patient has a date of birth or, when it isn't known, an approximate age
 * as stated on a given day; never both. Either way the age is worked out on read, so
 * nothing stored goes stale and no birth date is ever made up from an approximate age.
 * Dates are UTC-midnight calendar dates (see common/time).
 */

/** The most an approximate age can be, in years */
export const MAX_AGE_YEARS = 150;

/** Whole months from `from` to `to`; a month counts once its day of the month is reached. */
export function monthsBetween(from: Date, to: Date) {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  return to.getUTCDate() < from.getUTCDate() ? months - 1 : months;
}

export interface PatientAge {
  years: number;
  months: number;
  /** From an approximate age rather than a date of birth */
  isApproximate: boolean;
}

export function patientAge(
  patient: {
    dateOfBirth: Date | null;
    approxAgeMonths: number | null;
    approxAgeAsOf: Date | null;
  },
  today: Date,
): PatientAge | null {
  let total: number;
  if (patient.dateOfBirth) {
    total = monthsBetween(patient.dateOfBirth, today);
  } else if (patient.approxAgeMonths !== null && patient.approxAgeAsOf) {
    total =
      patient.approxAgeMonths +
      Math.max(0, monthsBetween(patient.approxAgeAsOf, today));
  } else {
    return null;
  }
  total = Math.max(0, total);
  return {
    years: Math.floor(total / 12),
    months: total % 12,
    isApproximate: !patient.dateOfBirth,
  };
}
