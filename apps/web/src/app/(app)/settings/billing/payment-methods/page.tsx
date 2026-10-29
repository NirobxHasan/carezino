import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { PaymentMethodsScreen } from '@/features/settings/billing/billing-settings';

export const metadata: Metadata = { title: 'Payment methods' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PaymentMethodsScreen />
    </Suspense>
  );
}
