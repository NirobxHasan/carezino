import { GoalMeasurementType as T } from '../generated/prisma/enums';
import { storedConfig, validateConfig, valueError } from './measurement';

describe('goal measurement', () => {
  describe('validateConfig', () => {
    it('takes no settings for narrative and percentage goals', () => {
      expect(validateConfig(T.NARRATIVE, undefined)).toEqual({
        config: null,
        errors: {},
      });
      expect(validateConfig(T.PERCENTAGE, {}).config).toBeNull();
      expect(validateConfig(T.NARRATIVE, { unit: 'cm' }).errors).toEqual({
        'measurementConfig.unit': 'Not used by this measurement type',
      });
    });

    it('needs a known unit for durations', () => {
      expect(validateConfig(T.DURATION, {}).errors).toEqual({
        'measurementConfig.unit': 'Choose seconds, minutes or hours',
      });
      expect(validateConfig(T.DURATION, { unit: 'weeks' }).errors).toEqual({
        'measurementConfig.unit': 'Choose seconds, minutes or hours',
      });
      expect(validateConfig(T.DURATION, { unit: 'MINUTES' })).toEqual({
        config: { unit: 'MINUTES' },
        errors: {},
      });
    });

    it('needs a unit for frequency and custom measures, optional for counts', () => {
      expect(Object.keys(validateConfig(T.FREQUENCY, {}).errors)).toEqual([
        'measurementConfig.unit',
      ]);
      expect(
        Object.keys(validateConfig(T.CUSTOM, { unit: ' ' }).errors),
      ).toEqual(['measurementConfig.unit']);
      expect(validateConfig(T.COUNT, {})).toEqual({ config: null, errors: {} });
      expect(
        validateConfig(T.COUNT, { unit: ' successful attempts ' }),
      ).toEqual({
        config: { unit: 'successful attempts' },
        errors: {},
      });
    });

    it('checks rating scales', () => {
      expect(
        validateConfig(T.RATING_SCALE, { scaleMin: 1, scaleMax: 5 }),
      ).toEqual({ config: { scaleMin: 1, scaleMax: 5 }, errors: {} });
      expect(
        validateConfig(T.RATING_SCALE, { scaleMin: 5, scaleMax: 5 }).errors,
      ).toEqual({
        'measurementConfig.scaleMax': 'Must be above the lowest score',
      });
      expect(
        Object.keys(validateConfig(T.RATING_SCALE, { scaleMin: 1.5 }).errors),
      ).toEqual(['measurementConfig.scaleMin', 'measurementConfig.scaleMax']);
    });

    it('refuses settings a type does not use and non-objects', () => {
      expect(
        validateConfig(
          T.PERCENTAGE,
          { scaleMin: 1 },
          'goals.0.measurementConfig',
        ).errors,
      ).toEqual({
        'goals.0.measurementConfig.scaleMin':
          'Not used by this measurement type',
      });
      expect(validateConfig(T.COUNT, 'cm').errors).toEqual({
        measurementConfig: 'Invalid measurement settings',
      });
    });
  });

  describe('valueError', () => {
    it('treats missing values as not recorded', () => {
      expect(valueError(T.PERCENTAGE, null, undefined)).toBeNull();
      expect(valueError(T.NARRATIVE, null, null)).toBeNull();
    });

    it('refuses numbers for narrative goals', () => {
      expect(valueError(T.NARRATIVE, null, 3)).toMatch(/Narrative/);
    });

    it('checks each numeric type', () => {
      expect(valueError(T.PERCENTAGE, null, 80)).toBeNull();
      expect(valueError(T.PERCENTAGE, null, 120)).toMatch(/0 to 100/);
      expect(valueError(T.COUNT, null, 8)).toBeNull();
      expect(valueError(T.COUNT, null, 2.5)).toBe('Enter a whole number');
      expect(valueError(T.DURATION, { unit: 'MINUTES' }, 2.5)).toBeNull();
      expect(valueError(T.FREQUENCY, { unit: 'per session' }, -1)).toBe(
        'Enter zero or more',
      );
      expect(valueError(T.CUSTOM, { unit: 'steps' }, Number.NaN)).toBe(
        'Enter a number',
      );
      const scale = { scaleMin: 1, scaleMax: 5 };
      expect(valueError(T.RATING_SCALE, scale, 4)).toBeNull();
      expect(valueError(T.RATING_SCALE, scale, 6)).toBe(
        'Enter a whole number from 1 to 5',
      );
      expect(valueError(T.RATING_SCALE, scale, 0)).toBe(
        'Enter a whole number from 1 to 5',
      );
    });
  });

  it('reads back only known settings', () => {
    expect(storedConfig({ unit: 'cm', extra: true })).toEqual({ unit: 'cm' });
    expect(storedConfig(null)).toBeNull();
    expect(storedConfig([])).toBeNull();
  });
});
