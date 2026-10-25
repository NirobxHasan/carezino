/**
 * Package rules as pure functions: how long an enrollment is valid, what it costs after
 * a discount, where it stands, and whether a session can use it. The services gather
 * the facts (dates, balances, other bookings) and these decide, so booking, the
 * package options a booking screen offers and the lists can never disagree.
 *
 * Validity policy: an enrollment is valid from its start date to its end date, both
 * included, as calendar dates in the center's time zone. A session may use it when the
 * appointment's center-local date falls inside. Validity is computed once, when the
 * enrollment starts (on enrolling, on a chosen date, or on the first charged session),
 * and never recomputed from the catalog.
 *
 * - DAY n: the start date and the n − 1 days after it (30 days from 1 Nov ends 30 Nov).
 * - WEEK n: 7n days, as for DAY.
 * - MONTH n: up to the day before the same date n months later (1 Nov + 1 month ends
 *   30 Nov; 15 Jan ends 14 Feb). When that month has no such date, the validity runs to
 *   its last day (31 Jan + 1 month ends 28 Feb, or 29 Feb in a leap year).
 */
import { addDays } from '../common/time';
import { Prisma } from '../generated/prisma/client';
import {
  AppointmentType,
  PackageDiscountType,
  PackageEnrollmentState,
  PackagePeriodUnit,
} from '../generated/prisma/enums';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export const PACKAGE_LIMITS = {
  name: 120,
  code: 30,
  description: 1000,
  notes: 2000,
  sessionCount: { min: 1, max: 1000 },
  /** Most of each unit a validity can be, about ten years */
  validity: { DAY: 3660, WEEK: 520, MONTH: 120 } as Record<
    PackagePeriodUnit,
    number
  >,
  usageLimitCount: { min: 1, max: 100 },
  therapyTypes: 20,
  /** Up to 99,999,999.99 (NUMERIC(12, 2)) */
  maxPrice: '99999999.99',
  /** Sessions one adjustment can add or remove */
  adjustment: { min: 1, max: 100 },
  reason: { min: 3, max: 500 },
  /** How far a chosen start date may be from today, in days */
  startDateRange: 366,
  /** "Expiring soon": active and ending within this many days */
  expiringSoonDays: 7,
} as const;

/** The status the API reports. Only PENDING, ACTIVE and CANCELLED are stored. */
export const ENROLLMENT_STATUSES = [
  'PENDING',
  'ACTIVE',
  'EXHAUSTED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/** The last day (inclusive) of a validity starting on `start`, a UTC-midnight date. */
export function validityEnd(
  start: Date,
  value: number,
  unit: PackagePeriodUnit,
): Date {
  if (unit === PackagePeriodUnit.DAY) return addDays(start, value - 1);
  if (unit === PackagePeriodUnit.WEEK) return addDays(start, value * 7 - 1);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + value;
  const day = start.getUTCDate();
  // Date.UTC rolls months over into years; day 0 is the previous month's last day.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (day > lastDay) return new Date(Date.UTC(year, month, lastDay));
  return addDays(new Date(Date.UTC(year, month, day)), -1);
}

export interface BalanceFacts {
  totalSessions: number;
  consumedSessions: number;
  reservedSessions: number;
}

/** Remaining entitlement and what's still free to book; reservations count once. */
export function balance(e: BalanceFacts) {
  const remaining = e.totalSessions - e.consumedSessions;
  return { remaining, availableToBook: remaining - e.reservedSessions };
}

export interface StatusFacts extends BalanceFacts {
  state: PackageEnrollmentState;
  startDate: Date | null;
  endDate: Date | null;
}

/**
 * Where an enrollment stands today (a center-local date). Cancelled wins; then an
 * enrollment with nothing left is exhausted whatever its dates; then it's pending
 * before its validity starts, expired after it ends, and active in between.
 */
export function enrollmentStatus(
  e: StatusFacts,
  today: Date,
): EnrollmentStatus {
  if (e.state === PackageEnrollmentState.CANCELLED) return 'CANCELLED';
  if (balance(e).remaining <= 0) return 'EXHAUSTED';
  if (!e.startDate || !e.endDate || today < e.startDate) return 'PENDING';
  if (today > e.endDate) return 'EXPIRED';
  return 'ACTIVE';
}

/** The center-local dates (both included) of the day, week or month around `date`. */
export function periodOf(
  date: Date,
  unit: PackagePeriodUnit,
  weekStartsOn: number,
): { from: Date; to: Date } {
  if (unit === PackagePeriodUnit.DAY) return { from: date, to: date };
  if (unit === PackagePeriodUnit.WEEK) {
    const from = addDays(date, -((date.getUTCDay() - weekStartsOn + 7) % 7));
    return { from, to: addDays(from, 6) };
  }
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const to = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  );
  return { from, to };
}

// ── Pricing ─────────────────────────────────────────────────────────────────

export interface DiscountInput {
  discountType: PackageDiscountType;
  /** FIXED: the amount off. PERCENTAGE: the percentage off. Decimal strings. */
  discountValue?: string | null;
  /** PRICE_OVERRIDE: the agreed price */
  agreedPrice?: string | null;
}

export type PriceResult =
  | { ok: true; discountValue: Decimal | null; finalPrice: Decimal }
  | { ok: false; field: string; message: string };

