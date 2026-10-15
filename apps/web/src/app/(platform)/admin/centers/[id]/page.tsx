import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { CenterDetailScreen } from '@/features/platform/centers';

export const metadata: Metadata = { title: 'Center' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CenterDetailScreen />
    </Suspense>
  );
}
