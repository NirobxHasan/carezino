import { z } from 'zod';

/** Shared Zod building blocks so every form validates the same way, with the same wording. */

export const requiredText = (label: string) => z.string().trim().min(1, `${label} is required`);

/** Bangladeshi mobile number: 11 digits starting 01[3-9], optional +88 prefix. */
export const bdPhone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^\+?88/, ''))
  .refine((v) => /^01[3-9]\d{8}$/.test(v), 'Enter an 11-digit mobile number, e.g. 01712-345678');

export const optionalEmail = z
  .string()
  .trim()
  .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email address');

export const isoDate = (label: string) =>
  z.string({ error: `${label} is required` }).regex(/^\d{4}-\d{2}-\d{2}$/, `${label} is required`);

export const takaAmount = z.coerce
  .number({ error: 'Enter an amount' })
  .positive('Amount must be more than ৳0');

/** Same rule as the API: 8–128 characters. */
export const newPassword = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters');

/** Adds a "passwords match" check to a schema with password + confirmPassword fields. */
export function withPasswordConfirmation<
  T extends z.ZodType<{ password: string; confirmPassword: string }>,
>(schema: T) {
  return schema.refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords don’t match',
    path: ['confirmPassword'],
  });
}

/** Optional BD mobile: empty is fine, anything else must be a valid number. */
export const optionalBdPhone = z
  .string()
  .trim()
  .refine(
    (v) => v === '' || /^01[3-9]\d{8}$/.test(v.replace(/[\s-]/g, '').replace(/^\+?88/, '')),
    'Enter an 11-digit mobile number, e.g. 01712-345678',
  );

/** Center phone: mobile or landline. */
export const anyPhone = z
  .string()
  .trim()
  .min(1, 'Phone is required')
  .refine((v) => /^\+?\d{6,15}$/.test(v.replace(/[\s\-()]/g, '')), 'Enter a valid phone number');

/** Optional website; "example.com" is accepted and the API adds https://. */
export const optionalUrl = z
  .string()
  .trim()
  .refine(
    (v) => v === '' || /^(https?:\/\/)?[^\s/$.?#].[^\s]*\.[^\s]{2,}$/i.test(v),
    'Enter a valid website address',
  );
