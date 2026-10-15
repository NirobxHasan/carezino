import type { Metadata } from 'next';

import { CenterSettings } from '@/features/settings/center-settings';

export const metadata: Metadata = { title: 'Center profile' };

export default function Page() {
  return <CenterSettings />;
}
