import { Suspense } from 'react';

import { AuthGate, FullPageLoader } from '@/components/auth/auth-gate';
import { AppShell } from '@/components/layout/app-shell';
import { requireCenterSession } from '@/lib/auth/server';

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    // The session is read per request, so it streams in behind this boundary.
    <Suspense fallback={<FullPageLoader />}>
      <SignedIn>{children}</SignedIn>
    </Suspense>
  );
}

/** Verifies the session on the server (or redirects) before rendering the app. */
async function SignedIn({ children }: { children: React.ReactNode }) {
  const me = await requireCenterSession();
  return (
    <AuthGate initialMe={me}>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
