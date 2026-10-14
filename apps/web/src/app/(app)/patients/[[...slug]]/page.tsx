import type { Metadata } from 'next';
import { Users } from 'lucide-react';

import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const metadata: Metadata = { title: 'Patients' };

export default function Page() {
  return (
    <ModulePlaceholder
      title="Patients"
      description="Everyone registered at your center, with their guardians and therapy."
      icon={Users}
    />
  );
}
