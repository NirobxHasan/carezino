import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { CalendarScreen } from '@/features/appointments/calendar-screen';

export const metadata: Metadata = { title: 'Appointment calendar' };

export default function Page() {
  return (
    // View, date and filters live in the URL, read on the client.
    <Suspense fallback={<PageSkeleton />}>
      <CalendarScreen />
    </Suspense>
  );
}
