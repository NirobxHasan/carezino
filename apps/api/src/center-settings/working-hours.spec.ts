import { toWeek, validateWeek, type DayInput } from './working-hours';

const closedWeek = (): DayInput[] =>
  Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, intervals: [] }));

function weekWith(dayOfWeek: number, intervals: DayInput['intervals']) {
  const week = closedWeek();
  week[dayOfWeek] = { dayOfWeek, intervals };
  return week;
}

describe('validateWeek', () => {
  it('turns open days into rows and leaves closed days empty', () => {
    const { rows, errors } = validateWeek(
      weekWith(6, [
        { start: '14:00', end: '18:00' },
        { start: '09:00', end: '13:00' },
      ]),
    );
    expect(errors).toEqual({});
    expect(rows).toEqual([
      { dayOfWeek: 6, startMinutes: 540, endMinutes: 780 },
      { dayOfWeek: 6, startMinutes: 840, endMinutes: 1080 },
    ]);
  });

  it('accepts a fully closed week', () => {
    expect(validateWeek(closedWeek())).toEqual({ rows: [], errors: {} });
  });

  it('rejects overlapping intervals, pointing at the later one', () => {
    const { errors } = validateWeek(
      weekWith(1, [
        { start: '09:00', end: '13:00' },
        { start: '12:30', end: '18:00' },
      ]),
    );
    expect(errors).toEqual({
      'days.1.intervals.1.start': 'Overlaps 09:00–13:00',
    });
  });

  it('allows intervals that only touch', () => {
    const { errors } = validateWeek(
      weekWith(1, [
        { start: '09:00', end: '13:00' },
        { start: '13:00', end: '18:00' },
      ]),
    );
    expect(errors).toEqual({});
  });

  it('requires opening before closing', () => {
    const { errors } = validateWeek(
      weekWith(2, [
        { start: '18:00', end: '09:00' },
        { start: '10:00', end: '10:00' },
      ]),
    );
    expect(errors).toEqual({
      'days.2.intervals.0.end': 'Closing time must be after opening time',
      'days.2.intervals.1.end': 'Closing time must be after opening time',
    });
  });

  it('rejects malformed times and repeated days', () => {
    const week = weekWith(0, [{ start: '9am', end: '24:00' }]);
    week[1] = { dayOfWeek: 0, intervals: [] };
    const { errors } = validateWeek(week);
    expect(errors).toEqual({
      'days.0.intervals.0.start': 'Enter a time like 09:00',
      'days.0.intervals.0.end': 'Enter a time like 18:00',
      'days.1.dayOfWeek': 'Each day can only appear once',
    });
  });
});

describe('toWeek', () => {
  it('returns all seven days in order with sorted intervals', () => {
    const week = toWeek([
      { dayOfWeek: 6, startMinutes: 840, endMinutes: 1080 },
      { dayOfWeek: 6, startMinutes: 540, endMinutes: 780 },
    ]);
    expect(week).toHaveLength(7);
    expect(week[5]).toEqual({ dayOfWeek: 5, isOpen: false, intervals: [] });
    expect(week[6]).toEqual({
      dayOfWeek: 6,
      isOpen: true,
      intervals: [
        { start: '09:00', end: '13:00' },
        { start: '14:00', end: '18:00' },
      ],
    });
  });
});
