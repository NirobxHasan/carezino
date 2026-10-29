import { Transform } from 'class-transformer';
import {
  IsString,
  Matches,
  ValidateBy,
  ValidateIf,
  type ValidationOptions,
} from 'class-validator';

import {
  normalizeAnyMobile,
  normalizeEmail,
  normalizeMobile,
  normalizePhone,
} from './identifiers';

/** Applies several property decorators as one. */
export const applyAll =
  (decorators: PropertyDecorator[]): PropertyDecorator =>
  (target, key) =>
    decorators.forEach((d) => d(target, key));

/** "ACTIVE,EXPIRED" or ?status=ACTIVE&status=EXPIRED → an array */
export const CommaList = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.split(',').filter(Boolean)
      : Array.isArray(value)
        ? value.flatMap((v) => String(v).split(',')).filter(Boolean)
        : value,
  );

/** Up to 10 digits and 2 decimals, matching NUMERIC(12, 2) */
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const MONEY_MESSAGE = 'Enter an amount, e.g. 9000 or 9000.50';

/**
 * Money as a decimal string, never a float: numbers are turned into their exact
 * decimal text first, so 9000.5 arrives as "9000.5". Anything with more than two
 * decimals (including float artefacts like 0.30000000000000004) is rejected.
 */
export const Money = (message = MONEY_MESSAGE) =>
  applyAll([
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'number'
        ? String(value)
        : typeof value === 'string'
          ? value.trim().replace(/,/g, '')
          : value,
    ),
    IsString({ message }),
    Matches(MONEY, { message }),
  ]);

/** Trims strings and turns empty strings into undefined, so optional fields stay optional. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });

/**
 * For PATCH fields that are optional but can't be cleared: unlike IsOptional, which
 * skips validation for null too, this only skips absent fields, so null is rejected.
 */
export const IfPresent = () =>
  ValidateIf((_: unknown, value: unknown) => value !== undefined);

/** Like Trim, but an empty string becomes null so PATCH requests can clear a field. */
export const TrimOrNull = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  });

/** Lower-cases and trims; an empty string becomes undefined, or null with `clearable`. */
export const NormalizeEmail = ({ clearable = false } = {}) =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const email = normalizeEmail(value);
    if (email === '') return clearable ? null : undefined;
    return email;
  });

/**
 * Normalizes a BD mobile number; leaves invalid input as-is for IsMobile to reject. An
 * empty string becomes undefined, or null with `clearable` so a PATCH can remove it.
 */
export const NormalizeMobile = ({ clearable = false } = {}) =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    if (value.trim() === '') return clearable ? null : undefined;
    return normalizeMobile(value) ?? value;
  });

/**
 * Like NormalizeMobile, but also accepts international numbers (see normalizeAnyMobile).
 * With `emptyAsNull`, an empty string becomes null so a PATCH can't silently skip it.
 */
export const NormalizeAnyMobile = ({ emptyAsNull = false } = {}) =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    if (value.trim() === '') return emptyAsNull ? null : undefined;
    return normalizeAnyMobile(value) ?? value;
  });

/** "example.com/me.jpg" → "https://example.com/me.jpg"; empty → null so it can be cleared. */
export const NormalizeUrl = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (trimmed === '') return null;
    return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
  });

/** IsUrl options for links stored after NormalizeUrl, such as photos. */
export const URL_OPTIONS = {
  protocols: ['http', 'https'],
  require_protocol: true,
};

/** Empty strings from cleared selects become null. */
export const EmptyToNull = () =>
  Transform(({ value }: { value: unknown }) => (value === '' ? null : value));

export const NormalizePhone = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    return normalizePhone(value) ?? value.trim();
  });

export function IsMobile(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isMobile',
      validator: {
        validate: (value) =>
          typeof value === 'string' && normalizeMobile(value) === value,
        defaultMessage: () =>
          'Enter an 11-digit mobile number, e.g. 01712-345678',
      },
    },
    options,
  );
}

export function IsAnyMobile(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isAnyMobile',
      validator: {
        validate: (value) =>
          typeof value === 'string' && normalizeAnyMobile(value) === value,
        defaultMessage: () =>
          'Enter a mobile number, e.g. 01712-345678, or +44… for numbers abroad',
      },
    },
    options,
  );
}

export function IsPhone(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isPhone',
      validator: {
        validate: (value) =>
          typeof value === 'string' && normalizePhone(value) === value,
        defaultMessage: () => 'Enter a valid phone number',
      },
    },
    options,
  );
}

/** Password policy, shared by registration, reset, change and invitation acceptance. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
