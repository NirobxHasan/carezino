import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { DuesScreen } from '@/features/finance/dues-screen';

export const metadata: Metadata = { title: 'Outstanding dues' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DuesScreen />
    </Suspense>
  );
}
