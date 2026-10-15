import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { StaffDetailScreen } from '@/features/settings/staff/staff-detail';

export const metadata: Metadata = { title: 'Staff member' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StaffDetailScreen />
    </Suspense>
  );
}
