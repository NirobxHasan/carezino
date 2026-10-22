'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { Permission } from '@/lib/permissions';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

const TABS: { href: string; label: string; permission: Permission }[] = [
  { href: '/settings/center', label: 'Center profile', permission: 'center.read' },
  { href: '/settings/therapy-types', label: 'Therapy types', permission: 'therapy_types.read' },
  {
    href: '/settings/assessment-templates',
    label: 'Assessment templates',
    permission: 'assessment_templates.read',
  },
  { href: '/settings/working-hours', label: 'Working hours', permission: 'center_settings.read' },
  { href: '/settings/holidays', label: 'Holidays & closures', permission: 'center_settings.read' },
  { href: '/settings/scheduling', label: 'Scheduling', permission: 'center_settings.read' },
  { href: '/settings/general', label: 'General', permission: 'center_settings.read' },
  { href: '/settings/staff', label: 'Staff & permissions', permission: 'staff.read' },
];

/** Link tabs for the settings area, matching the underline Tabs style. */
export function SettingsTabs() {
  const pathname = usePathname();
  const { can } = useSession();
  const tabs = TABS.filter((t) => can(t.permission));
  if (tabs.length < 2) return null;

  return (
    <nav
      aria-label="Settings"
      className="-mb-px mb-6 flex w-full items-center gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]"
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-t-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-ring',
              'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent',
              active && 'text-foreground after:bg-primary',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
