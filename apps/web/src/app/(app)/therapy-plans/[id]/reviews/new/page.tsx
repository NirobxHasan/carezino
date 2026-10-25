import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { NewReviewRouteScreen } from '@/features/therapy-plans/plan-pages';

export const metadata: Metadata = { title: 'Review therapy plan' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewReviewRouteScreen />
    </Suspense>
  );
}
