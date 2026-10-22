import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { EditTherapistScreen } from '@/features/therapists/therapist-profile';

export const metadata: Metadata = { title: 'Edit therapist' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditTherapistScreen />
    </Suspense>
  );
}
