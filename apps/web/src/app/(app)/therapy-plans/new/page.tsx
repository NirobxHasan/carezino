import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { NewPlanScreen } from '@/features/therapy-plans/plan-pages';

export const metadata: Metadata = { title: 'New therapy plan' };

export default function Page() {
  return (
    // Prefilled from the URL (patient or assessment), read on the client.
    <Suspense fallback={<PageSkeleton />}>
      <NewPlanScreen />
    </Suspense>
  );
}
