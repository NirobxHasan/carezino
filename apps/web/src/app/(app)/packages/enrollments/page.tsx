import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { EnrollmentsScreen } from '@/features/packages/enrollments-screen';

export const metadata: Metadata = { title: 'Package enrollments' };

export default function Page() {
  return (
    // Search and filters live in the URL, read on the client.
    <Suspense fallback={<PageSkeleton />}>
      <EnrollmentsScreen />
    </Suspense>
  );
}
