/** Cookie names set by the API (apps/api/src/auth/cookies.ts). */
export const SESSION_COOKIE = 'cz_session';
export const CSRF_COOKIE = 'cz_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Request header set by proxy.ts so layouts know where to send the user after sign-in. */
export const PATH_HEADER = 'x-carezino-path';

/**
 * Only same-app paths are allowed as post-login destinations, so `?next=` can't be used
 * to bounce someone to another site.
 */
export function safeNext(next: string | null | undefined, fallback = '/dashboard') {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback;
  }
  return next;
}
