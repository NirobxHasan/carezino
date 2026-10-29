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
  /** Assessment templates and their published forms, e.g. to choose one */
  'assessment_templates.read',
  'assessment_templates.create',
  /** Editing a template's details and draft form, and starting a new version */
  'assessment_templates.update',
  /** Publishing a version for use, archiving and restoring templates */
  'assessment_templates.publish',
  /**
   * Every assessment's date, patient, therapy, therapist and status, without clinical
   * content: for front desk and operational oversight
   */
  'assessments.read_status',
  /** Every assessment's clinical content, e.g. to review or print it. Never editing. */
  'assessments.read',
  /**
   * Clinical content of the caller's own assessments (their linked therapist profile),
   * and completed ones of patients in their care. Also the minimum for assessment routes.
   */
  'assessments.read_own',
  /**
   * The writes below only ever apply to the caller's own assessments: clinical content
   * is written and signed by its therapist, whoever else can read it.
   */
  'assessments.create',
  'assessments.update_draft',
  /** Signing a draft off as completed */
  'assessments.complete',
  /** Correcting a completed assessment, with a reason; the earlier content is kept */
  'assessments.amend',
  /**
   * Every therapy plan's patient, therapy, therapist, frequency, dates and status,
   * without goals, progress or reviews: for scheduling and operational oversight
   */
  'therapy_plans.read_status',
  /** Every therapy plan's clinical content. Never editing. */
  'therapy_plans.read',
  /**
   * Clinical content of the caller's own plans (their linked therapist profile, drafts
   * included) and of non-draft plans of patients in their care. Also the route minimum.
   */
  'therapy_plans.read_own',
  /**
   * The clinical writes below only ever apply to plans the caller is the responsible
   * therapist of, whoever else can read them.
   */
  'therapy_plans.create',
  /** Starting a plan that isn't based on a completed assessment */
  'therapy_plans.create_without_assessment',
  /** Editing a draft plan and its goals, and discarding it */
  'therapy_plans.update',
  'therapy_plans.activate',
  /** Recording periodic clinical reviews and correcting them */
  'therapy_plans.review',
  /** Changing an active plan's details, with a reason kept in its history */
  'therapy_plans.revise',
  /** Pausing, resuming, completing and discontinuing */
  'therapy_plans.manage_status',
  /** Handing a plan to another therapist, e.g. when someone leaves. No clinical access. */
  'therapy_plans.reassign',
  /** Adding goals to and changing goals of an active plan, with a reason */
  'therapy_goals.manage',
  'therapy_goals.record_progress',
  /** The center's goal categories (Settings) */
  'therapy_goal_categories.manage',
  /** The package catalog, with prices */
  'packages.read',
  'packages.create',
  /** Editing a package's details and terms; enrollments keep the terms they were bought on */
  'packages.update',
  /** Activating and deactivating packages for new enrollments */
  'packages.deactivate',
  /** Deleting packages nobody has enrolled in */
  'packages.delete',
  /**
   * Every enrollment of the center with its agreed price, balance and usage history.
   * Also choosing a patient's package when booking.
   */
  'package_enrollments.read',
  /** Enrolling a patient on the package's own terms */
  'package_enrollments.create',
  /** Buying a package again for the same patient, as a new enrollment */
  'package_enrollments.renew',
  /** Discounts, an agreed price, or a session count or end date other than the package's */
  'package_enrollments.override_terms',
  'package_enrollments.cancel',
  /** Bonus and correcting credits, debits, and reversing a charged session, with a reason */
  'package_enrollments.adjust',
  /** Whether patients came, for every appointment the caller can see */
  'attendance.read',
  /** Checking patients in and marking them present, late or absent (absent is a no-show) */
  'attendance.record',
  /** Changing attendance after the appointment has closed, with a reason */
  'attendance.correct',
  /**
   * Every session of the center (attendance, session and note status, package usage),
   * without clinical content: for the front desk's day and managers' oversight
   */
  'sessions.read',
  /** Only sessions with the therapist profile linked to the caller's staff account. Route minimum. */
  'sessions.read_own',
  /** Starting and completing sessions (completing charges the held package session) */
  'sessions.complete',
  /** Voiding a session completed by mistake, with a reason; its package charge is reversed */
  'sessions.correct',
  /** Every session note's clinical content. Never editing. */
  'session_notes.read',
  /**
   * Clinical content of the caller's own notes (drafts included) and completed notes of
   * patients in their care. The writes below only ever apply to the caller's own notes.
   */
  'session_notes.read_own',
  'session_notes.create',
  'session_notes.update_draft',
  /** Signing a note off as completed, which also records its goal progress */
  'session_notes.complete',
  /** Correcting a completed note, with a reason; the earlier content is kept */
  'session_notes.amend',
  /** Session note templates and their published forms, e.g. to choose one */
  'session_note_templates.read',
  /** Creating, editing, publishing, archiving and choosing default note templates */
  'session_note_templates.manage',
  /** Billing preferences, priced services and payment methods, e.g. to choose them */
  'billing.read',
  /** The priced service catalog; invoice lines keep the price they were made with */
  'billing_services.manage',
  /** Billing preferences, payment methods and expense categories */
  'billing_settings.manage',
  /** Every invoice of the center with its lines, payments and balance */
  'invoices.read',
  /** Creating, editing and discarding draft invoices, at catalog and agreed prices */
  'invoices.create',
  /** Issuing drafts, which numbers them and makes them owed */
  'invoices.issue',
  /** Discounts, and line prices other than the service's */
  'invoices.discount',
  /** Extra charges for an appointment, e.g. a no-show fee or one a package covers */
  'invoices.additional_charge',
  /** Voiding issued invoices, with a reason; payments applied to them become credit */
  'invoices.void',
  /** Every payment and receipt of the center, with refunds and patient credit */
  'payments.read',
  /** Recording payments and applying them, or a patient's credit, to invoices */
  'payments.collect',
  /** Taking a payment off an invoice it was applied to, with a reason */
  'payments.reallocate',
  /** Returning unapplied money to the payer, with a reason */
  'payments.refund',
  /** Cancelling a payment recorded in error, with a reason */
  'payments.reverse',
  'expenses.read',
  /** Recording expenses and correcting them, with a reason */
  'expenses.create',
  'expenses.void',
  /** The center's collections, dues, expenses and package sales */
  'finance_reports.read',
  /** The caller's own collections, e.g. to close the front desk's day */
  'finance_reports.read_own',
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

