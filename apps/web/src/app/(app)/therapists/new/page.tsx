import type { Metadata } from 'next';

import { NewTherapistScreen } from '@/features/therapists/therapist-profile';

export const metadata: Metadata = { title: 'Add therapist' };

export default function Page() {
  return <NewTherapistScreen />;
}
