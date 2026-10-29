import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { BillingSettingsScreen } from '@/features/settings/billing/billing-settings';

export const metadata: Metadata = { title: 'Billing settings' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BillingSettingsScreen />
    </Suspense>
  );
}
