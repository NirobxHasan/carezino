/** Emails are compared case-insensitively; store and look them up in this form only. */
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

const BD_MOBILE = /^01[3-9]\d{8}$/;

/**
 * Bangladeshi mobile numbers in their 11-digit local form (01XXXXXXXXX). Accepts spaces,
 * dashes and a +88 / 88 prefix. Returns null when the input isn't a valid number.
 */
export function normalizeMobile(input: string): string | null {
  const digits = input
    .trim()
    .replace(/[\s\-()]/g, '')
    .replace(/^\+?88/, '');
  return BD_MOBILE.test(digits) ? digits : null;
}

/**
 * Center phone numbers may be landlines, so they're only cleaned up, not forced into
 * mobile format: digits with an optional leading +, 6 to 15 digits long.
 */
export function normalizePhone(input: string): string | null {
  const cleaned = input.trim().replace(/[\s\-()]/g, '');
  return /^\+?\d{6,15}$/.test(cleaned) ? cleaned : null;
}

/**
 * A mobile number that may be from abroad. Bangladeshi numbers (local, 88… or +88…)
 * become their 11-digit local form; anything else must be international, "+" and
 * country code first, and is stored as +E.164. Returns null when it's neither.
 */
export function normalizeAnyMobile(input: string): string | null {
  const bd = normalizeMobile(input);
  if (bd) return bd;
  const cleaned = input.trim().replace(/[\s\-().]/g, '');
  if (/^\+?88/.test(cleaned)) return null;
  const international = cleaned.replace(/^00/, '+');
  return /^\+[1-9]\d{6,14}$/.test(international) ? international : null;
}
