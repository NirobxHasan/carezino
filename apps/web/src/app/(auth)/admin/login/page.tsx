import { Suspense } from 'react';
import type { Metadata } from 'next';

import { AdminLoginForm } from '@/features/platform/admin-login-form';

export const metadata: Metadata = { title: 'Platform sign in' };

export default function Page() {
  return (
    <Suspense>
      <AdminLoginForm />
    </Suspense>
  );
}
