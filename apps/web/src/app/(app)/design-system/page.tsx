import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { ComponentsShowcase } from '@/features/design-system/components-showcase';
import { FormPattern } from '@/features/design-system/form-pattern';
import { Foundations } from '@/features/design-system/foundations';

export const metadata: Metadata = { title: 'Design system' };

export default function Page() {
  return (
    <div className="animate-in space-y-10">
      <PageHeader
        title="Design system"
        description="Tokens, components and patterns that every Carezino screen is built from."
        className="mb-0"
      />
      <Foundations />
      <Suspense fallback={<PageSkeleton />}>
        <ComponentsShowcase />
        <FormPattern />
      </Suspense>
    </div>
  );
}
