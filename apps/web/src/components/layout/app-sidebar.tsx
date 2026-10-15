'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { Logo } from '@/components/brand/logo';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { isActive, navGroups, settingsNav, type NavItem } from './nav';

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <Link
      href={item.href}
      onNavigate={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group/link flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors focus-ring',
        active
          ? 'bg-primary-subtle text-primary-subtle-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        collapsed && 'justify-center px-0',
      )}
    >
      <item.icon
        className={cn(
          'size-[18px] shrink-0',
          active ? 'text-primary' : 'text-subtle-foreground group-hover/link:text-muted-foreground',
        )}
        aria-hidden
      />
      <span className={cn('truncate', collapsed && 'sr-only')}>{item.title}</span>
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.title}</TooltipContent>
    </Tooltip>
  );
}

/** Navigation list; reads the pathname, so it renders inside a Suspense boundary. */
export function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { can } = useSession();
  const groups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => can(i.permission)) }))
    .filter((g) => g.items.length);

  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {groups.map((group, i) => (
        <div key={group.label ?? i} className="grid gap-0.5">
          {group.label && (
            <p
              className={cn(
                'px-2.5 pb-1 text-[11px] font-medium tracking-wide text-subtle-foreground uppercase',
                collapsed && 'sr-only',
              )}
            >
              {group.label}
            </p>
          )}
          {group.items.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
      {can(settingsNav.permission) && (
        <div className="mt-auto grid gap-0.5">
          <NavLink
            item={settingsNav}
            active={isActive(pathname, settingsNav.href)}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </nav>
  );
}

export function SidebarNavFallback() {
  return (
    <div className="flex flex-1 flex-col gap-2 px-3 py-4" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-9 rounded-lg bg-muted/60" />
      ))}
    </div>
  );
}

export function CenterBadge({ collapsed }: { collapsed: boolean }) {
  const { activeCenter } = useSession();
  if (collapsed) return null;
  return (
    <div className="min-w-0 border-t border-border px-5 py-3">
      <p className="truncate text-[13px] font-medium text-foreground">{activeCenter.name}</p>
      <p className="truncate text-xs text-muted-foreground tabular">{activeCenter.code}</p>
    </div>
  );
}

export function SidebarHeader({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle?: () => void;
}) {
  return (
    <div
      className={cn(
        'flex h-(--topbar-height) shrink-0 items-center justify-between border-b border-border px-4',
        collapsed && 'justify-center px-0',
      )}
    >
      <Link href="/dashboard" className="rounded-lg focus-ring" aria-label="Carezino home">
        <Logo collapsed={collapsed} />
      </Link>
      {onToggle && !collapsed && (
        <button
          type="button"
          onClick={onToggle}
          className="hidden size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-ring lg:grid"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose className="size-4" />
        </button>
      )}
    </div>
  );
}

export function ExpandButton({ onToggle }: { onToggle: () => void }) {
  return (
    <div className="hidden justify-center border-t border-border py-3 lg:flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onToggle}
            className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-ring"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Expand sidebar</TooltipContent>
      </Tooltip>
    </div>
  );
}
