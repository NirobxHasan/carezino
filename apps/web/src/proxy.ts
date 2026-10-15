import { NextResponse, type NextRequest } from 'next/server';

import { PATH_HEADER, SESSION_COOKIE } from '@/lib/auth/constants';
import { fetchSession, redirectFor } from '@/lib/auth/session-api';

/**
 * Runs on full page loads of protected routes and sends the visitor where they belong
 * before anything renders: to sign in without a valid session, and elsewhere when the
 * page isn't for them (e.g. center staff opening /admin). The layouts repeat the check
 * for client-side navigations, and the API authorizes every data request regardless.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === '/admin/login') return NextResponse.next();
  const here = `${pathname}${search}`;
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  const toSignIn = () => {
    // Super admins and center staff have separate sign-in pages.
    const adminArea = pathname === '/admin' || pathname.startsWith('/admin/');
    const login = new URL(adminArea ? '/admin/login' : '/login', request.url);
    if (pathname !== '/' && pathname !== '/admin') login.searchParams.set('next', here);
    const res = NextResponse.redirect(login);
    // A cookie the API no longer accepts is just clutter.
    if (token) res.cookies.delete(SESSION_COOKIE);
    return res;
  };

  if (!token) return toSignIn();

  let me;
  try {
    me = await fetchSession(token, request.headers.get('x-forwarded-for'));
  } catch {
    me = undefined; // API unreachable: let the page render and report it.
  }
  if (me === null) return toSignIn();
  const elsewhere = me ? redirectFor(me, pathname) : null;
  if (elsewhere) return NextResponse.redirect(new URL(elsewhere, request.url));

  // Layouts use this to send the user back here if they have to sign in again.
  const forwarded = new Headers(request.headers);
  forwarded.set(PATH_HEADER, here);
  return NextResponse.next({ request: { headers: forwarded } });
}

export const config = {
  matcher: [
    {
      // Everything except the API proxy, Next.js assets, files and the public auth pages.
      source:
        '/((?!api/|_next/|login|register|forgot-password|reset-password|invite|.*\\.[a-z0-9]+$).*)',
      // Page loads only: prefetches and client-side navigations (RSC requests) skip the
      // API round trip; the layouts check those.
      missing: [
        { type: 'header', key: 'rsc' },
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
