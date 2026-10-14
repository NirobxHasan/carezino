import type { Metadata } from 'next';
import { CalendarDays } from 'lucide-react';

import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const metadata: Metadata = { title: 'Appointments' };

export default function Page() {
  return (
    <ModulePlaceholder
      title="Appointments"
      description="Schedule, reschedule and track therapy sessions."
      icon={CalendarDays}
    />
  );
}
