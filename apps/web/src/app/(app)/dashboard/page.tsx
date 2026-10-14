import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { DashboardScreen } from '@/features/dashboard/dashboard-screen';

export const metadata: Metadata = { title: 'Dashboard' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DashboardScreen />
    </Suspense>
  );
}
