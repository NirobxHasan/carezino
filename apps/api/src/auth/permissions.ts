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
  /** Every therapist profile, with availability, time off and schedule */
  'therapists.read',
  /** Only the profile linked to the caller's own staff account */
  'therapists.read_own',
  'therapists.create',
  /** Profile details, specializations and the linked staff account; also reactivation */
  'therapists.update',
  'therapists.deactivate',
  'therapists.delete',
  'therapists.manage_availability',
  'therapists.manage_time_off',
  /** Every patient of the center, with their contacts, therapy interests and consents */
  'patients.read',
  'patients.create',
  /** Profile, self-contact and registration details, therapy interests and consents */
  'patients.update',
  'patients.change_status',
  /** Soft delete only: the record stays for clinical and financial history */
  'patients.delete',
  /** Looking up guardians across the center, e.g. by mobile, to link an existing one */
  'guardians.read',
  /** Adding a guardian to a patient, whether new or already on record */
  'guardians.create',
  /** A guardian's own details (shared by all their patients), relationships and the primary contact */
  'guardians.update',
  'guardians.unlink',
  /** Every appointment of the center, with the patient's contact */
  'appointments.read',
  /** Only appointments with the therapist profile linked to the caller's staff account */
  'appointments.read_own',
  'appointments.create',
  /** Internal notes and appointment type; also changing the therapy type when rescheduling */
  'appointments.update',
  'appointments.reschedule',
  'appointments.cancel',
  /** Cancelling with less notice than the center's cancellation cutoff */
  'appointments.cancel_late',
  /** Confirm, complete and mark no-show, for every appointment the caller can see */
  'appointments.manage_status',
  /** Booking recurring series and cancelling a series' remaining appointments */
  'appointments.manage_recurring',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PROFILE: Permission[] = ['profile.read', 'profile.update'];
/** Everyone who books or runs sessions needs to see services, hours and policies. */
const READ_CONFIGURATION: Permission[] = [
  'therapy_types.read',
  'center_settings.read',
];

/** Front desk books against every therapist's schedule, so it reads them all. */
const READ_THERAPISTS: Permission[] = [
  'therapists.read',
  'therapists.read_own',
];

/**
 * Registering and looking after patients and their contacts. Deleting a patient stays
 * with administrators. Therapists get no patient access yet: until patients can be
 * assigned to them, the only safe scope is none rather than the whole center.
 */
const MANAGE_PATIENTS: Permission[] = [
  'patients.read',
  'patients.create',
  'patients.update',
  'patients.change_status',
  'guardians.read',
  'guardians.create',
  'guardians.update',
  'guardians.unlink',
];

/**
 * Front desk work: booking, moving, cancelling and confirming. Late cancellations (inside
 * the center's cutoff) are left to managers and administrators.
 */
const MANAGE_APPOINTMENTS: Permission[] = [
  'appointments.read',
  'appointments.read_own',
  'appointments.create',
  'appointments.update',
  'appointments.reschedule',
  'appointments.cancel',
  'appointments.manage_status',
  'appointments.manage_recurring',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.CENTER_ADMIN]: PERMISSIONS,
  // Operational lead: sees the team and runs therapist schedules, but center settings,
  // access control and deleting therapist profiles stay with admins.
  [Role.MANAGER]: [
    'center.read',
    'staff.read',
    ...READ_CONFIGURATION,
    ...PROFILE,
    ...READ_THERAPISTS,
    'therapists.create',
    'therapists.update',
    'therapists.deactivate',
    'therapists.manage_availability',
    'therapists.manage_time_off',
    ...MANAGE_PATIENTS,
    ...MANAGE_APPOINTMENTS,
    'appointments.cancel_late',
  ],
  [Role.RECEPTIONIST]: [
    'center.read',
    ...READ_CONFIGURATION,
    ...PROFILE,
    ...READ_THERAPISTS,
    ...MANAGE_PATIENTS,
    ...MANAGE_APPOINTMENTS,
  ],
  // Their own therapist profile, schedule and appointments only, never colleagues'
  // records. They can confirm, complete and mark no-shows on their own sessions; booking,
  // moving and cancelling stay with the front desk.
  [Role.THERAPIST]: [
    'center.read',
    ...READ_CONFIGURATION,
    ...PROFILE,
    'therapists.read_own',
    'appointments.read_own',
    'appointments.manage_status',
  ],
};

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(role: Role, permission: Permission) {
  return ROLE_PERMISSIONS[role].includes(permission);
}
