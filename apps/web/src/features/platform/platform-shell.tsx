'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, ChevronDown, KeyRound, LogOut } from 'lucide-react';

import { Logo } from '@/components/brand/logo';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLogout, useMe } from '@/lib/api/auth';
import { homeFor } from '@/lib/auth/session-api';
import type { Me } from '@/lib/types';
import { cn } from '@/lib/utils';

const NAV = [{ href: '/admin', label: 'Therapy centers', icon: Building2 }];

/**
 * Client side of the platform area's session. The layout has already checked on the
 * server that this is a platform administrator; this sends them to sign in again if the
 * session ends while they're here. The API enforces the same rule on every request.
 */
export function PlatformGate({
  initialMe,
  children,
}: {
  initialMe: Me;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { data: me } = useMe(initialMe);

  React.useEffect(() => {
    if (me === null) {
      const here = `${window.location.pathname}${window.location.search}`;
      router.replace(`/admin/login?next=${encodeURIComponent(here)}`);
    } else if (me && !me.user.isPlatformAdmin) router.replace(homeFor(me));
  }, [me, router]);

  return <>{children}</>;
}

function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Platform" className="flex items-center gap-1">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith('/admin/centers');
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus-ring',
              active
                ? 'bg-primary-subtle text-primary-subtle-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <item.icon className="size-4" aria-hidden />
            <span className="hidden sm:inline">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AdminMenu() {
  const router = useRouter();
  const { data: me } = useMe();
  const logout = useLogout();
  if (!me) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-accent focus-ring sm:pr-2">
        <Avatar name={me.user.fullName} size="sm" />
        <span className="hidden text-left leading-tight sm:grid">
          <span className="text-[13px] font-medium">{me.user.fullName}</span>
          <span className="text-xs text-muted-foreground">{me.user.username ?? me.user.email}</span>
        </span>
        <ChevronDown className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
        <span className="sr-only">Open account menu</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Platform administrator</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/admin/account">
            <KeyRound /> Change password
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={logout.isPending}
          onSelect={() =>
            logout.mutate(undefined, { onSettled: () => router.replace('/admin/login') })
          }
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Top-bar layout for the super admin area. Deliberately separate from the center app shell. */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="mx-auto flex h-(--topbar-height) w-full max-w-(--content-max-width) items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            href="/admin"
            className="flex items-center gap-2 rounded-lg focus-ring"
            aria-label="Carezino platform"
          >
            <Logo />
            <Badge tone="primary" className="hidden sm:inline-flex">
              Platform
            </Badge>
          </Link>
          <React.Suspense fallback={null}>
            <NavLinks />
          </React.Suspense>
          <div className="ml-auto">
            <AdminMenu />
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-(--content-max-width) px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
