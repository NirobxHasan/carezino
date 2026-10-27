import { Suspense } from 'react';
import type { Metadata } from 'next';

import { PageSkeleton } from '@/components/feedback/states';
import { SessionNoteScreen } from '@/features/sessions/note-editor';

export const metadata: Metadata = { title: 'Session note' };

export default function Page() {
  return (
    // Amending is a search parameter (?amend=1), read on the client.
    <Suspense fallback={<PageSkeleton />}>
      <SessionNoteScreen />
    </Suspense>
  );
}
