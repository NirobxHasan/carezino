import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { EditPlanScreen } from '@/features/therapy-plans/plan-pages';

export const metadata: Metadata = { title: 'Edit therapy plan' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditPlanScreen />
    </Suspense>
  );
}
