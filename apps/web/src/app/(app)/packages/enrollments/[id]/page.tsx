import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { EnrollmentDetailsScreen } from '@/features/packages/enrollment-details';

export const metadata: Metadata = { title: 'Package enrollment' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EnrollmentDetailsScreen />
    </Suspense>
  );
}
