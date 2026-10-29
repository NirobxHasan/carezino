import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { BillableServicesScreen } from '@/features/settings/billing/billing-settings';

export const metadata: Metadata = { title: 'Billable services' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BillableServicesScreen />
    </Suspense>
  );
}
