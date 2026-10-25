import { parseIsoDate } from '../common/time';
import { Prisma } from '../generated/prisma/client';
import {
  balance,
  enrollmentStatus,
  periodOf,
  priceAfterDiscount,
  sessionProblems,
  validityEnd,
  type EnrollmentFacts,
} from './rules';

const d = (iso: string) => parseIsoDate(iso)!;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const money = (v: string) => new Prisma.Decimal(v);

describe('validityEnd', () => {
  it('counts days and weeks with the start date included', () => {
    expect(iso(validityEnd(d('2026-11-01'), 30, 'DAY'))).toBe('2026-11-30');
    expect(iso(validityEnd(d('2026-11-01'), 1, 'DAY'))).toBe('2026-11-01');
    expect(iso(validityEnd(d('2026-11-01'), 4, 'WEEK'))).toBe('2026-11-28');
    expect(iso(validityEnd(d('2026-12-20'), 30, 'DAY'))).toBe('2027-01-18');
  });

  it('runs calendar months to the day before the same date', () => {
    expect(iso(validityEnd(d('2026-11-01'), 1, 'MONTH'))).toBe('2026-11-30');
    expect(iso(validityEnd(d('2026-01-15'), 1, 'MONTH'))).toBe('2026-02-14');
    expect(iso(validityEnd(d('2026-12-10'), 1, 'MONTH'))).toBe('2027-01-09');
    expect(iso(validityEnd(d('2026-11-01'), 3, 'MONTH'))).toBe('2027-01-31');
  });

  it('ends on the last day of a month that lacks the start date', () => {
    expect(iso(validityEnd(d('2027-01-31'), 1, 'MONTH'))).toBe('2027-02-28');
    expect(iso(validityEnd(d('2028-01-31'), 1, 'MONTH'))).toBe('2028-02-29');
    expect(iso(validityEnd(d('2027-01-29'), 1, 'MONTH'))).toBe('2027-02-28');
    expect(iso(validityEnd(d('2026-08-31'), 1, 'MONTH'))).toBe('2026-09-30');
    // A month that has the date: the day before it.
    expect(iso(validityEnd(d('2028-01-29'), 1, 'MONTH'))).toBe('2028-02-28');
  });

  it('keeps 30 days and one month apart', () => {
    expect(iso(validityEnd(d('2027-02-01'), 30, 'DAY'))).toBe('2027-03-02');
    expect(iso(validityEnd(d('2027-02-01'), 1, 'MONTH'))).toBe('2027-02-28');
  });
});

describe('priceAfterDiscount', () => {
  const price = money('9000.00');

  it('takes a fixed amount off', () => {
    const r = priceAfterDiscount(price, {
      discountType: 'FIXED',
      discountValue: '1000',
    });
    expect(r.ok && r.finalPrice.toFixed(2)).toBe('8000.00');
  });

  it('takes a percentage off in exact decimals, rounding half up', () => {
    const r = priceAfterDiscount(money('999.99'), {
      discountType: 'PERCENTAGE',
      discountValue: '12.5',
    });
    // 999.99 × 12.5% = 124.99875 → 125.00 off
    expect(r.ok && r.finalPrice.toFixed(2)).toBe('874.99');
    const third = priceAfterDiscount(money('0.30'), {
      discountType: 'PERCENTAGE',
      discountValue: '33.33',
    });
    expect(third.ok && third.finalPrice.toFixed(2)).toBe('0.20');
  });

  it('allows a 100% discount but nothing below zero', () => {
    const full = priceAfterDiscount(price, {
      discountType: 'PERCENTAGE',
      discountValue: '100',
    });
    expect(full.ok && full.finalPrice.toFixed(2)).toBe('0.00');
    expect(
      priceAfterDiscount(price, {
        discountType: 'FIXED',
        discountValue: '9000.01',
      }),
    ).toMatchObject({ ok: false, field: 'discountValue' });
    expect(
      priceAfterDiscount(price, {
        discountType: 'PERCENTAGE',
        discountValue: '100.01',
      }),
    ).toMatchObject({ ok: false });
    expect(
      priceAfterDiscount(price, { discountType: 'FIXED', discountValue: '0' }),
    ).toMatchObject({ ok: false });
  });

  it('accepts an agreed price and needs the value for each type', () => {
    const r = priceAfterDiscount(price, {
      discountType: 'PRICE_OVERRIDE',
      agreedPrice: '11000',
    });
    expect(r.ok && r.finalPrice.toFixed(2)).toBe('11000.00');
    expect(priceAfterDiscount(price, { discountType: 'FIXED' })).toMatchObject({
      ok: false,
    });
    expect(
      priceAfterDiscount(price, { discountType: 'PRICE_OVERRIDE' }),
    ).toMatchObject({ ok: false, field: 'agreedPrice' });
    const none = priceAfterDiscount(price, { discountType: 'NONE' });
    expect(none.ok && none.finalPrice.toFixed(2)).toBe('9000.00');
  });
});

const facts = (patch: Partial<EnrollmentFacts> = {}): EnrollmentFacts => ({
  state: 'ACTIVE',
  startDate: d('2026-11-01'),
  endDate: d('2026-11-30'),
  totalSessions: 12,
  consumedSessions: 0,
  reservedSessions: 0,
  patientId: 'p1',
  therapyTypeIds: ['ot', 'slt'],
  coversAssessments: false,
  validityValue: 30,
  validityUnit: 'DAY',
  usageLimitCount: null,
  usageLimitPeriod: null,
  ...patch,
});

