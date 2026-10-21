import type { Metadata } from 'next';

import { WorkingHoursScreen } from '@/features/settings/working-hours-screen';

export const metadata: Metadata = { title: 'Working hours' };

export default function Page() {
  return <WorkingHoursScreen />;
}
