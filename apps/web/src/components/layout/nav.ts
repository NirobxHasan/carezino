import {
  CalendarDays,
  ChartColumn,
  ClipboardList,
  LayoutDashboard,
  Package,
  Settings,
  Stethoscope,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import type { Permission } from '@/lib/permissions';

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  permission: Permission;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    items: [
      {
        title: 'Dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
        permission: 'dashboard.view',
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        title: 'Appointments',
        href: '/appointments',
        icon: CalendarDays,
        permission: 'appointments.view',
      },
      { title: 'Patients', href: '/patients', icon: Users, permission: 'patients.view' },
      {
        title: 'Therapists',
        href: '/therapists',
        icon: Stethoscope,
        permission: 'therapists.view',
      },
    ],
  },
  {
    label: 'Clinical',
    items: [
      {
        title: 'Clinical records',
        href: '/clinical',
        icon: ClipboardList,
        permission: 'clinical.view',
      },
    ],
  },
  {
    label: 'Business',
    items: [
      { title: 'Therapy packages', href: '/packages', icon: Package, permission: 'packages.view' },
      { title: 'Finance', href: '/finance', icon: Wallet, permission: 'finance.view' },
      { title: 'Reports', href: '/reports', icon: ChartColumn, permission: 'reports.view' },
    ],
  },
];

export const settingsNav: NavItem = {
  title: 'Settings',
  href: '/settings',
  icon: Settings,
  // Center profile, services, hours, policies and staff live here; managers see them
  // read-only. Other roles read the same configuration through the screens that use it.
  permission: 'staff.read',
};

/** Labels for static path segments, used by breadcrumbs. */
export const segmentLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  appointments: 'Appointments',
  patients: 'Patients',
  therapists: 'Therapists',
  clinical: 'Clinical records',
  assessments: 'Assessments',
  notes: 'Session notes',
  packages: 'Therapy packages',
  finance: 'Finance',
  reports: 'Reports',
  settings: 'Settings',
  center: 'Center profile',
  'therapy-types': 'Therapy types',
  'working-hours': 'Working hours',
  holidays: 'Holidays & closures',
  scheduling: 'Scheduling',
  general: 'General',
  staff: 'Staff & permissions',
  profile: 'My profile',
  'design-system': 'Design system',
  new: 'New',
  edit: 'Edit',
};

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
