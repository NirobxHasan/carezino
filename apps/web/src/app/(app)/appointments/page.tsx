import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { AppointmentsScreen } from '@/features/appointments/appointments-screen';

export const metadata: Metadata = { title: 'Appointments' };

export default function Page() {
  return (
    // Search and filters live in the URL, read on the client.
    <Suspense fallback={<PageSkeleton />}>
      <AppointmentsScreen />
    </Suspense>
  );
}
