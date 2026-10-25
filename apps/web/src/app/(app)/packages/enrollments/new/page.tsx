import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { NewEnrollmentScreen } from '@/features/packages/enrollment-form';

export const metadata: Metadata = { title: 'Enroll in a package' };

export default function Page() {
  return (
    // Prefilled from the URL (patient, package or the enrollment to renew), read on the client.
    <Suspense fallback={<PageSkeleton />}>
      <NewEnrollmentScreen />
    </Suspense>
  );
}
