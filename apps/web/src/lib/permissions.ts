import type { Role } from './types';

export type Permission =
  | 'dashboard.view'
  | 'appointments.view'
  | 'appointments.manage'
  | 'patients.view'
  | 'patients.manage'
  | 'therapists.view'
  | 'therapists.manage'
  | 'clinical.view'
  | 'clinical.write'
  | 'packages.view'
  | 'packages.manage'
  | 'finance.view'
  | 'finance.manage'
  | 'reports.view'
  | 'settings.manage';

const ALL: Permission[] = [
  'dashboard.view',
  'appointments.view',
  'appointments.manage',
  'patients.view',
  'patients.manage',
  'therapists.view',
  'therapists.manage',
  'clinical.view',
  'clinical.write',
  'packages.view',
  'packages.manage',
  'finance.view',
  'finance.manage',
  'reports.view',
  'settings.manage',
];

/**
 * Role → permission map. The API is the source of truth for enforcement; the web app
 * uses this only to decide what to show.
 */
export const rolePermissions: Record<Role, Permission[]> = {
  admin: ALL,
  manager: ALL.filter((p) => p !== 'settings.manage'),
  receptionist: [
    'dashboard.view',
    'appointments.view',
    'appointments.manage',
    'patients.view',
    'patients.manage',
    'therapists.view',
    'packages.view',
    'finance.view',
    'finance.manage',
  ],
  therapist: [
    'dashboard.view',
    'appointments.view',
    'patients.view',
    'therapists.view',
    'clinical.view',
    'clinical.write',
    'packages.view',
  ],
};

export const roleLabels: Record<Role, string> = {
  admin: 'Administrator',
  manager: 'Center manager',
  receptionist: 'Receptionist',
  therapist: 'Therapist',
};

export function can(role: Role, permission: Permission) {
  return rolePermissions[role].includes(permission);
}
