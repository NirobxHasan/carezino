import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { PackagesScreen } from '@/features/packages/packages-screen';

export const metadata: Metadata = { title: 'Therapy packages' };

export default function Page() {
  return (
    // Search and filters live in the URL, read on the client.
    <Suspense fallback={<PageSkeleton />}>
      <PackagesScreen />
    </Suspense>
  );
}
