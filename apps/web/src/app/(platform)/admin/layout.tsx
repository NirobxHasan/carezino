import { Suspense } from 'react';

import { FullPageLoader } from '@/components/auth/auth-gate';
import { PlatformGate, PlatformShell } from '@/features/platform/platform-shell';
import { requirePlatformAdmin } from '@/lib/auth/server';

export default function PlatformLayout({ children }: LayoutProps<'/admin'>) {
  return (
    // The session is read per request, so it streams in behind this boundary.
    <Suspense fallback={<FullPageLoader />}>
      <PlatformAdmin>{children}</PlatformAdmin>
    </Suspense>
  );
}

/** Verifies on the server that this is a platform administrator (or redirects). */
async function PlatformAdmin({ children }: { children: React.ReactNode }) {
  const me = await requirePlatformAdmin();
  return (
    <PlatformGate initialMe={me}>
      <PlatformShell>{children}</PlatformShell>
    </PlatformGate>
  );
}
