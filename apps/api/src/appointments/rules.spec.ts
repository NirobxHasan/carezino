import { formatClock, parseIsoDate, zonedToInstant } from '../common/time';
import type { DayFacts } from '../therapists/schedule';
import {
  canTransition,
  dayReason,
  daySlots,
  evaluate,
  isLateCancellation,
  localPeriod,
  onlyOverlaps,
  type Booked,
  type BookingContext,
} from './rules';

const DHAKA = 'Asia/Dhaka';
const h = (start: number, end: number) => ({
  start: start * 60,
  end: end * 60,
});

const DATE = '2026-10-26';
const date = parseIsoDate(DATE)!;
/** An instant on DATE in Dhaka, e.g. at('10:30') */
const at = (clock: string, zone = DHAKA, day = date) =>
  zonedToInstant(
    day,
    Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3)),
    zone,
  );

const workday: DayFacts = {
  therapistActive: true,
  regular: [h(9, 13), h(14, 17)],
  centerHours: [h(9, 18)],
  closures: [],
  timeOff: [],
  allowOnClosedDays: false,
};

function context(
  overrides: {
    day?: Partial<DayFacts>;
    policy?: Partial<BookingContext['policy']>;
    therapistBookings?: Booked[];
    patientBookings?: Booked[];
    specialized?: boolean;
  } = {},
): BookingContext {
  return {
    policy: {
      timeZone: DHAKA,
      // A week before DATE, so nothing is in the past or too soon.
      now: new Date('2026-10-19T00:00:00Z'),
      bufferMinutes: 0,
      minimumNoticeMinutes: 0,
      advanceBookingLimitDays: 60,
      allowPastDateBooking: false,
      ...overrides.policy,
    },
    days: new Map([[DATE, { ...workday, ...overrides.day }]]),
    specialized: overrides.specialized ?? true,
    therapistBookings: overrides.therapistBookings ?? [],
    patientBookings: overrides.patientBookings ?? [],
  };
}

const booked = (start: string, end: string, bufferMinutes = 0): Booked => ({
  id: `${start}-${end}`,
  startAt: at(start),
  endAt: at(end),
  bufferMinutes,
});

const starts = (ctx: BookingContext, duration: number, interval: number) =>
  daySlots(ctx, date, duration, interval).slots.map((s) =>
    formatClock(s.start),
  );

describe('slot generation', () => {
  it('offers starts inside working hours around existing appointments', () => {
    // The worked example: 09–13 and 14–17, booked 10–11, 60 minutes every 30.
    const ctx = context({ therapistBookings: [booked('10:00', '11:00')] });
    expect(starts(ctx, 60, 30)).toEqual([
      '09:00',
      '11:00',
      '11:30',
      '12:00',
      '14:00',
      '14:30',
      '15:00',
      '15:30',
      '16:00',
    ]);
  });

  it('keeps each booking’s buffer free after it', () => {
    const ctx = context({
      therapistBookings: [booked('10:00', '11:00', 15)],
      policy: { bufferMinutes: 15 },
    });
    // 09:00 would run into 10:00 with its own buffer; 11:00 is inside the old buffer.
    expect(starts(ctx, 45, 15).slice(0, 3)).toEqual([
      '09:00',
      '11:15',
      '11:30',
    ]);
  });

  it('removes time off and part-day closures', () => {
    const ctx = context({
      day: { timeOff: [h(9, 11)], closures: [h(15, 24)] },
    });
    expect(starts(ctx, 60, 60)).toEqual(['11:00', '12:00', '14:00']);
  });

  it('offers nothing on closed days and explains why', () => {
    const ctx = context({ day: { closures: [h(0, 24)] } });
    const result = daySlots(ctx, date, 60, 30);
    expect(result.slots).toEqual([]);
    expect(dayReason(ctx.days.get(DATE)!, result.rejected)).toBe(
      'CENTER_CLOSED',
    );
  });

  it('skips past starts and those inside the minimum notice', () => {
    const ctx = context({
      policy: { now: at('11:10'), minimumNoticeMinutes: 60 },
    });
    // Earliest is 12:10; the next 30-minute start that fits before 13:00 is 12:30.
    expect(starts(ctx, 30, 30)[0]).toBe('12:30');
    expect(starts(ctx, 60, 30)[0]).toBe('14:00');
  });

  it('allows past times when the center records past sessions', () => {
    const ctx = context({
      policy: { now: at('16:30'), allowPastDateBooking: true },
    });
    expect(starts(ctx, 60, 60)).toEqual([
      '09:00',
      '10:00',
      '11:00',
      '12:00',
      '14:00',
      '15:00',
      '16:00',
    ]);
  });

  it('offers nothing beyond the advance booking limit', () => {
    const ctx = context({ policy: { advanceBookingLimitDays: 3 } });
    const result = daySlots(ctx, date, 60, 30);
    expect(result.slots).toEqual([]);
    expect(dayReason(ctx.days.get(DATE)!, result.rejected)).toBe(
      'TOO_FAR_AHEAD',
    );
  });

  it('respects the patient’s other appointments', () => {
    const ctx = context({ patientBookings: [booked('09:00', '12:00')] });
    expect(starts(ctx, 60, 60)).toEqual(['12:00', '14:00', '15:00', '16:00']);
  });
});

