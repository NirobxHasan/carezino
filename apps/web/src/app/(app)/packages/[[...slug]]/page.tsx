import type { Metadata } from 'next';
import { Package } from 'lucide-react';

import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const metadata: Metadata = { title: 'Therapy packages' };

export default function Page() {
  return (
    <ModulePlaceholder
      title="Therapy packages"
      description="Session packages and each patient’s balance."
      icon={Package}
    />
  );
}
