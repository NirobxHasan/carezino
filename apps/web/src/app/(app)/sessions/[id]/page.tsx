import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { SessionDetailsScreen } from '@/features/sessions/session-details';

export const metadata: Metadata = { title: 'Session' };

export default function Page() {
  return (
    // The session is read on the client from the route's ID.
    <Suspense fallback={<PageSkeleton />}>
      <SessionDetailsScreen />
    </Suspense>
  );
}
