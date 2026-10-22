import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { AssessmentsScreen } from '@/features/assessments/assessments-screen';

export const metadata: Metadata = { title: 'Assessments' };

export default function Page() {
  return (
    // Search and filters live in the URL, read on the client.
    <Suspense fallback={<PageSkeleton />}>
      <AssessmentsScreen />
    </Suspense>
  );
}
