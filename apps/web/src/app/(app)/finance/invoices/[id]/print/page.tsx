import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { InvoicePrintScreen } from '@/features/finance/print';

export const metadata: Metadata = { title: 'Print invoice' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InvoicePrintScreen />
    </Suspense>
  );
}
