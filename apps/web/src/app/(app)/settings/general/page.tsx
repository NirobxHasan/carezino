import type { Metadata } from 'next';

import { GeneralSettingsScreen } from '@/features/settings/general-settings';

export const metadata: Metadata = { title: 'General settings' };

export default function Page() {
  return <GeneralSettingsScreen />;
}
