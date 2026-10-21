import type { Metadata } from 'next';

import { ClosuresScreen } from '@/features/settings/closures-screen';

export const metadata: Metadata = { title: 'Holidays & closures' };

export default function Page() {
  return <ClosuresScreen />;
}
