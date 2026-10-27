import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { MySessionsScreen } from '@/features/sessions/my-sessions';

export const metadata: Metadata = { title: 'My sessions' };

export default function Page() {
  return (
    // Read on the client: the signed-in therapist's own sessions.
    <Suspense fallback={<PageSkeleton />}>
      <MySessionsScreen />
    </Suspense>
  );
}
