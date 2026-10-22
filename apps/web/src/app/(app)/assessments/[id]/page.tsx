import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { AssessmentDetailsScreen } from '@/features/assessments/assessment-details';

export const metadata: Metadata = { title: 'Assessment' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AssessmentDetailsScreen />
    </Suspense>
  );
}
