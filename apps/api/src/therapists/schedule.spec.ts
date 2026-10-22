import {
  intersect,
  normalize,
  subtract,
  unavailableReasons,
  workingWindows,
  type DayFacts,
} from './schedule';

const h = (start: number, end: number) => ({
  start: start * 60,
  end: end * 60,
});

describe('interval arithmetic', () => {
  it('merges overlapping and touching intervals', () => {
    expect(normalize([h(13, 15), h(9, 12), h(12, 13), h(16, 16)])).toEqual([
      h(9, 15),
    ]);
  });

  it('intersects two lists', () => {
    expect(intersect([h(8, 13), h(15, 20)], [h(9, 18)])).toEqual([
      h(9, 13),
      h(15, 18),
    ]);
  });

  it('cuts holes out of intervals', () => {
    expect(subtract([h(9, 17)], [h(12, 13), h(16, 18)])).toEqual([
      h(9, 12),
      h(13, 16),
    ]);
    expect(subtract([h(9, 12)], [h(8, 20)])).toEqual([]);
  });
});

describe('working windows', () => {
  const base: DayFacts = {
    therapistActive: true,
    regular: [h(9, 13), h(15, 18)],
    centerHours: [h(9, 17)],
    closures: [],
    timeOff: [],
    allowOnClosedDays: false,
  };

  it('keeps the therapist inside the center’s opening hours', () => {
    expect(workingWindows(base)).toEqual([h(9, 13), h(15, 17)]);
  });

  it('removes time off and part-day closures', () => {
    expect(
      workingWindows({ ...base, timeOff: [h(10, 11)], closures: [h(16, 24)] }),
    ).toEqual([h(9, 10), h(11, 13), h(15, 16)]);
  });

  it('has nothing on closed days or for inactive therapists', () => {
    expect(workingWindows({ ...base, centerHours: [] })).toEqual([]);
    expect(workingWindows({ ...base, closures: [h(0, 24)] })).toEqual([]);
    expect(workingWindows({ ...base, therapistActive: false })).toEqual([]);
  });

  it('follows the policy that allows booking on closed days', () => {
    const allowed = { ...base, allowOnClosedDays: true };
    expect(workingWindows({ ...allowed, centerHours: [] })).toEqual(
      base.regular,
    );
    expect(workingWindows({ ...allowed, closures: [h(0, 24)] })).toEqual([
      h(9, 13),
      h(15, 17),
    ]);
    // Time off still applies.
    expect(
      workingWindows({ ...allowed, centerHours: [], timeOff: [h(0, 24)] }),
    ).toEqual([]);
  });

  it('explains why a period can’t be worked', () => {
    expect(unavailableReasons(base, 9 * 60, 10 * 60)).toEqual([]);
    expect(unavailableReasons(base, 12 * 60, 14 * 60)).toEqual([
      'OUTSIDE_REGULAR_HOURS',
    ]);
    expect(unavailableReasons(base, 16 * 60, 18 * 60)).toEqual([
      'OUTSIDE_CENTER_HOURS',
    ]);
    expect(
      unavailableReasons(
        { ...base, timeOff: [h(9, 24)], therapistActive: false },
        9 * 60,
        10 * 60,
      ),
    ).toEqual(['THERAPIST_INACTIVE', 'TIME_OFF']);
    expect(
      unavailableReasons({ ...base, centerHours: [] }, 9 * 60, 10 * 60),
    ).toEqual(['CENTER_CLOSED']);
  });
});
