import type { Metadata } from 'next';
import { Settings } from 'lucide-react';

import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const metadata: Metadata = { title: 'Settings' };

export default function Page() {
  return (
    <ModulePlaceholder
      title="Settings"
      description="Center profile, therapy types, templates and users."
      icon={Settings}
    />
  );
}
