import type { Me } from '../types';
import { SESSION_COOKIE } from './constants';

/** Same default as the /api rewrite in next.config.ts. */
const API_URL = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

/**
 * Asks the API who owns a session token. Resolves to null for no valid session; throws
 * when the API can't be reached. Server-side only (proxy and layouts).
 */
export async function fetchSession(token: string, forwardedFor: string | null) {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/session`, {
      headers: {
        cookie: `${SESSION_COOKIE}=${token}`,
        // Keeps the API's per-client rate limits per client, not per web server.
        ...(forwardedFor && { 'x-forwarded-for': forwardedFor }),
      },
      cache: 'no-store',
    });
  } catch {
    throw new Error('Carezino can’t reach its server right now. Please try again shortly.');
  }
  if (!res.ok) throw new Error('Carezino couldn’t check your session. Please try again.');
  return ((await res.json()) as { me: Me | null }).me;
}

/** Where a signed-in user belongs when they can't use the page they asked for. */
export function homeFor(me: Me) {
  if (me.activeCenter) return '/dashboard';
  return me.user.isPlatformAdmin && !me.centers.length ? '/admin' : '/select-center';
}

/**
 * Where to send a signed-in user instead of `pathname`, or null when they may stay.
 * Shared by proxy.ts (before rendering) and the protected layouts (as a backstop).
 */
export function redirectFor(me: Me, pathname: string): string | null {
  const adminArea = pathname === '/admin' || pathname.startsWith('/admin/');
  if (adminArea) return me.user.isPlatformAdmin ? null : homeFor(me);
  if (pathname === '/select-center') {
    return me.user.isPlatformAdmin && !me.centers.length ? '/admin' : null;
  }
  return me.activeCenter ? null : homeFor(me);
}
