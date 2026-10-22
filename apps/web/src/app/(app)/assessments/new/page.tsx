import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { NewAssessmentScreen } from '@/features/assessments/new-assessment';

export const metadata: Metadata = { title: 'New assessment' };

export default function Page() {
  return (
    // Prefilled from the URL (appointment or patient), read on the client.
    <Suspense fallback={<PageSkeleton />}>
      <NewAssessmentScreen />
    </Suspense>
  );
}
