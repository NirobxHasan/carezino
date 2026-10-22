import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { TherapistScheduleScreen } from '@/features/therapists/therapist-profile';

export const metadata: Metadata = { title: 'Therapist schedule' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TherapistScheduleScreen />
    </Suspense>
  );
}
