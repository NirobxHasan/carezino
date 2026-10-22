import type { Metadata } from 'next';

import { TherapistsScreen } from '@/features/therapists/therapists-screen';

export const metadata: Metadata = { title: 'Therapists' };

export default function Page() {
  return <TherapistsScreen />;
}
