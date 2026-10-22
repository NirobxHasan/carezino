import { parseIsoDate } from '../common/time';
import { monthsBetween, patientAge } from './age';

const d = (iso: string) => parseIsoDate(iso)!;
const none = { dateOfBirth: null, approxAgeMonths: null, approxAgeAsOf: null };

describe('monthsBetween', () => {
  it('counts a month only once its day is reached', () => {
    expect(monthsBetween(d('2020-03-15'), d('2026-03-14'))).toBe(71);
    expect(monthsBetween(d('2020-03-15'), d('2026-03-15'))).toBe(72);
    expect(monthsBetween(d('2026-01-31'), d('2026-02-28'))).toBe(0);
    expect(monthsBetween(d('2026-10-21'), d('2026-10-21'))).toBe(0);
  });
});

describe('patientAge', () => {
  it('uses the date of birth when there is one', () => {
    expect(
      patientAge({ ...none, dateOfBirth: d('2021-06-10') }, d('2026-10-21')),
    ).toEqual({ years: 5, months: 4, isApproximate: false });
  });

  it('moves an approximate age on from the day it was given', () => {
    const stated = {
      ...none,
      approxAgeMonths: 4 * 12 + 6,
      approxAgeAsOf: d('2025-10-21'),
    };
    expect(patientAge(stated, d('2025-10-21'))).toEqual({
      years: 4,
      months: 6,
      isApproximate: true,
    });
    expect(patientAge(stated, d('2026-10-21'))).toEqual({
      years: 5,
      months: 6,
      isApproximate: true,
    });
  });

  it('is unknown without either, and never negative', () => {
    expect(patientAge(none, d('2026-10-21'))).toBeNull();
    expect(
      patientAge({ ...none, dateOfBirth: d('2026-11-01') }, d('2026-10-21')),
    ).toEqual({ years: 0, months: 0, isApproximate: false });
  });
});
