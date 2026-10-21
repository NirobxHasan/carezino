import type { Metadata } from 'next';

import { SchedulingSettingsScreen } from '@/features/settings/scheduling-settings';

export const metadata: Metadata = { title: 'Scheduling' };

export default function Page() {
  return <SchedulingSettingsScreen />;
}
