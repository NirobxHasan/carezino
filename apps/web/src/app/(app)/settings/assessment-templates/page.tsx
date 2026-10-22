import type { Metadata } from 'next';

import { TemplatesScreen } from '@/features/settings/assessment-templates/templates-screen';

export const metadata: Metadata = { title: 'Assessment templates' };

export default function Page() {
  return <TemplatesScreen />;
}
