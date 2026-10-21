import { Role } from '../generated/prisma/enums';

/**
 * Center-scoped permissions. Roles are fixed for now and mapped to permissions here;
 * when modules such as patients or appointments land, add their permissions to this
 * list and to the roles that should have them.
 */
export const PERMISSIONS = [
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
  /** Working hours, closures, scheduling and general settings */
  'center_settings.read',
  'center_settings.update',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PROFILE: Permission[] = ['profile.read', 'profile.update'];
/** Everyone who books or runs sessions needs to see services, hours and policies. */
const READ_CONFIGURATION: Permission[] = [
  'therapy_types.read',
  'center_settings.read',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.CENTER_ADMIN]: PERMISSIONS,
  // Operational lead: sees the team, but center settings and access control stay with admins.
  [Role.MANAGER]: [
    'center.read',
    'staff.read',
    ...READ_CONFIGURATION,
    ...PROFILE,
  ],
  [Role.RECEPTIONIST]: ['center.read', ...READ_CONFIGURATION, ...PROFILE],
  [Role.THERAPIST]: ['center.read', ...READ_CONFIGURATION, ...PROFILE],
};

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(role: Role, permission: Permission) {
  return ROLE_PERMISSIONS[role].includes(permission);
}
