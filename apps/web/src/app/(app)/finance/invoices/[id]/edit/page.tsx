import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { EditInvoiceScreen } from '@/features/finance/invoice-form';

export const metadata: Metadata = { title: 'Edit invoice' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditInvoiceScreen />
    </Suspense>
  );
}
