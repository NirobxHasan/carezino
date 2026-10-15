import Link from 'next/link';

import { Logo } from '@/components/brand/logo';

/** Public screens: sign in, register a center, password recovery, invitations. */
export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <main className="flex min-h-dvh flex-col items-center bg-background px-4 py-10 sm:py-16">
      <Link href="/login" className="mb-8 rounded-lg focus-ring" aria-label="Carezino">
        <Logo />
      </Link>
      {children}
    </main>
  );
}
