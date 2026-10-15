import type { Metadata } from 'next';

import { RegisterForm } from '@/features/auth/register-form';

export const metadata: Metadata = { title: 'Register your center' };

export default function Page() {
  return <RegisterForm />;
}
