import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { FinanceReportsScreen } from '@/features/finance/finance-reports';

export const metadata: Metadata = { title: 'Financial reports' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FinanceReportsScreen />
    </Suspense>
  );
}
