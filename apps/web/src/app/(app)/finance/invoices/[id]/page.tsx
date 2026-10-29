import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { InvoiceDetailsScreen } from '@/features/finance/invoice-details';

export const metadata: Metadata = { title: 'Invoice' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InvoiceDetailsScreen />
    </Suspense>
  );
}