/**
 * The agreed price after a discount, in exact decimal arithmetic. Percentages round to
 * the paisa, half up. A discount can't exceed the price; an override can be any
 * non-negative amount (e.g. more sessions for more money).
 */
export function priceAfterDiscount(
  catalogPrice: Decimal,
  input: DiscountInput,
): PriceResult {
  const fail = (field: string, message: string): PriceResult => ({
    ok: false,
    field,
    message,
  });
  switch (input.discountType) {
    case PackageDiscountType.NONE:
      return { ok: true, discountValue: null, finalPrice: catalogPrice };
    case PackageDiscountType.FIXED: {
      if (!input.discountValue) {
        return fail('discountValue', 'Enter the discount amount');
      }
      const amount = new Decimal(input.discountValue);
      if (amount.lte(0)) {
        return fail('discountValue', 'Enter an amount above zero');
      }
      if (amount.gt(catalogPrice)) {
        return fail(
          'discountValue',
          'The discount can’t be more than the package price',
        );
      }
      return {
        ok: true,
        discountValue: amount,
        finalPrice: catalogPrice.minus(amount),
      };
    }
    case PackageDiscountType.PERCENTAGE: {
      if (!input.discountValue) {
        return fail('discountValue', 'Enter the discount percentage');
      }
      const percent = new Decimal(input.discountValue);
      if (percent.lte(0) || percent.gt(100)) {
        return fail('discountValue', 'Enter a percentage from 0.01 to 100');
      }
      const off = catalogPrice
        .times(percent)
        .dividedBy(100)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      return {
        ok: true,
        discountValue: percent,
        finalPrice: catalogPrice.minus(off),
      };
    }
    case PackageDiscountType.PRICE_OVERRIDE: {
      if (!input.agreedPrice) {
        return fail('agreedPrice', 'Enter the agreed price');
      }
      return {
        ok: true,
        discountValue: null,
        finalPrice: new Decimal(input.agreedPrice),
      };
    }
  }
}

// ── Using a package for a session ───────────────────────────────────────────

export type SessionProblem =
  | 'CANCELLED'
  | 'OTHER_PATIENT'
  | 'THERAPY_NOT_COVERED'
  | 'ASSESSMENT_NOT_COVERED'
  | 'BEFORE_START'
  | 'AFTER_END'
  | 'NO_SESSIONS'
  | 'USAGE_LIMIT';

export interface EnrollmentFacts extends StatusFacts {
  patientId: string;
  therapyTypeIds: string[];
  coversAssessments: boolean;
  validityValue: number;
  validityUnit: PackagePeriodUnit;
  usageLimitCount: number | null;
  usageLimitPeriod: PackagePeriodUnit | null;
}

export interface SessionFacts {
  patientId: string;
  therapyTypeId: string;
  type: AppointmentType;
  /** The appointment's center-local date */
  date: Date;
}

export interface SessionContext {
  /**
   * Center-local dates of the enrollment's other held sessions. While a first-session
   * enrollment hasn't started, its validity would start on the earliest of these and
   * the session's own date, so every held session must fit in that window.
   */
  heldDates: Date[];
  /** Other held or charged sessions in the same usage-limit period as this one */
  usedInPeriod: number;
  /** False when the session already holds one of the enrollment's sessions (a move) */
  needsSession: boolean;
}

/** The validity a session date would fall under, before or after activation. */
export function validityFor(
  e: Pick<
    EnrollmentFacts,
    'startDate' | 'endDate' | 'validityValue' | 'validityUnit'
  >,
  dates: Date[],
): { start: Date; end: Date } {
  if (e.startDate && e.endDate) return { start: e.startDate, end: e.endDate };
  const start = new Date(Math.min(...dates.map((d) => d.getTime())));
  return { start, end: validityEnd(start, e.validityValue, e.validityUnit) };
}

/**
 * Every reason the session can't use the enrollment; none means it can. Validity is
 * judged by the session's date, not today, so a booking for next week fails on a
 * package that ends tomorrow, and a session held while valid is still charged after.
 */
export function sessionProblems(
  e: EnrollmentFacts,
  session: SessionFacts,
  ctx: SessionContext,
): SessionProblem[] {
  if (e.state === PackageEnrollmentState.CANCELLED) return ['CANCELLED'];
  if (e.patientId !== session.patientId) return ['OTHER_PATIENT'];
  const problems: SessionProblem[] = [];
  if (!e.therapyTypeIds.includes(session.therapyTypeId)) {
    problems.push('THERAPY_NOT_COVERED');
  }
  if (session.type === AppointmentType.ASSESSMENT && !e.coversAssessments) {
    problems.push('ASSESSMENT_NOT_COVERED');
  }
  const window = validityFor(e, [session.date, ...ctx.heldDates]);
  if (session.date < window.start) problems.push('BEFORE_START');
  // Before activation, the latest held date counts too: it must still fit.
  const latest = Math.max(
    session.date.getTime(),
    ...(e.startDate ? [] : ctx.heldDates.map((d) => d.getTime())),
  );
  if (latest > window.end.getTime()) problems.push('AFTER_END');
  if (ctx.needsSession && balance(e).availableToBook < 1) {
    problems.push('NO_SESSIONS');
  }
  if (e.usageLimitCount !== null && ctx.usedInPeriod >= e.usageLimitCount) {
    problems.push('USAGE_LIMIT');
  }
  return problems;
}
