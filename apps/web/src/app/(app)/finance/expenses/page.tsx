import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { ExpensesScreen } from '@/features/finance/expenses-screen';

export const metadata: Metadata = { title: 'Expenses' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ExpensesScreen />
    </Suspense>
  );
}
