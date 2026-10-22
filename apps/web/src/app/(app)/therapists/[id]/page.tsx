import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { TherapistProfileScreen } from '@/features/therapists/therapist-profile';

export const metadata: Metadata = { title: 'Therapist' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TherapistProfileScreen />
    </Suspense>
  );
}
