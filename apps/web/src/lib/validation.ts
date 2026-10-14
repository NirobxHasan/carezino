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
