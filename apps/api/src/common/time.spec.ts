import {
  daysInclusive,
  formatClock,
  formatIsoDate,
  parseClock,
  parseIsoDate,
  todayIn,
} from './time';

describe('clock times', () => {
  it('round-trips HH:mm through minutes', () => {
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('09:30')).toBe(570);
    expect(parseClock('23:59')).toBe(1439);
    expect(formatClock(570)).toBe('09:30');
  });

  it('rejects anything that isn’t a 24-hour HH:mm time', () => {
    for (const value of ['24:00', '9:30', '09:60', '0930', '', '09:30 PM']) {
      expect(parseClock(value)).toBeNull();
    }
  });
});

describe('calendar dates', () => {
  it('parses ISO dates at UTC midnight', () => {
    expect(parseIsoDate('2026-10-21')?.toISOString()).toBe(
      '2026-10-21T00:00:00.000Z',
    );
    expect(formatIsoDate(parseIsoDate('2026-02-28')!)).toBe('2026-02-28');
  });

  it('rejects dates that don’t exist', () => {
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('21/10/2026')).toBeNull();
  });

  it('counts both ends of a range', () => {
    const start = parseIsoDate('2026-03-30')!;
    expect(daysInclusive(start, start)).toBe(1);
    expect(daysInclusive(start, parseIsoDate('2026-04-02')!)).toBe(4);
  });

  it('works out today in the center’s time zone', () => {
    // 20:30 UTC on 21 Oct is already 22 Oct in Dhaka (UTC+6).
    const now = new Date('2026-10-21T20:30:00Z');
    expect(formatIsoDate(todayIn('Asia/Dhaka', now))).toBe('2026-10-22');
    expect(formatIsoDate(todayIn('America/New_York', now))).toBe('2026-10-21');
  });
});
