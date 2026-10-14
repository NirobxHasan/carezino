import Link from 'next/link';

import { LogoMark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <LogoMark className="size-10" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">404</p>
          <h1 className="text-page-title">Page not found</h1>
          <p className="text-sm text-muted-foreground">
            The page you’re looking for doesn’t exist or may have moved.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
