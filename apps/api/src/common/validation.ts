import { Transform } from 'class-transformer';
import { ValidateBy, type ValidationOptions } from 'class-validator';

import { normalizeEmail, normalizeMobile, normalizePhone } from './identifiers';

/** Trims strings and turns empty strings into undefined, so optional fields stay optional. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });

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
