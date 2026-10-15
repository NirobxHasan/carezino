import type { CookieOptions, Response } from 'express';

import { generateToken } from '../common/tokens';

export const SESSION_COOKIE = 'cz_session';
/** Readable by the web app's JavaScript (double-submit CSRF token); carries no authority alone. */
export const CSRF_COOKIE = 'cz_csrf';
export const CSRF_HEADER = 'x-csrf-token';

function base(secure: boolean): CookieOptions {
  return { secure, sameSite: 'lax', path: '/' };
}

export function setSessionCookie(
  res: Response,
  token: string,
  opts: { secure: boolean; persistentUntil?: Date },
) {
  res.cookie(SESSION_COOKIE, token, {
    ...base(opts.secure),
    httpOnly: true,
    // Without an expiry the cookie ends with the browser; the server-side expiry still applies.
    expires: opts.persistentUntil,
  });
}

export function clearSessionCookie(res: Response, secure: boolean) {
  res.clearCookie(SESSION_COOKIE, { ...base(secure), httpOnly: true });
}

/** Issues a fresh CSRF token. Rotated on sign-in and sign-out. */
export function issueCsrfCookie(res: Response, secure: boolean) {
  const token = generateToken();
  res.cookie(CSRF_COOKIE, token, { ...base(secure), httpOnly: false });
  return token;
}
