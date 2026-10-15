import 'server-only';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import type { ActiveCenter, Me } from '../types';
import { PATH_HEADER, SESSION_COOKIE, safeNext } from './constants';
import { fetchSession, homeFor } from './session-api';

export type CenterSession = Me & { activeCenter: ActiveCenter };

/**
 * Reads the signed-in user on the server by asking the API about this request's session
 * cookie. Returns null when there's no valid session. Reads request data, so call it
 * inside a <Suspense> boundary.
 */
export async function getServerMe(): Promise<Me | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return fetchSession(token, (await headers()).get('x-forwarded-for'));
}

async function signInUrl(page: '/login' | '/admin/login') {
  const next = safeNext((await headers()).get(PATH_HEADER), '');
  return next && next !== '/' ? `${page}?next=${encodeURIComponent(next)}` : page;
}

/*
 * proxy.ts already redirects page loads that don't belong here, before rendering. These
 * checks are the backstop for requests it doesn't see (client-side navigations).
 */

/** For the center app: a signed-in user working in a center, or a redirect. */
export async function requireCenterSession(): Promise<CenterSession> {
  const me = await getServerMe();
  if (!me) redirect(await signInUrl('/login'));
  if (!me.activeCenter) redirect(homeFor(me));
  return me as CenterSession;
}

/** For the super admin area: a platform administrator, or a redirect. */
export async function requirePlatformAdmin(): Promise<Me> {
  const me = await getServerMe();
  if (!me) redirect(await signInUrl('/admin/login'));
  if (!me.user.isPlatformAdmin) redirect(homeFor(me));
  return me;
}
