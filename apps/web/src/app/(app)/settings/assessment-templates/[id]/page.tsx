import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { TemplateBuilderScreen } from '@/features/settings/assessment-templates/template-builder';

export const metadata: Metadata = { title: 'Assessment template' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TemplateBuilderScreen />
    </Suspense>
  );
}
