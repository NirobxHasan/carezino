import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { SessionsScreen } from '@/features/sessions/sessions-screen';

export const metadata: Metadata = { title: 'Sessions' };

export default function Page() {
  return (
    // Search and filters live in the URL, read on the client.
    <Suspense fallback={<PageSkeleton />}>
      <SessionsScreen />
    </Suspense>
  );
}
