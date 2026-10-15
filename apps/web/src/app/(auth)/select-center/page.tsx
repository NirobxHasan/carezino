import type { Metadata } from 'next';

import { SelectCenter } from '@/features/auth/select-center';

export const metadata: Metadata = { title: 'Choose a center' };

export default function Page() {
  return <SelectCenter />;
}
