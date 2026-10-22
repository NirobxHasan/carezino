import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { PatientsScreen } from '@/features/patients/patients-screen';

export const metadata: Metadata = { title: 'Patients' };

export default function Page() {
  return (
    // Search and filters live in the URL, read on the client.
    <Suspense fallback={<PageSkeleton />}>
      <PatientsScreen />
    </Suspense>
  );
}
