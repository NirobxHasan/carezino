import type { Metadata } from 'next';

import { CentersScreen } from '@/features/platform/centers';

export const metadata: Metadata = { title: 'Therapy centers' };

export default function Page() {
  return <CentersScreen />;
}
