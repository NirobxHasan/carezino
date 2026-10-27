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
  'therapists.read',
  'therapists.read_own',
  'therapists.create',
  'therapists.update',
  'therapists.deactivate',
  'therapists.delete',
  'therapists.manage_availability',
  'therapists.manage_time_off',
  'patients.read',
  'patients.create',
  'patients.update',
  'patients.change_status',
  'patients.delete',
  'guardians.read',
  'guardians.create',
  'guardians.update',
  'guardians.unlink',
  'appointments.read',
  'appointments.read_own',
  'appointments.create',
  'appointments.update',
  'appointments.reschedule',
  'appointments.cancel',
  'appointments.cancel_late',
  'appointments.manage_status',
  'appointments.manage_recurring',
  'assessment_templates.read',
  'assessment_templates.create',
  'assessment_templates.update',
  'assessment_templates.publish',
  'assessments.read_status',
  'assessments.read',
  'assessments.read_own',
  'assessments.create',
  'assessments.update_draft',
  'assessments.complete',
  'assessments.amend',
  'therapy_plans.read_status',
  'therapy_plans.read',
  'therapy_plans.read_own',
  'therapy_plans.create',
  'therapy_plans.create_without_assessment',
  'therapy_plans.update',
  'therapy_plans.activate',
  'therapy_plans.review',
  'therapy_plans.revise',
  'therapy_plans.manage_status',
  'therapy_plans.reassign',
  'therapy_goals.manage',
  'therapy_goals.record_progress',
  'therapy_goal_categories.manage',
  'packages.read',
  'packages.create',
  'packages.update',
  'packages.deactivate',
  'packages.delete',
  'package_enrollments.read',
  'package_enrollments.create',
  'package_enrollments.renew',
  'package_enrollments.override_terms',
  'package_enrollments.cancel',
  'package_enrollments.adjust',
  'attendance.read',
  'attendance.record',
  'attendance.correct',
  'sessions.read',
  'sessions.read_own',
  'sessions.complete',
  'sessions.correct',
  'session_notes.read',
  'session_notes.read_own',
  'session_notes.create',
  'session_notes.update_draft',
  'session_notes.complete',
  'session_notes.amend',
  'session_note_templates.read',
  'session_note_templates.manage',
] as const;

export type ApiPermission = (typeof API_PERMISSIONS)[number];

/** Permissions for prototype modules that aren't on the API yet. */
export type ModulePermission =
  | 'dashboard.view'
  | 'clinical.view'
  | 'clinical.write'
  | 'finance.view'
  | 'finance.manage'
  | 'reports.view';

export type Permission = ApiPermission | ModulePermission;

const ALL_MODULES: ModulePermission[] = [
  'dashboard.view',
  'clinical.view',
  'clinical.write',
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
  RECEPTIONIST: ['dashboard.view', 'finance.view', 'finance.manage'],
  THERAPIST: ['dashboard.view', 'clinical.view', 'clinical.write'],
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
  THERAPIST: 'Their own schedule, patients, assessments, therapy plans and session notes.',
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
