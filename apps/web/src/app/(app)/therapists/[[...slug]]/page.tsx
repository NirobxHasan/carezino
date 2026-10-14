import type { Metadata } from 'next';
import { Stethoscope } from 'lucide-react';

import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const metadata: Metadata = { title: 'Therapists' };

export default function Page() {
  return (
    <ModulePlaceholder
      title="Therapists"
      description="Your therapy team, their specialisations and working hours."
      icon={Stethoscope}
    />
  );
}
