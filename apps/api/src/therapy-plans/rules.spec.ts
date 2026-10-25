import { parseIsoDate } from '../common/time';
import {
  PlanPeriodUnit,
  TherapyPlanStatus as S,
} from '../generated/prisma/enums';
import {
  addInterval,
  canTransition,
  changedGoalLabels,
  changedPlanLabels,
  describeFrequency,
  reviewState,
  type PlanDetails,
} from './rules';

const d = (v: string) => parseIsoDate(v)!;

describe('therapy plan rules', () => {
  it('allows only the defined transitions', () => {
    expect(canTransition('activate', S.DRAFT)).toBe(true);
    expect(canTransition('activate', S.ACTIVE)).toBe(false);
    expect(canTransition('pause', S.ACTIVE)).toBe(true);
    expect(canTransition('pause', S.PAUSED)).toBe(false);
    expect(canTransition('resume', S.PAUSED)).toBe(true);
    expect(canTransition('resume', S.ACTIVE)).toBe(false);
    for (const action of ['complete', 'discontinue'] as const) {
      expect(canTransition(action, S.ACTIVE)).toBe(true);
      expect(canTransition(action, S.PAUSED)).toBe(true);
      expect(canTransition(action, S.DRAFT)).toBe(false);
    }
    // Closed plans are final.
    for (const closed of [S.COMPLETED, S.DISCONTINUED]) {
      for (const action of [
        'activate',
        'pause',
        'resume',
        'complete',
        'discontinue',
      ] as const) {
        expect(canTransition(action, closed)).toBe(false);
      }
    }
  });

  it('describes frequency', () => {
    expect(describeFrequency(3, PlanPeriodUnit.WEEK)).toBe(
      '3 sessions per week',
    );
    expect(describeFrequency(1, PlanPeriodUnit.DAY)).toBe('1 session per day');
    expect(describeFrequency(null, PlanPeriodUnit.WEEK)).toBeNull();
  });

  it('adds review intervals, clamping month ends', () => {
    expect(addInterval(d('2026-10-25'), 8, PlanPeriodUnit.WEEK)).toEqual(
      d('2026-12-20'),
    );
    expect(addInterval(d('2026-01-31'), 1, PlanPeriodUnit.MONTH)).toEqual(
      d('2026-02-28'),
    );
    expect(addInterval(d('2026-11-30'), 3, PlanPeriodUnit.MONTH)).toEqual(
      d('2027-02-28'),
    );
    expect(addInterval(d('2026-10-25'), 10, PlanPeriodUnit.DAY)).toEqual(
      d('2026-11-04'),
    );
  });

  it('flags reviews due only for plans in force', () => {
    const today = d('2026-10-25');
    expect(reviewState(S.ACTIVE, d('2026-10-24'), today)).toBe('OVERDUE');
    expect(reviewState(S.PAUSED, d('2026-10-30'), today)).toBe('DUE_SOON');
    expect(reviewState(S.ACTIVE, d('2026-12-01'), today)).toBeNull();
    expect(reviewState(S.COMPLETED, d('2026-10-01'), today)).toBeNull();
    expect(reviewState(S.DRAFT, d('2026-10-01'), today)).toBeNull();
    expect(reviewState(S.ACTIVE, null, today)).toBeNull();
  });

  it('names changed plan details once each', () => {
    const before = {
      title: 'OT plan',
      sessionsPerPeriod: 3,
      frequencyUnit: 'WEEK',
      durationMinutes: 45,
    } as unknown as PlanDetails;
    expect(
      changedPlanLabels(before, {
        ...before,
        sessionsPerPeriod: 2,
        frequencyUnit: 'MONTH',
      }),
    ).toEqual(['Frequency']);
    expect(changedPlanLabels(before, before)).toEqual([]);
  });

  it('names changed goal fields, comparing values not references', () => {
    const goal = {
      title: 'Fine motor',
      measurementConfig: { unit: 'MINUTES' },
      baselineValue: 2,
      status: 'IN_PROGRESS',
    };
    expect(
      changedGoalLabels(
        goal as never,
        {
          ...goal,
          measurementConfig: { unit: 'MINUTES' },
        } as never,
      ),
    ).toEqual([]);
    expect(
      changedGoalLabels(
        goal as never,
        {
          ...goal,
          baselineValue: 3,
          status: 'ACHIEVED',
        } as never,
      ),
    ).toEqual(['Baseline', 'Status']);
  });
});