describe('balance and status', () => {
  it('counts reservations once, separately from consumption', () => {
    const e = { totalSessions: 12, consumedSessions: 5, reservedSessions: 3 };
    expect(balance(e)).toEqual({ remaining: 7, availableToBook: 4 });
  });

  it('derives pending, active, expired, exhausted and cancelled', () => {
    const today = d('2026-11-10');
    expect(enrollmentStatus(facts(), today)).toBe('ACTIVE');
    expect(enrollmentStatus(facts(), d('2026-10-31'))).toBe('PENDING');
    expect(enrollmentStatus(facts(), d('2026-11-30'))).toBe('ACTIVE');
    expect(enrollmentStatus(facts(), d('2026-12-01'))).toBe('EXPIRED');
    expect(
      enrollmentStatus(facts({ startDate: null, endDate: null }), today),
    ).toBe('PENDING');
    expect(enrollmentStatus(facts({ consumedSessions: 12 }), today)).toBe(
      'EXHAUSTED',
    );
    // Fully booked isn't exhausted: the sessions haven't been used.
    expect(enrollmentStatus(facts({ reservedSessions: 12 }), today)).toBe(
      'ACTIVE',
    );
    expect(
      enrollmentStatus(
        facts({ state: 'CANCELLED', consumedSessions: 12 }),
        today,
      ),
    ).toBe('CANCELLED');
  });
});

describe('periodOf', () => {
  it('finds the week from the center’s first weekday, and calendar months', () => {
    // 2026-11-04 is a Wednesday; Saturday-first weeks start 2026-10-31.
    expect(periodOf(d('2026-11-04'), 'WEEK', 6)).toEqual({
      from: d('2026-10-31'),
      to: d('2026-11-06'),
    });
    expect(periodOf(d('2026-11-04'), 'WEEK', 1).from).toEqual(d('2026-11-02'));
    expect(periodOf(d('2026-10-31'), 'WEEK', 6).from).toEqual(d('2026-10-31'));
    expect(periodOf(d('2028-02-10'), 'MONTH', 6)).toEqual({
      from: d('2028-02-01'),
      to: d('2028-02-29'),
    });
  });
});

describe('sessionProblems', () => {
  const session = {
    patientId: 'p1',
    therapyTypeId: 'ot',
    type: 'THERAPY_SESSION' as const,
    date: d('2026-11-10'),
  };
  const ctx = { heldDates: [], usedInPeriod: 0, needsSession: true };

  it('accepts an eligible session', () => {
    expect(sessionProblems(facts(), session, ctx)).toEqual([]);
  });

  it('checks patient, therapy, assessments, dates, balance and limits', () => {
    expect(
      sessionProblems(facts(), { ...session, patientId: 'p2' }, ctx),
    ).toEqual(['OTHER_PATIENT']);
    expect(
      sessionProblems(facts(), { ...session, therapyTypeId: 'aba' }, ctx),
    ).toEqual(['THERAPY_NOT_COVERED']);
    expect(
      sessionProblems(facts(), { ...session, type: 'ASSESSMENT' }, ctx),
    ).toEqual(['ASSESSMENT_NOT_COVERED']);
    expect(
      sessionProblems(
        facts({ coversAssessments: true }),
        { ...session, type: 'ASSESSMENT' },
        ctx,
      ),
    ).toEqual([]);
    expect(
      sessionProblems(facts(), { ...session, date: d('2026-12-01') }, ctx),
    ).toEqual(['AFTER_END']);
    expect(
      sessionProblems(facts(), { ...session, date: d('2026-10-31') }, ctx),
    ).toEqual(['BEFORE_START']);
    expect(
      sessionProblems(
        facts({ consumedSessions: 9, reservedSessions: 3 }),
        session,
        ctx,
      ),
    ).toEqual(['NO_SESSIONS']);
    // A session that already holds one (rescheduling) doesn't need another.
    expect(
      sessionProblems(
        facts({ consumedSessions: 9, reservedSessions: 3 }),
        session,
        { ...ctx, needsSession: false },
      ),
    ).toEqual([]);
    expect(
      sessionProblems(
        facts({ usageLimitCount: 3, usageLimitPeriod: 'WEEK' }),
        session,
        { ...ctx, usedInPeriod: 3 },
      ),
    ).toEqual(['USAGE_LIMIT']);
    expect(
      sessionProblems(facts({ state: 'CANCELLED' }), session, ctx),
    ).toEqual(['CANCELLED']);
  });

  it('keeps every held session inside a first-session enrollment’s future validity', () => {
    const pending = facts({
      state: 'PENDING',
      startDate: null,
      endDate: null,
      validityValue: 30,
    });
    expect(
      sessionProblems(pending, { ...session, date: d('2027-03-01') }, ctx),
    ).toEqual([]);
    // Held on 1 Nov: validity would run to 30 Nov, so 1 Dec doesn't fit…
    expect(
      sessionProblems(
        pending,
        { ...session, date: d('2026-12-01') },
        { ...ctx, heldDates: [d('2026-11-01')] },
      ),
    ).toEqual(['AFTER_END']);
    // …nor does an earlier date that would leave a held one outside.
    expect(
      sessionProblems(
        pending,
        { ...session, date: d('2026-10-01') },
        { ...ctx, heldDates: [d('2026-11-15')] },
      ),
    ).toEqual(['AFTER_END']);
  });
});
