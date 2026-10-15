'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, ChevronDown, LogOut, Palette, UserRound } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { useLogout, useSwitchCenter } from '@/lib/api/auth';
import { roleLabels } from '@/lib/permissions';
import { useSession } from '@/lib/session';

export function UserMenu() {
  const router = useRouter();
  const { user, role, activeCenter, centers } = useSession();
  const logout = useLogout();
  const switchCenter = useSwitchCenter();

  const onSwitch = (centerId: string) => {
    if (centerId === activeCenter.id) return;
    const target = centers.find((c) => c.id === centerId);
    switchCenter.mutate(centerId, {
      onSuccess: () => {
        toast.success(`Switched to ${target?.name ?? 'the selected center'}`);
        router.push('/dashboard');
      },
      onError: (error) => toast.error(error.message),
    });
  };

  const onSignOut = () => {
    logout.mutate(undefined, {
      onSettled: () => router.replace('/login'),
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-accent focus-ring sm:pr-2">
        <Avatar name={user.name} size="sm" />
        <span className="hidden text-left leading-tight sm:grid">
          <span className="text-[13px] font-medium">{user.name}</span>
          <span className="text-xs text-muted-foreground">{roleLabels[role]}</span>
        </span>
        <ChevronDown className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
        <span className="sr-only">Open user menu</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel className="grid gap-0.5 py-2">
          <span className="text-sm font-medium text-foreground">{user.name}</span>
          <span className="truncate font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserRound /> My profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/design-system">
            <Palette /> Design system
          </Link>
        </DropdownMenuItem>
        {centers.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1.5">
              <Building2 className="size-3.5" aria-hidden /> Switch center
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={activeCenter.id} onValueChange={onSwitch}>
              {centers.map((c) => (
                <DropdownMenuRadioItem key={c.id} value={c.id} disabled={switchCenter.isPending}>
                  <span className="grid min-w-0 leading-tight">
                    <span className="truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{roleLabels[c.role]}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut} disabled={logout.isPending}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
