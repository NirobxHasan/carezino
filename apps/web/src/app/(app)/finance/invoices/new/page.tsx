import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { NewInvoiceScreen } from '@/features/finance/invoice-form';

export const metadata: Metadata = { title: 'New invoice' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewInvoiceScreen />
    </Suspense>
  );
}
