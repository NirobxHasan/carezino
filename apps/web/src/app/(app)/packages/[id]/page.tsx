import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { EditPackageScreen } from '@/features/packages/package-form';

export const metadata: Metadata = { title: 'Edit package' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditPackageScreen />
    </Suspense>
  );
}
