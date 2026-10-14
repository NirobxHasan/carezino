'use client';

import Link from 'next/link';
import { ChevronDown, LogOut, Palette, UserRound } from 'lucide-react';

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
import { roleLabels } from '@/lib/permissions';
import { setDemoRole, useSession } from '@/lib/session';
import type { Role } from '@/lib/types';

export function UserMenu() {
  const { user, role } = useSession();

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
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel className="grid gap-0.5 py-2">
          <span className="text-sm font-medium text-foreground">{user.name}</span>
          <span className="truncate font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => toast.info('Profile settings are coming soon.')}>
          <UserRound /> My profile
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/design-system">
            <Palette /> Design system
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Preview as (prototype)</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={role} onValueChange={(v) => setDemoRole(v as Role)}>
          {(Object.keys(roleLabels) as Role[]).map((r) => (
            <DropdownMenuRadioItem key={r} value={r}>
              {roleLabels[r]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => toast.info('Sign-in isn’t connected yet in this prototype.')}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
