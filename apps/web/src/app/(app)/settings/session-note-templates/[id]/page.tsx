import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { NoteTemplatePageScreen } from '@/features/settings/session-note-templates/template-page';

export const metadata: Metadata = { title: 'Session note template' };

export default function Page() {
  return (
    // The template is read on the client from the route's ID.
    <Suspense fallback={<PageSkeleton />}>
      <NoteTemplatePageScreen />
    </Suspense>
  );
}
