import { Suspense } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { SettingsTabs } from '@/features/settings/settings-tabs';

export default function SettingsLayout({ children }: LayoutProps<'/settings'>) {
  return (
    <div className="animate-in">
      <PageHeader
        title="Settings"
        description="Your center’s profile and the team who can use Carezino."
      />
      <Suspense fallback={<div className="mb-6 h-10 border-b border-border" />}>
        <SettingsTabs />
      </Suspense>
      {children}
    </div>
  );
}
