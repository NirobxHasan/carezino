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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PROFILE: Permission[] = ['profile.read', 'profile.update'];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.CENTER_ADMIN]: PERMISSIONS,
  // Operational lead: sees the team, but center settings and access control stay with admins.
  [Role.MANAGER]: ['center.read', 'staff.read', ...PROFILE],
  [Role.RECEPTIONIST]: ['center.read', ...PROFILE],
  [Role.THERAPIST]: ['center.read', ...PROFILE],
};

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(role: Role, permission: Permission) {
  return ROLE_PERMISSIONS[role].includes(permission);
}
