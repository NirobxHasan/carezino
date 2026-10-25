import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { PlanDetailsScreen } from '@/features/therapy-plans/plan-details';

export const metadata: Metadata = { title: 'Therapy plan' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PlanDetailsScreen />
    </Suspense>
  );
}
