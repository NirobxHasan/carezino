import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { NewAppointmentScreen } from '@/features/appointments/booking-form';

export const metadata: Metadata = { title: 'Book appointment' };

export default function Page() {
  return (
    // Prefills (patient, therapist, date, time) come from the URL, read on the client.
    <Suspense fallback={<PageSkeleton />}>
      <NewAppointmentScreen />
    </Suspense>
  );
}
