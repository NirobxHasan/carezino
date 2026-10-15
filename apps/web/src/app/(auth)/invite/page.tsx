import { Suspense } from 'react';
import type { Metadata } from 'next';

import { AcceptInvitation } from '@/features/auth/accept-invitation';

export const metadata: Metadata = { title: 'Accept invitation' };

export default function Page() {
  return (
    <Suspense>
      <AcceptInvitation />
    </Suspense>
  );
}
