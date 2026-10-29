import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { PaymentsScreen } from '@/features/finance/payments-screen';

export const metadata: Metadata = { title: 'Payments' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PaymentsScreen />
    </Suspense>
  );
}
