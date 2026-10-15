import type { Metadata } from 'next';

import { PageHeader } from '@/components/layout/page-header';
import { ChangePasswordForm } from '@/features/profile/profile-screen';

export const metadata: Metadata = { title: 'Change password' };

export default function Page() {
  return (
    <div className="animate-in space-y-6">
      <PageHeader
        back={{ href: '/admin', label: 'Therapy centers' }}
        title="Change password"
        description="For your platform administrator account."
      />
      <ChangePasswordForm />
    </div>
  );
}
