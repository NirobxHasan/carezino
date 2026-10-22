import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { PatientProfileScreen } from '@/features/patients/patient-profile';

export const metadata: Metadata = { title: 'Patient' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PatientProfileScreen />
    </Suspense>
  );
}
