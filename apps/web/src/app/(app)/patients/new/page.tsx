import type { Metadata } from 'next';

import { NewPatientScreen } from '@/features/patients/patient-profile';

export const metadata: Metadata = { title: 'Register patient' };

export default function Page() {
  return <NewPatientScreen />;
}
