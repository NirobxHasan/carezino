import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { PaymentDetailsScreen } from '@/features/finance/payments-screen';

export const metadata: Metadata = { title: 'Payment' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PaymentDetailsScreen />
    </Suspense>
  );
}
