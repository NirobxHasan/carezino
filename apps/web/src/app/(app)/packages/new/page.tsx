import type { Metadata } from 'next';

import { NewPackageScreen } from '@/features/packages/package-form';

export const metadata: Metadata = { title: 'Add package' };

export default function Page() {
  return <NewPackageScreen />;
}
