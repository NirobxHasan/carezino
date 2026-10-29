import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { ExpenseCategoriesScreen } from '@/features/settings/billing/billing-settings';

export const metadata: Metadata = { title: 'Expense categories' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ExpenseCategoriesScreen />
    </Suspense>
  );
}
