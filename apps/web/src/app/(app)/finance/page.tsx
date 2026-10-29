import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { FinanceOverviewScreen } from '@/features/finance/finance-overview';

export const metadata: Metadata = { title: 'Finance' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FinanceOverviewScreen />
    </Suspense>
  );
}
