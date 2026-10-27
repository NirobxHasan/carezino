import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { TodaySessionsScreen } from '@/features/sessions/today-screen';

export const metadata: Metadata = { title: 'Today’s sessions' };

export default function Page() {
  return (
    // The day, search and filters live in the URL, read on the client.
    <Suspense fallback={<PageSkeleton />}>
      <TodaySessionsScreen />
    </Suspense>
  );
}
