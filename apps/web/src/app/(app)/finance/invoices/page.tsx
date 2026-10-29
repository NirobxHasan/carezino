import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { InvoicesScreen } from '@/features/finance/invoices-screen';

export const metadata: Metadata = { title: 'Invoices' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InvoicesScreen />
    </Suspense>
  );
}
