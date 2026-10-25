import {
  CalendarDays,
  ChartColumn,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
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
        // Therapists see their own sessions; front desk and managers see everyone's.
        permission: 'appointments.read_own',
      },
      { title: 'Patients', href: '/patients', icon: Users, permission: 'patients.read' },
      {
        title: 'Therapists',
        href: '/therapists',
        icon: Stethoscope,
        // Therapists see their own profile; everyone else with access sees the team.
        permission: 'therapists.read_own',
      },
    ],
  },
  {
    label: 'Clinical',
    items: [
      {
        title: 'Assessments',
        href: '/assessments',
        icon: ClipboardList,
        // Front desk sees status only; therapists their own and their patients'.
        permission: 'assessments.read_own',
      },
      {
        title: 'Therapy plans',
        href: '/therapy-plans',
        icon: ListChecks,
        // Front desk and managers see schedules and review dates, not clinical content.
        permission: 'therapy_plans.read_own',
      },
    ],
  },
  {
    label: 'Business',
    items: [
      {
        title: 'Therapy packages',
        href: '/packages',
        icon: Package,
        // Front desk sells packages; therapists see coverage on their appointments only.
        permission: 'packages.read',
      },
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
  enrollments: 'Enrollments',
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
  'assessment-templates': 'Assessment templates',
  'therapy-plans': 'Therapy plans',
  'goal-categories': 'Goal categories',
  reviews: 'Reviews',
  print: 'Print',
  new: 'New',
  edit: 'Edit',
  schedule: 'Schedule',
  calendar: 'Calendar',
};

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
