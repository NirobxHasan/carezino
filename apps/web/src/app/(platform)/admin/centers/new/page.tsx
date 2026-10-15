import type { Metadata } from 'next';

import { NewCenterScreen } from '@/features/platform/centers';

export const metadata: Metadata = { title: 'Register a center' };

export default function Page() {
  return <NewCenterScreen />;
}
