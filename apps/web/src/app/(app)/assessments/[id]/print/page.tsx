import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { AssessmentPrintScreen } from '@/features/assessments/assessment-print';

export const metadata: Metadata = { title: 'Assessment summary' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AssessmentPrintScreen />
    </Suspense>
  );
}
