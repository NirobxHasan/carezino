import type { Metadata } from 'next';

import { ProfileScreen } from '@/features/profile/profile-screen';

export const metadata: Metadata = { title: 'My profile' };

export default function Page() {
  return <ProfileScreen />;
}
