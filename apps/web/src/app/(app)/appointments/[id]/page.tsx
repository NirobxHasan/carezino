import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { AppointmentDetailsScreen } from '@/features/appointments/appointment-details';

export const metadata: Metadata = { title: 'Appointment' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AppointmentDetailsScreen />
    </Suspense>
  );
}