/**
 * Writing and signing assessments. The service limits every write to the caller's own
 * therapist profile, so this is safe to grant to anyone who may also see patients.
 */
const WRITE_OWN_ASSESSMENTS: Permission[] = [
  'assessment_templates.read',
  'assessments.read_own',
  'assessments.create',
  'assessments.update_draft',
  'assessments.complete',
  'assessments.amend',
];

/**
 * Planning and running treatment. Like assessments, every write is limited to plans
 * whose responsible therapist is the caller's own profile.
 */
const WRITE_OWN_PLANS: Permission[] = [
  'therapy_plans.read_own',
  'therapy_plans.create',
  'therapy_plans.create_without_assessment',
  'therapy_plans.update',
  'therapy_plans.activate',
  'therapy_plans.review',
  'therapy_plans.revise',
  'therapy_plans.manage_status',
  'therapy_goals.manage',
  'therapy_goals.record_progress',
];

/** Which plans exist, for whom and how often, never their goals or progress. */
const PLAN_STATUS: Permission[] = [
  'therapy_plans.read_status',
  // Route minimum: without a linked therapist profile it adds no clinical access.
  'therapy_plans.read_own',
];

/**
 * Front desk selling: seeing the catalog, enrolling patients on the package's terms,
 * renewing, and choosing a package when booking. Discounts, cancellations and balance
 * corrections stay with managers and administrators.
 */
const SELL_PACKAGES: Permission[] = [
  'packages.read',
  'package_enrollments.read',
  'package_enrollments.create',
  'package_enrollments.renew',
];

