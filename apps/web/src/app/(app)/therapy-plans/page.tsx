import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { TherapyPlansScreen } from '@/features/therapy-plans/plans-screen';

export const metadata: Metadata = { title: 'Therapy plans' };

export default function Page() {
  return (
    // Search and filters live in the URL, read on the client.
    <Suspense fallback={<PageSkeleton />}>
      <TherapyPlansScreen />
    </Suspense>
  );
}
