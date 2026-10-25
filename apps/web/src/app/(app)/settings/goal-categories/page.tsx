import type { Metadata } from 'next';

import { GoalCategoriesScreen } from '@/features/settings/goal-categories/categories-screen';

export const metadata: Metadata = { title: 'Goal categories' };

export default function Page() {
  return <GoalCategoriesScreen />;
}