describe('period evaluation', () => {
  it('lists every broken rule', () => {
    const ctx = context({
      day: { timeOff: [h(16, 18)] },
      specialized: false,
      therapistBookings: [booked('16:00', '17:00')],
    });
    const reasons = evaluate(ctx, at('16:30'), at('17:30')).map(
      (c) => c.reason,
    );
    expect(reasons).toEqual(
      expect.arrayContaining([
        'OUTSIDE_REGULAR_HOURS',
        'TIME_OFF',
        'NOT_SPECIALIZED',
        'THERAPIST_BUSY',
      ]),
    );
    expect(onlyOverlaps(evaluate(ctx, at('16:30'), at('17:30')))).toBe(false);
  });

  it('ignores the appointment being rescheduled', () => {
    const existing = booked('10:00', '11:00');
    const ctx = context({ therapistBookings: [existing] });
    expect(evaluate(ctx, at('10:30'), at('11:30'), existing.id)).toEqual([]);
    expect(onlyOverlaps(evaluate(ctx, at('10:30'), at('11:30')))).toBe(true);
  });

  it('rejects periods that cross midnight', () => {
    const ctx = context({
      day: { regular: [h(0, 24)], centerHours: [h(0, 24)] },
    });
    expect(
      evaluate(
        ctx,
        at('23:30'),
        at('00:30', DHAKA, parseIsoDate('2026-10-27')!),
      ),
    ).toEqual([{ reason: 'INVALID_PERIOD' }]);
    expect(
      localPeriod(
        at('23:00'),
        at('00:00', DHAKA, parseIsoDate('2026-10-27')!),
        DHAKA,
      ),
    ).toEqual({
      date,
      start: 23 * 60,
      end: 24 * 60,
    });
  });
});

describe('time zones', () => {
  it('reads Asia/Dhaka wall clock (UTC+6) correctly', () => {
    expect(at('10:00').toISOString()).toBe('2026-10-26T04:00:00.000Z');
    expect(
      localPeriod(
        new Date('2026-10-26T04:00:00Z'),
        new Date('2026-10-26T05:00:00Z'),
        DHAKA,
      ),
    ).toEqual({
      date,
      start: 600,
      end: 660,
    });
  });

  it('skips nonexistent times on a spring-forward day and keeps real durations', () => {
    // New York jumps from 02:00 to 03:00 on 8 March 2026.
    const zone = 'America/New_York';
    const day = parseIsoDate('2026-03-08')!;
    const ctx: BookingContext = {
      ...context({
        policy: { timeZone: zone, now: new Date('2026-03-01T00:00:00Z') },
      }),
      days: new Map([
        [
          '2026-03-08',
          { ...workday, regular: [h(0, 6)], centerHours: [h(0, 24)] },
        ],
      ]),
    };
    const result = daySlots(ctx, day, 60, 60).slots.map((s) => [
      formatClock(s.start),
      formatClock(s.end),
    ]);
    // 02:00 doesn't exist; 01:00 + 60 real minutes ends at 03:00 local.
    expect(result).toEqual([
      ['00:00', '01:00'],
      ['01:00', '03:00'],
      ['03:00', '04:00'],
      ['04:00', '05:00'],
      ['05:00', '06:00'],
    ]);
  });

  it('handles the repeated hour on a fall-back day', () => {
    // London goes from 02:00 BST back to 01:00 GMT on 25 October 2026.
    const zone = 'Europe/London';
    const day = parseIsoDate('2026-10-25')!;
    const ctx: BookingContext = {
      ...context({
        policy: { timeZone: zone, now: new Date('2026-10-01T00:00:00Z') },
      }),
      days: new Map([
        [
          '2026-10-25',
          { ...workday, regular: [h(9, 12)], centerHours: [h(0, 24)] },
        ],
      ]),
    };
    const slots = daySlots(ctx, day, 60, 60).slots;
    expect(slots.map((s) => s.startAt.toISOString())).toEqual([
      '2026-10-25T09:00:00.000Z',
      '2026-10-25T10:00:00.000Z',
      '2026-10-25T11:00:00.000Z',
    ]);
  });
});

describe('status and cancellation rules', () => {
  it('allows only defined transitions', () => {
    expect(canTransition('SCHEDULED', 'CONFIRMED')).toBe(true);
    expect(canTransition('SCHEDULED', 'COMPLETED')).toBe(true);
    expect(canTransition('CONFIRMED', 'NO_SHOW')).toBe(true);
    expect(canTransition('CONFIRMED', 'CANCELLED')).toBe(true);
    expect(canTransition('CONFIRMED', 'SCHEDULED')).toBe(false);
    expect(canTransition('COMPLETED', 'SCHEDULED')).toBe(false);
    expect(canTransition('CANCELLED', 'COMPLETED')).toBe(false);
    expect(canTransition('NO_SHOW', 'COMPLETED')).toBe(false);
  });

  it('counts cancellations inside the cutoff as late', () => {
    const start = at('10:00');
    expect(isLateCancellation(start, at('08:30'), 120)).toBe(true);
    expect(isLateCancellation(start, at('07:30'), 120)).toBe(false);
    expect(isLateCancellation(start, at('09:59'), 0)).toBe(false);
  });
});
