import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { ReceiptScreen } from '@/features/finance/print';

export const metadata: Metadata = { title: 'Receipt' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReceiptScreen />
    </Suspense>
  );
}
