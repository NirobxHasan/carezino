'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { LogoMark } from '@/components/brand/logo';
import { useMe } from '@/lib/api/auth';
import { homeFor } from '@/lib/auth/session-api';
import { SessionContext } from '@/lib/session';
import type { Me } from '@/lib/types';

export type SessionValue = Me & { activeCenter: NonNullable<Me['activeCenter']> };

function currentPath() {
  return `${window.location.pathname}${window.location.search}`;
}

export function FullPageLoader({ label = 'Loading Carezino…' }: { label?: string }) {
  return (
    <div
      className="grid min-h-dvh place-items-center bg-background"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3">
        <LogoMark className="size-10 animate-pulse" />
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

/**
 * Client side of the center app's session. The layout has already verified the session
 * on the server (`initialMe`), so the page always renders. This keeps it current as it
 * changes in the browser (center switch, profile edits) and sends the user away when it
 * ends (sign-out elsewhere, expiry, deactivation). The API authorizes every request.
 */
export function AuthGate({
  initialMe,
  children,
}: {
  initialMe: SessionValue;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { data: me } = useMe(initialMe);

  React.useEffect(() => {
    if (me === null) router.replace(`/login?next=${encodeURIComponent(currentPath())}`);
    else if (me && !me.activeCenter) router.replace(homeFor(me));
  }, [me, router]);

  // While a redirect is under way, keep showing the last valid session.
  const value = me?.activeCenter ? (me as SessionValue) : initialMe;
  return <SessionContext value={value}>{children}</SessionContext>;
}
