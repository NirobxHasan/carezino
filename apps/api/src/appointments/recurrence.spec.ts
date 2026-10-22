import { formatIsoDate, parseIsoDate } from '../common/time';
import { expandRecurrence, type Recurrence } from './recurrence';

const SAT = 6;
const MON = 1;
const WED = 3;

function rule(overrides: Partial<Recurrence> & { start: string }): Recurrence {
  const { start, ...rest } = overrides;
  return {
    frequency: 'WEEKLY',
    interval: 1,
    daysOfWeek: [],
    startDate: parseIsoDate(start)!,
    until: null,
    count: null,
    ...rest,
  };
}

const dates = (r: Recurrence, opts = { weekStartsOn: SAT, max: 100 }) =>
  expandRecurrence(r, opts).dates.map((d) => formatIsoDate(d.date));

describe('recurrence', () => {
  it('repeats on selected weekdays until an end date', () => {
    // 2026-10-24 is a Saturday.
    expect(
      dates(
        rule({
          start: '2026-10-24',
          daysOfWeek: [SAT, MON, WED],
          until: parseIsoDate('2026-11-04'),
        }),
      ),
    ).toEqual([
      '2026-10-24',
      '2026-10-26',
      '2026-10-28',
      '2026-10-31',
      '2026-11-02',
      '2026-11-04',
    ]);
  });

  it('starts on the start date even mid-week', () => {
    // Thursday start: the rest of that week's Saturday/Monday/Wednesday are in the past.
    expect(
      dates(rule({ start: '2026-10-22', daysOfWeek: [SAT, MON], count: 3 })),
    ).toEqual(['2026-10-24', '2026-10-26', '2026-10-31']);
  });

  it('skips weeks for every-N-weeks rules, counting weeks from the center’s week start', () => {
    // Weeks start on Saturday: 24 Oct starts week 0, 31 Oct week 1, 7 Nov week 2.
    expect(
      dates(
        rule({
          start: '2026-10-24',
          daysOfWeek: [SAT, MON],
          interval: 2,
          count: 4,
        }),
      ),
    ).toEqual(['2026-10-24', '2026-10-26', '2026-11-07', '2026-11-09']);
    // With Monday-start weeks, Saturday 24 Oct and Monday 26 Oct are in different weeks.
    expect(
      dates(
        rule({
          start: '2026-10-24',
          daysOfWeek: [SAT, MON],
          interval: 2,
          count: 3,
        }),
        { weekStartsOn: MON, max: 100 },
      ),
    ).toEqual(['2026-10-24', '2026-11-02', '2026-11-07']);
  });

  it('repeats daily with an interval', () => {
    expect(
      dates(
        rule({
          start: '2026-10-30',
          frequency: 'DAILY',
          interval: 2,
          until: parseIsoDate('2026-11-05'),
        }),
      ),
    ).toEqual(['2026-10-30', '2026-11-01', '2026-11-03', '2026-11-05']);
  });

  it('uses the month’s last day when a monthly date doesn’t exist, without drifting', () => {
    const result = expandRecurrence(
      rule({ start: '2026-01-31', frequency: 'MONTHLY', count: 4 }),
      { weekStartsOn: SAT, max: 100 },
    );
    expect(
      result.dates.map((d) => [formatIsoDate(d.date), d.adjusted]),
    ).toEqual([
      ['2026-01-31', false],
      ['2026-02-28', true],
      ['2026-03-31', false],
      ['2026-04-30', true],
    ]);
    // Leap years keep the 29th.
    expect(
      dates(rule({ start: '2028-01-29', frequency: 'MONTHLY', count: 2 })),
    ).toEqual(['2028-01-29', '2028-02-29']);
  });

  it('repeats monthly every N months across years', () => {
    expect(
      dates(
        rule({
          start: '2026-11-15',
          frequency: 'MONTHLY',
          interval: 3,
          count: 3,
        }),
      ),
    ).toEqual(['2026-11-15', '2027-02-15', '2027-05-15']);
  });

  it('reports rules that would produce more than the maximum', () => {
    const result = expandRecurrence(
      rule({
        start: '2026-10-24',
        frequency: 'DAILY',
        until: parseIsoDate('2027-10-24'),
      }),
      { weekStartsOn: SAT, max: 100 },
    );
    expect(result.exceeded).toBe(true);
    expect(result.dates).toHaveLength(100);
  });

  it('produces nothing for a weekly rule without days, instead of looping', () => {
    expect(dates(rule({ start: '2026-10-24', count: 5 }))).toEqual([]);
  });
});
