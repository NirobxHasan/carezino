import type { Metadata } from 'next';
import { Wallet } from 'lucide-react';

import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const metadata: Metadata = { title: 'Finance' };

export default function Page() {
  return (
    <ModulePlaceholder
      title="Finance"
      description="Invoices, payments, dues and expenses."
      icon={Wallet}
    />
  );
}
