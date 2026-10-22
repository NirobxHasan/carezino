import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { EditPatientScreen } from '@/features/patients/patient-profile';

export const metadata: Metadata = { title: 'Edit patient' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditPatientScreen />
    </Suspense>
  );
}
