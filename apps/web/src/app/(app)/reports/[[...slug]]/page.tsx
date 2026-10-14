import type { Metadata } from 'next';
import { ChartColumn } from 'lucide-react';

import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const metadata: Metadata = { title: 'Reports' };

export default function Page() {
  return (
    <ModulePlaceholder
      title="Reports"
      description="Attendance, therapist utilisation and collections."
      icon={ChartColumn}
    />
  );
}
