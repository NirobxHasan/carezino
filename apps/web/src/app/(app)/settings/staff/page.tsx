import type { Metadata } from 'next';

import { StaffScreen } from '@/features/settings/staff/staff-screen';

export const metadata: Metadata = { title: 'Staff' };

export default function Page() {
  return <StaffScreen />;
}