/** Seeing that assessments exist and where they stand, never what they say. */
const ASSESSMENT_STATUS: Permission[] = [
  'assessments.read_status',
  // Route minimum: without a linked therapist profile it adds no clinical access.
  'assessments.read_own',
];

/**
 * The front desk's day: checking patients in, marking attendance and completing
 * sessions, for every appointment of the center. Note status is visible, note content
 * never is.
 */
const RUN_SESSIONS: Permission[] = [
  'attendance.read',
  'attendance.record',
  'sessions.read',
  'sessions.read_own',
  'sessions.complete',
];

/**
 * Documenting one's own sessions. Every note write is limited to notes whose therapist
 * is the caller's own profile, like assessments.
 */
const WRITE_OWN_NOTES: Permission[] = [
  'session_note_templates.read',
  'session_notes.read_own',
  'session_notes.create',
  'session_notes.update_draft',
  'session_notes.complete',
  'session_notes.amend',
];

/**
 * Front desk billing: invoicing at catalog and agreed prices, collecting payments,
 * printing receipts and closing their own day. Discounts, voids, refunds, reversals
 * and center-wide reports stay with managers and administrators.
 */
const FRONT_DESK_BILLING: Permission[] = [
  'billing.read',
  'invoices.read',
  'invoices.create',
  'invoices.issue',
  'payments.read',
  'payments.collect',
  'finance_reports.read_own',
];

/** Billing oversight and corrections, besides the front desk's work. */
const MANAGE_BILLING: Permission[] = [
  ...FRONT_DESK_BILLING,
  'invoices.discount',
  'invoices.additional_charge',
  'invoices.void',
  'payments.reallocate',
  'payments.refund',
  'payments.reverse',
  'expenses.read',
  'expenses.create',
  'expenses.void',
  'finance_reports.read',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Everything, including reading (and printing) every assessment and therapy plan.
  // Clinical writes stay limited to their own assessments and plans, for admins who also
  // see patients as therapists.
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
    'assessment_templates.read',
    ...ASSESSMENT_STATUS,
    ...PLAN_STATUS,
    'therapy_plans.reassign',
    // The catalog and every enrollment change except deleting packages.
    ...SELL_PACKAGES,
    'packages.create',
    'packages.update',
    'packages.deactivate',
    'package_enrollments.override_terms',
    'package_enrollments.cancel',
    'package_enrollments.adjust',
    // Daily oversight and corrections, never note content.
    ...RUN_SESSIONS,
    'attendance.correct',
    'sessions.correct',
    'session_note_templates.read',
    // Every billing operation and report; prices and preferences stay with admins.
    ...MANAGE_BILLING,
  ],
  [Role.RECEPTIONIST]: [
    'center.read',
    ...READ_CONFIGURATION,
    ...PROFILE,
    ...READ_THERAPISTS,
    ...MANAGE_PATIENTS,
    ...MANAGE_APPOINTMENTS,
    ...ASSESSMENT_STATUS,
    ...PLAN_STATUS,
    ...SELL_PACKAGES,
    ...RUN_SESSIONS,
    ...FRONT_DESK_BILLING,
  ],
  // Their own therapist profile, schedule and appointments only, never colleagues'
  // records. They can confirm, complete and mark no-shows on their own sessions; booking,
  // moving and cancelling stay with the front desk. They assess the patients they see
  // (src/assessments/access.ts decides which), without access to the patient list,
  // and plan and review the treatment of those patients. No package permissions: their
  // appointments show which package covers a session, never prices or balances. They
  // run and document their own sessions, including marking attendance. No billing.
  [Role.THERAPIST]: [
    'center.read',
    ...READ_CONFIGURATION,
    ...PROFILE,
    'therapists.read_own',
    'appointments.read_own',
    'appointments.manage_status',
    ...WRITE_OWN_ASSESSMENTS,
    ...WRITE_OWN_PLANS,
    'attendance.read',
    'attendance.record',
    'sessions.read_own',
    'sessions.complete',
    ...WRITE_OWN_NOTES,
  ],
};

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(role: Role, permission: Permission) {
  return ROLE_PERMISSIONS[role].includes(permission);
}
