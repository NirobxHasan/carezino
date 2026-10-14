import type { Metadata } from 'next';
import { ClipboardList } from 'lucide-react';

import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const metadata: Metadata = { title: 'Clinical records' };

export default function Page() {
  return (
    <ModulePlaceholder
      title="Clinical records"
      description="Assessments, therapy plans and session notes."
      icon={ClipboardList}
    />
  );
}
