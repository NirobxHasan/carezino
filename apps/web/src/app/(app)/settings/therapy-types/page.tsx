import type { Metadata } from 'next';

import { TherapyTypesScreen } from '@/features/settings/therapy-types/therapy-types-screen';

export const metadata: Metadata = { title: 'Therapy types' };

export default function Page() {
  return <TherapyTypesScreen />;
}
