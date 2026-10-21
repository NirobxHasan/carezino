import type { ActiveCenter, Role } from './types';

/**
 * Permissions the API enforces. The web app reads the signed-in user's grants for the
 * active center from GET /auth/me rather than re-deriving them, so the two can't drift.
 */
export const API_PERMISSIONS = [
  'center.read',
  'center.update',
  'staff.read',
  'staff.create',
  'staff.update',
  'staff.deactivate',
  'staff.assign_role',
  'profile.read',
  'profile.update',
  'therapy_types.read',
  'therapy_types.create',
  'therapy_types.update',
  'therapy_types.delete',
  'center_settings.read',
  'center_settings.update',
] as const;

export type ApiPermission = (typeof API_PERMISSIONS)[number];

/** Permissions for prototype modules that aren't on the API yet. */
export type ModulePermission =
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
  | 'reports.view';

export type Permission = ApiPermission | ModulePermission;

const ALL_MODULES: ModulePermission[] = [
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
];

/**
 * Role → prototype-module permission map, used only to decide what to show. Move each
 * module's permissions to the API (apps/api/src/auth/permissions.ts) when it gets built.
 */
export const modulePermissions: Record<Role, ModulePermission[]> = {
  CENTER_ADMIN: ALL_MODULES,
  MANAGER: ALL_MODULES,
  RECEPTIONIST: [
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
  THERAPIST: [
    'dashboard.view',
    'appointments.view',
    'patients.view',
    'therapists.view',
    'clinical.view',
    'clinical.write',
    'packages.view',
  ],
};

export const ROLES: Role[] = ['CENTER_ADMIN', 'MANAGER', 'RECEPTIONIST', 'THERAPIST'];

export const roleLabels: Record<Role, string> = {
  CENTER_ADMIN: 'Administrator',
  MANAGER: 'Center manager',
  RECEPTIONIST: 'Receptionist',
  THERAPIST: 'Therapist',
};

export const roleDescriptions: Record<Role, string> = {
  CENTER_ADMIN: 'Full access, including center settings, staff and roles.',
  MANAGER: 'Runs day-to-day operations and sees the team. No access to settings or roles.',
  RECEPTIONIST: 'Front desk: registration, bookings and payments.',
  THERAPIST: 'Their own schedule, patients, assessments and session notes.',
};

function isApiPermission(permission: Permission): permission is ApiPermission {
  return (API_PERMISSIONS as readonly string[]).includes(permission);
}

/** UI-only check: hides what the user can't use. The API still enforces every request. */
export function can(active: ActiveCenter | null | undefined, permission: Permission) {
  if (!active) return false;
  if (isApiPermission(permission)) return active.permissions.includes(permission);
  return modulePermissions[active.role].includes(permission);
}
