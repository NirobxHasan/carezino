import { GoalMeasurementType } from '../generated/prisma/enums';

/**
 * How a goal is measured: one flexible schema for every therapy type, with no scoring.
 * The type says what kind of number (if any) baseline, target and progress values are;
 * the configuration adds the unit or scale. Values are only ever checked against it,
 * never used to decide a goal's status: that stays a clinical judgement.
 *
 * - NARRATIVE: text only, no numbers at all.
 * - PERCENTAGE: 0–100.
 * - COUNT: a whole number ≥ 0, with an optional unit label ("successful attempts").
 * - DURATION: ≥ 0 in seconds, minutes or hours (config.unit, required).
 * - FREQUENCY: ≥ 0 per some period, described by config.unit ("times per session").
 * - RATING_SCALE: a whole number from config.scaleMin to config.scaleMax.
 * - CUSTOM: ≥ 0 in a unit the clinician names (config.unit, required).
 */

export const DURATION_UNITS = ['SECONDS', 'MINUTES', 'HOURS'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export interface MeasurementConfig {
  unit?: string;
  scaleMin?: number;
  scaleMax?: number;
}

export const MEASUREMENT_LIMITS = {
  unit: 40,
  scale: { min: 0, max: 100, maxSteps: 100 },
  value: 1_000_000,
} as const;

export type Errors = Record<string, string>;

const NUMERIC = new Set<GoalMeasurementType>([
  GoalMeasurementType.PERCENTAGE,
  GoalMeasurementType.COUNT,
  GoalMeasurementType.DURATION,
  GoalMeasurementType.FREQUENCY,
  GoalMeasurementType.RATING_SCALE,
  GoalMeasurementType.CUSTOM,
]);

export const isNumeric = (type: GoalMeasurementType) => NUMERIC.has(type);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The configuration for a measurement type, normalized, or errors keyed by
 * `${path}.unit` etc. Unknown properties and properties the type doesn't use are
 * refused rather than kept, so stored configurations stay exactly what the type means.
 */
export function validateConfig(
  type: GoalMeasurementType,
  input: unknown,
  path = 'measurementConfig',
): { config: MeasurementConfig | null; errors: Errors } {
  const errors: Errors = {};
  if (input !== undefined && input !== null && !isPlainObject(input)) {
    return { config: null, errors: { [path]: 'Invalid measurement settings' } };
  }
  const raw = input ?? {};
  const allowed: Record<GoalMeasurementType, string[]> = {
    NARRATIVE: [],
    PERCENTAGE: [],
    COUNT: ['unit'],
    DURATION: ['unit'],
    FREQUENCY: ['unit'],
    RATING_SCALE: ['scaleMin', 'scaleMax'],
    CUSTOM: ['unit'],
  };
  for (const key of Object.keys(raw)) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === '')
      continue;
    if (!allowed[type].includes(key)) {
      errors[`${path}.${key}`] = 'Not used by this measurement type';
    }
  }

  const config: MeasurementConfig = {};
  if (allowed[type].includes('unit')) {
    const unit = typeof raw.unit === 'string' ? raw.unit.trim() : raw.unit;
    if (unit !== undefined && unit !== null && unit !== '') {
      if (typeof unit !== 'string') errors[`${path}.unit`] = 'Enter a unit';
      else if (unit.length > MEASUREMENT_LIMITS.unit) {
        errors[`${path}.unit`] =
          `Use up to ${MEASUREMENT_LIMITS.unit} characters`;
      } else config.unit = unit;
    }
    if (type === GoalMeasurementType.DURATION) {
      if (!config.unit)
        errors[`${path}.unit`] = 'Choose seconds, minutes or hours';
      else if (!(DURATION_UNITS as readonly string[]).includes(config.unit)) {
        errors[`${path}.unit`] = 'Choose seconds, minutes or hours';
      }
    }
    if (
      (type === GoalMeasurementType.CUSTOM ||
        type === GoalMeasurementType.FREQUENCY) &&
      !config.unit
    ) {
      errors[`${path}.unit`] =
        type === GoalMeasurementType.FREQUENCY
          ? 'Say per what, e.g. “times per session”'
          : 'Name the unit';
    }
  }

  if (type === GoalMeasurementType.RATING_SCALE) {
    const { min, max, maxSteps } = MEASUREMENT_LIMITS.scale;
    const whole = (v: unknown) =>
      typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
    if (!whole(raw.scaleMin)) {
      errors[`${path}.scaleMin`] = `Enter a whole number from ${min} to ${max}`;
    }
    if (!whole(raw.scaleMax)) {
      errors[`${path}.scaleMax`] = `Enter a whole number from ${min} to ${max}`;
    }
    if (whole(raw.scaleMin) && whole(raw.scaleMax)) {
      const lo = raw.scaleMin as number;
      const hi = raw.scaleMax as number;
      if (hi <= lo)
        errors[`${path}.scaleMax`] = 'Must be above the lowest score';
      else if (hi - lo > maxSteps) {
        errors[`${path}.scaleMax`] = `Use a scale of up to ${maxSteps} steps`;
      } else {
        config.scaleMin = lo;
        config.scaleMax = hi;
      }
    }
  }

  const keys = Object.keys(config);
  return { config: keys.length ? config : null, errors };
}

/**
 * Checks one numeric value (baseline, target or progress) against the goal's
 * measurement. Returns an error message, or null when it's valid. `undefined`/`null`
 * values are "not recorded" and always valid; NARRATIVE goals take no number at all.
 */
export function valueError(
  type: GoalMeasurementType,
  config: MeasurementConfig | null,
  value: unknown,
): string | null {
  if (value === undefined || value === null) return null;
  if (!isNumeric(type)) return 'Narrative goals don’t take a number';
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Enter a number';
  }
  if (value < 0) return 'Enter zero or more';
  switch (type) {
    case GoalMeasurementType.PERCENTAGE:
      return value > 100 ? 'Enter a percentage from 0 to 100' : null;
    case GoalMeasurementType.COUNT:
      if (!Number.isInteger(value)) return 'Enter a whole number';
      break;
    case GoalMeasurementType.RATING_SCALE: {
      const lo = config?.scaleMin ?? 0;
      const hi = config?.scaleMax ?? 0;
      if (!Number.isInteger(value) || value < lo || value > hi) {
        return `Enter a whole number from ${lo} to ${hi}`;
      }
      return null;
    }
  }
  return value > MEASUREMENT_LIMITS.value
    ? `Enter up to ${MEASUREMENT_LIMITS.value.toLocaleString('en-US')}`
    : null;
}

/** The stored configuration as typed data; anything unexpected is dropped. */
export function storedConfig(value: unknown): MeasurementConfig | null {
  if (!isPlainObject(value)) return null;
  const config: MeasurementConfig = {};
  if (typeof value.unit === 'string') config.unit = value.unit;
  if (typeof value.scaleMin === 'number') config.scaleMin = value.scaleMin;
  if (typeof value.scaleMax === 'number') config.scaleMax = value.scaleMax;
  return Object.keys(config).length ? config : null;
}
