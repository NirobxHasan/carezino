/**
 * Carezino domain types.
 *
 * These describe what the web app expects from the API. Every record belongs to a
 * center (tenant); the API scopes reads by the signed-in user's center, so most
 * types don't repeat `centerId`.
 */

export type ID = string;
/** ISO date (yyyy-MM-dd) */
export type ISODate = string;
/** ISO date-time */
export type ISODateTime = string;

// ── Tenancy & access ─────────────────────────────────────────────────────────

export interface Center {
  id: ID;
  name: string;
  branch: string;
  address: string;
  phone: string;
  email: string;
  /** 0 = Sunday … 6 = Saturday */
  workingDays: number[];
  openTime: string;
  closeTime: string;
  weekStartsOn: 0 | 1 | 6;
}

/** Fixed roles; what each may do is mapped in lib/permissions.ts and enforced by the API. */
export type Role = 'CENTER_ADMIN' | 'MANAGER' | 'RECEPTIONIST' | 'THERAPIST';

/** The signed-in user as prototype screens see them (see useSession). */
export interface User {
  id: ID;
  name: string;
  email: string;
  role: Role;
  /** Set when the user is also a therapist (linked once the therapists module exists) */
  therapistId?: ID;
}

// ── Accounts & access (served by the API) ──────────────────────────────────

export type MembershipStatus = 'ACTIVE' | 'INACTIVE';

/** The center profile, as GET /centers/current returns it. */
export interface CenterProfile {
  id: ID;
  /** Immutable, e.g. SBTC-4821 */
  code: string;
  name: string;
  phone: string;
  email: string | null;
  address: string;
  district: string | null;
  country: string;
  timezone: string;
  currency: string;
  logoUrl: string | null;
  website: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** A center the signed-in user can work in. */
export interface CenterSummary {
  id: ID;
  code: string;
  name: string;
  logoUrl: string | null;
  role: Role;
}

export interface ActiveCenter extends CenterSummary {
  membershipId: ID;
  timezone: string;
  currency: string;
  permissions: string[];
}

/** GET /auth/me */
export interface Me {
  user: {
    id: ID;
    fullName: string;
    email: string;
    mobile: string | null;
    /** Set for platform administrators, who sign in at /admin/login */
    username: string | null;
    isPlatformAdmin: boolean;
  };
  /** Null when the user has several centers and hasn't picked one, or has none */
  activeCenter: ActiveCenter | null;
  centers: CenterSummary[];
}

/** A center membership, with the person's identity. */
export interface StaffMember {
  /** Membership ID */
  id: ID;
  userId: ID;
  fullName: string;
  email: string;
  mobile: string | null;
  role: Role;
  status: MembershipStatus;
  joinedAt: ISODateTime;
  updatedAt: ISODateTime;
  isYou: boolean;
}

export interface StaffInvitation {
  id: ID;
  email: string;
  fullName: string;
  mobile: string | null;
  role: Role;
  expiresAt: ISODateTime;
  createdAt: ISODateTime;
  invitedByName: string;
  expired: boolean;
}

// ── Platform (super admin) ──────────────────────────────────────────────────

export interface CenterAdministrator {
  /** Membership ID */
  id: ID;
  fullName: string;
  email: string;
  mobile: string | null;
  status: MembershipStatus;
  joinedAt: ISODateTime;
}

export interface PlatformCenterListItem {
  id: ID;
  code: string;
  name: string;
  phone: string;
  email: string | null;
  district: string | null;
  status: CenterProfile['status'];
  createdAt: ISODateTime;
  activeStaff: number;
  primaryAdmin: CenterAdministrator | null;
}

export interface PlatformCenterDetail extends CenterProfile {
  administrators: CenterAdministrator[];
  counts: { activeStaff: number; inactiveStaff: number; pendingInvitations: number };
}

export interface InvitationPreview {
  valid: true;
  centerName: string;
  email: string;
  fullName: string;
  mobile: string | null;
  role: Role;
  expiresAt: ISODateTime;
  accountExists: boolean;
}

// ── Center configuration (served by the API) ────────────────────────────────

/** A session length a therapy type can be booked for. */
export interface TherapyDurationOption {
  id: ID;
  durationMinutes: number;
  label: string | null;
  isActive: boolean;
  /** Exactly one per therapy type: the one matching its default duration */
  isDefault: boolean;
  displayOrder: number;
}

/** A therapy service the center offers, as GET /therapy-types returns it. */
export interface CenterTherapyType {
  id: ID;
  name: string;
  /** Upper-case short code, e.g. OT */
  code: string;
  description: string | null;
  defaultDurationMinutes: number;
  /** Hex colour, e.g. #0d9488 */
  color: string | null;
  isActive: boolean;
  displayOrder: number;
  durationOptions: TherapyDurationOption[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** "HH:mm", 24-hour, in the center's time zone */
export type ClockTime = string;

export interface TimeInterval {
  start: ClockTime;
  end: ClockTime;
}

export interface WorkingDay {
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
  isOpen: boolean;
  intervals: TimeInterval[];
}

/** GET /settings/working-hours: all seven days, Sunday first */
export interface WorkingWeek {
  timezone: string;
  days: WorkingDay[];
}

export interface CenterClosure {
  id: ID;
  title: string;
  startDate: ISODate;
  endDate: ISODate;
  reason: string | null;
  allDay: boolean;
  /** Set for part-day closures only */
  startTime: ClockTime | null;
  endTime: ClockTime | null;
  isActive: boolean;
  days: number;
  state: 'upcoming' | 'ongoing' | 'past';
  /** Only closures that never took effect can be deleted */
  canDelete: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface SchedulingSettings {
  slotIntervalMinutes: number;
  bookingBufferMinutes: number;
  allowCustomDuration: boolean;
  allowBookingOnClosedDays: boolean;
  advanceBookingLimitDays: number;
  minimumBookingNoticeMinutes: number;
  allowDoubleBooking: boolean;
  allowPastDateBooking: boolean;
  cancellationCutoffMinutes: number;
  updatedAt: ISODateTime;
}

export type DefaultDurationBehavior = 'THERAPY_TYPE_DEFAULT' | 'PREVIOUS_SESSION' | 'ASK_EACH_TIME';
export type DateDisplayFormat = 'D_MMM_YYYY' | 'DD_MM_YYYY' | 'MM_DD_YYYY' | 'YYYY_MM_DD';
export type TimeDisplayFormat = 'H12' | 'H24';

export interface GeneralSettings {
  defaultDurationBehavior: DefaultDurationBehavior;
  autoGeneratePatientCode: boolean;
  patientCodePrefix: string | null;
  /** Status new patients start with */
  defaultPatientStatus: 'NEW' | 'ACTIVE';
  dateFormat: DateDisplayFormat;
  timeFormat: TimeDisplayFormat;
  /** 0 = Sunday, 1 = Monday, 6 = Saturday */
  weekStartsOn: number;
  updatedAt: ISODateTime;
}

// ── Therapists (served by the API) ──────────────────────────────────────────

export type TherapistProfileStatus = 'ACTIVE' | 'INACTIVE';
export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'VISITING' | 'CONTRACTUAL';
export type PersonGender = 'MALE' | 'FEMALE' | 'OTHER';
/** Patients can also be recorded as preferring not to say */
export type PatientGender = PersonGender | 'PREFER_NOT_TO_SAY';
export type TimeOffReason =
  'PERSONAL' | 'SICK' | 'TRAINING' | 'VACATION' | 'EMERGENCY' | 'SCHEDULE_CHANGE' | 'OTHER';
/** What stops new bookings with a therapist */
export type TherapistBookingIssue = 'INACTIVE' | 'NO_SPECIALIZATION' | 'NO_AVAILABILITY';

export interface TherapistSpecialization {
  therapyTypeId: ID;
  name: string;
  code: string;
  color: string | null;
  /** Inactive therapy types stay on the profile but can't be booked */
  isActive: boolean;
  isPrimary: boolean;
  assignedAt: ISODateTime;
}

/** A row of GET /therapists */
export interface TherapistListItem {
  id: ID;
  /** Generated per center, e.g. TH-0007 */
  code: string;
  fullName: string;
  /** BD mobiles as 01712345678; numbers abroad as +E.164 */
  mobile: string;
  email: string | null;
  gender: PersonGender | null;
  photoUrl: string | null;
  designation: string | null;
  employmentType: EmploymentType | null;
  joiningDate: ISODate | null;
  status: TherapistProfileStatus;
  specializations: TherapistSpecialization[];
  availabilitySummary: { daysOfWeek: number[]; weeklyMinutes: number };
  hasAccount: boolean;
  /** Linked to the signed-in user's own staff account */
  isYou: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** GET /therapists/:id */
export interface TherapistDetail extends TherapistListItem {
  qualifications: string | null;
  registrationNumber: string | null;
  yearsOfExperience: number | null;
  notes: string | null;
  account: {
    membershipId: ID;
    fullName: string;
    email: string;
    role: Role;
    status: MembershipStatus;
  } | null;
  bookingIssues: TherapistBookingIssue[];
  /** Null until the appointments module exists: unknown, not zero */
  upcomingAppointments: number | null;
  timezone: string;
}

export interface AvailabilityInterval extends TimeInterval {
  /** Outside the center's opening hours that weekday: allowed, but not bookable */
  outsideCenterHours: boolean;
}

/** GET /therapists/:id/availability */
export interface TherapistWeek {
  timezone: string;
  /** All seven days, Sunday first. Off days keep their intervals. */
  days: { dayOfWeek: number; isAvailable: boolean; intervals: AvailabilityInterval[] }[];
  centerHours: WorkingDay[];
  summary: TherapistListItem['availabilitySummary'];
}

export interface TherapistTimeOff {
  id: ID;
  isAllDay: boolean;
  /** Center-local dates; endDate is the last day for all-day entries */
  startDate: ISODate;
  endDate: ISODate;
  startTime: ClockTime | null;
  endTime: ClockTime | null;
  startAt: ISODateTime;
  endAt: ISODateTime;
  reason: TimeOffReason | null;
  note: string | null;
  state: 'upcoming' | 'ongoing' | 'past';
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** POST/PATCH time off: the entry plus bookings it overlaps (null: not checked yet) */
export interface TimeOffResult {
  timeOff: TherapistTimeOff;
  /** Null only when appointments couldn't be checked */
  conflictingAppointments: BookedAppointment[] | null;
}

/** One day of GET /therapists/:id/schedule. Clock times are center-local; end may be 24:00. */
export interface ScheduleDay {
  date: ISODate;
  dayOfWeek: number;
  centerHours: TimeInterval[];
  closures: (TimeInterval & { id: ID; title: string; allDay: boolean })[];
  regularHours: TimeInterval[];
  timeOff: (TimeInterval & { id: ID; reason: TimeOffReason | null; isAllDay: boolean })[];
  /** When the therapist is working after every exception. Not free slots. */
  available: TimeInterval[];
  /** Scheduled, confirmed and completed ones; start/end are clipped to this day */
  appointments: (BookedAppointment & TimeInterval)[] | null;
}

export interface TherapistSchedule {
  therapist: { id: ID; code: string; fullName: string; status: TherapistProfileStatus };
  timezone: string;
  startDate: ISODate;
  endDate: ISODate;
  appointmentsIncluded: boolean;
  days: ScheduleDay[];
}

// ── Patients (served by the API) ────────────────────────────────────────────

export type PatientRecordStatus = 'NEW' | 'ACTIVE' | 'INACTIVE';
/** Who a patient is reached through: themselves, or a guardian or caregiver */
export type ContactType = 'SELF' | 'GUARDIAN' | 'CAREGIVER';
export type GuardianContactType = Exclude<ContactType, 'SELF'>;
export type GuardianRelationship =
  'FATHER' | 'MOTHER' | 'LEGAL_GUARDIAN' | 'GRANDPARENT' | 'SIBLING' | 'SPOUSE' | 'OTHER';
export type ReferralSource =
  'DOCTOR' | 'SCHOOL' | 'FRIEND_FAMILY' | 'SOCIAL_MEDIA' | 'EXISTING_PATIENT' | 'WALK_IN' | 'OTHER';
export type ConsentPurpose = 'TREATMENT' | 'DATA_PROCESSING' | 'MEDIA';

/** Worked out by the API from the date of birth or the approximate age given */
export interface PatientAge {
  years: number;
  months: number;
  isApproximate: boolean;
}

export interface PatientTherapyInterest {
  therapyTypeId: ID;
  name: string;
  code: string;
  color: string | null;
  /** Inactive therapy types stay on the patient but can't be newly chosen */
  isActive: boolean;
}

export interface PrimaryContact {
  type: ContactType;
  name: string;
  mobile: string | null;
  relationship: GuardianRelationship | null;
  customRelationship: string | null;
}

/** A row of GET /patients: nothing clinical */
export interface PatientSummary {
  id: ID;
  /** Unique per center, e.g. P-0042 */
  code: string;
  fullName: string;
  gender: PatientGender | null;
  dateOfBirth: ISODate | null;
  age: PatientAge | null;
  photoUrl: string | null;
  status: PatientRecordStatus;
  registeredAt: ISODateTime;
  therapyInterests: PatientTherapyInterest[];
  primaryContact: PrimaryContact | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** A guardian's own details, shared by every patient they're linked to */
export interface GuardianProfile {
  id: ID;
  fullName: string;
  mobile: string;
  secondaryMobile: string | null;
  email: string | null;
  address: string | null;
  /** Patients who'd see a change to these details */
  linkedPatientCount: number;
  updatedAt: ISODateTime;
}

/** A guardian as linked to one patient */
export interface PatientContact {
  relationId: ID;
  guardianId: ID;
  contactType: GuardianContactType;
  relationship: GuardianRelationship;
  customRelationship: string | null;
  isPrimary: boolean;
  isEmergencyContact: boolean;
  linkedAt: ISODateTime;
  guardian: GuardianProfile;
}

export interface PatientConsent {
  id: ID;
  purpose: ConsentPurpose;
  version: string | null;
  /** false: refused or withdrawn */
  granted: boolean;
  givenBy: 'SELF' | 'GUARDIAN';
  guardianId: ID | null;
  givenByName: string;
  note: string | null;
  recordedAt: ISODateTime;
  recordedBy: { id: ID; fullName: string };
}

/** GET /patients/:id */
export interface PatientDetail extends PatientSummary {
  /** When the approximate age was given; null with a date of birth */
  approximateAgeRecordedOn: ISODate | null;
  primaryConcern: string | null;
  /** The patient's own contact details */
  mobile: string | null;
  secondaryMobile: string | null;
  email: string | null;
  address: string | null;
  emergencyPhone: string | null;
  primaryContactIsSelf: boolean;
  referralSource: ReferralSource | null;
  referralOther: string | null;
  internalNotes: string | null;
  registeredBy: { id: ID; fullName: string };
  /** Primary first */
  contacts: PatientContact[];
  /** Newest first; the latest per purpose is current */
  consents: PatientConsent[];
}

/** GET /guardians/search */
export interface GuardianMatch extends GuardianProfile {
  patients: {
    id: ID;
    code: string;
    fullName: string;
    relationship: GuardianRelationship;
    customRelationship: string | null;
  }[];
}

// ── Appointments (served by the API) ────────────────────────────────────────
// Prototype modules (dashboard, clinical, finance) still use the Appointment types in
// "Scheduling" below, with their own lower-case statuses.

/** A workflow category, not a discipline: the service is the therapy type */
export type AppointmentType = 'ASSESSMENT' | 'THERAPY_SESSION';
export type AppointmentRecordStatus =
  'SCHEDULED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type CancellationReason =
  'PATIENT_REQUEST' | 'THERAPIST_UNAVAILABLE' | 'CENTER_CLOSURE' | 'PERSONAL_REASON' | 'OTHER';
export type ConflictReason =
  | 'THERAPIST_INACTIVE'
  | 'NOT_SPECIALIZED'
  | 'OUTSIDE_REGULAR_HOURS'
  | 'OUTSIDE_CENTER_HOURS'
  | 'CENTER_CLOSED'
  | 'TIME_OFF'
  | 'INVALID_PERIOD'
  | 'IN_THE_PAST'
  | 'TOO_SOON'
  | 'TOO_FAR_AHEAD'
  | 'THERAPIST_BUSY'
  | 'PATIENT_BUSY';

/** Why a time can't be booked, with a message ready to show */
export interface AppointmentConflict {
  reason: ConflictReason;
  message: string;
  /** The clashing appointment, for THERAPIST_BUSY and PATIENT_BUSY */
  appointmentId?: ID;
  startAt?: ISODateTime;
  endAt?: ISODateTime;
}

/** A booking as therapist schedules and time-off checks report it */
export interface BookedAppointment {
  id: ID;
  startAt: ISODateTime;
  endAt: ISODateTime;
  status: AppointmentRecordStatus;
  type: AppointmentType;
  patient: { id: ID; code: string; fullName: string };
  therapyType: { id: ID; code: string; name: string; color: string | null };
}

/** What the signed-in user may do with an appointment right now (decided by the API) */
export interface AppointmentActions {
  confirm: boolean;
  complete: boolean;
  noShow: boolean;
  reschedule: boolean;
  cancel: boolean;
  edit: boolean;
  /** Choosing, changing or removing the package that pays for it */
  changePackage: boolean;
  /** Cancelling now would count as a late cancellation */
  lateCancellation: boolean;
}

/** A row of GET /appointments. Dates and clock times are center-local. */
export interface AppointmentItem {
  id: ID;
  seriesId: ID | null;
  type: AppointmentType;
  status: AppointmentRecordStatus;
  startAt: ISODateTime;
  endAt: ISODateTime;
  date: ISODate;
  startTime: ClockTime;
  /** "24:00" when it ends at midnight */
  endTime: ClockTime;
  durationMinutes: number;
  patient: {
    id: ID;
    code: string;
    fullName: string;
    photoUrl: string | null;
    status: PatientRecordStatus;
    isDeleted: boolean;
  };
  therapist: {
    id: ID;
    code: string;
    fullName: string;
    photoUrl: string | null;
    isDeleted: boolean;
    /** Linked to the signed-in user's staff account */
    isYou: boolean;
  };
  therapyType: { id: ID; name: string; code: string; color: string | null };
  /** Whether the patient came; ABSENT for no-shows */
  attendance: {
    status: AttendanceStatus;
    checkInAt: ISODateTime | null;
    /** The same, as the center's wall clock */
    checkInTime: ClockTime | null;
  };
  /** Booked over a clash on purpose (the center allows double booking) */
  allowOverlap: boolean;
  lateCancellation: boolean;
  cancellationReason: CancellationReason | null;
  cancelledAt: ISODateTime | null;
  /** The package enrollment it's assigned to, if any */
  packageEnrollmentId: ID | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  actions: AppointmentActions;
}

export type SeriesFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface SeriesRule {
  frequency: SeriesFrequency;
  interval: number;
  /** WEEKLY only: 0 = Sunday … 6 = Saturday */
  daysOfWeek: number[];
  startTime: ClockTime;
  endType: 'UNTIL' | 'COUNT';
  until: ISODate | null;
  count: number | null;
}

export type AppointmentHistoryAction =
  | 'CREATED'
  | 'UPDATED'
  | 'RESCHEDULED'
  | 'STATUS_CHANGED'
  | 'CANCELLED'
  | 'ATTENDANCE_RECORDED'
  | 'ATTENDANCE_CORRECTED'
  | 'SESSION_STARTED'
  | 'SESSION_CORRECTED';

/** How a booking looked at one point, as history records it */
export interface AppointmentSnapshot {
  date?: ISODate;
  startTime?: ClockTime;
  endTime?: ClockTime;
  durationMinutes?: number;
  status?: AppointmentRecordStatus;
  type?: AppointmentType;
  therapist?: { id: ID; fullName: string };
  therapyType?: { id: ID; name: string };
  cancellationReason?: CancellationReason;
  lateCancellation?: boolean;
  /** UPDATED: which fields changed (note text itself is never recorded) */
  fields?: string[];
  /** CANCELLED as part of cancelling a series' remaining appointments */
  series?: boolean;
  /** ATTENDANCE_*: attendance and times as recorded (the note's text never is) */
  attendance?: AttendanceStatus;
  checkInAt?: ISODateTime | null;
  /** SESSION_CORRECTED: what really happened, and whether a package charge was reversed */
  outcome?: SessionCorrectionOutcome;
  packageReversed?: boolean;
}

export interface AppointmentHistoryEntry {
  id: ID;
  action: AppointmentHistoryAction;
  previousValues: AppointmentSnapshot | null;
  newValues: AppointmentSnapshot | null;
  reason: string | null;
  createdAt: ISODateTime;
  performedBy: { id: ID; fullName: string };
}

/** GET /appointments/:id */
export interface AppointmentDetail extends AppointmentItem {
  /** The assessment recording this booking, if any */
  assessment: { id: ID; status: AssessmentRecordStatus } | null;
  /** The package paying for it, if any. No prices or balances. */
  package: AppointmentPackage | null;
  bufferMinutes: number;
  internalNotes: string | null;
  cancellationNote: string | null;
  /** Null for callers who can't read patients */
  primaryContact: PrimaryContact | null;
  createdBy: { id: ID; fullName: string };
  updatedBy: { id: ID; fullName: string } | null;
  cancelledBy: { id: ID; fullName: string } | null;
  series: {
    id: ID;
    status: 'ACTIVE' | 'CANCELLED';
    rule: SeriesRule;
    timezone: string;
    startsOn: ISODate;
    endsOn: ISODate;
    position: { index: number; total: number } | null;
  } | null;
  /** Oldest first */
  history: AppointmentHistoryEntry[];
}

/** GET /appointments/available-slots */
export interface AvailableSlots {
  date: ISODate;
  timezone: string;
  durationMinutes: number;
  slotIntervalMinutes: number;
  slots: { startTime: ClockTime; endTime: ClockTime; startAt: ISODateTime; endAt: ISODateTime }[];
  /** Why the day has no slots */
  unavailable: { reason: ConflictReason; message: string } | null;
}

/** GET /appointments/calendar */
export interface AppointmentCalendar {
  timezone: string;
  startDate: ISODate;
  endDate: ISODate;
  days: {
    date: ISODate;
    dayOfWeek: number;
    centerHours: TimeInterval[];
    closures: (TimeInterval & { id: ID; title: string; allDay: boolean })[];
  }[];
  appointments: AppointmentItem[];
}

export interface SeriesOccurrence {
  date: ISODate;
  startTime: ClockTime;
  endTime: ClockTime;
  startAt: ISODateTime;
  endAt: ISODateTime;
  /** MONTHLY: moved to the month's last day, which lacks the start date's day */
  adjusted: boolean;
  available: boolean;
  /** Clashes only, which the center lets staff book over */
  overridable: boolean;
  conflicts: AppointmentConflict[];
}

/** POST /appointment-series/preview */
export interface SeriesPreview {
  timezone: string;
  summary: { total: number; available: number; conflicts: number };
  occurrences: SeriesOccurrence[];
}

/** GET /appointment-series/:id */
export interface AppointmentSeries {
  id: ID;
  type: AppointmentType;
  status: 'ACTIVE' | 'CANCELLED';
  recurrenceRule: SeriesRule;
  timezone: string;
  durationMinutes: number;
  startsOn: ISODate;
  endsOn: ISODate;
  skippedOccurrences: { date: ISODate; startTime: ClockTime; reasons: ConflictReason[] }[] | null;
  createdAt: ISODateTime;
  createdBy: { id: ID; fullName: string };
  patient: { id: ID; code: string; fullName: string };
  therapist: { id: ID; code: string; fullName: string };
  therapyType: { id: ID; name: string; code: string; color: string | null };
  appointments: AppointmentItem[];
  counts: { total: number; open: number; upcoming: number };
}

// ── Configuration (prototype) ───────────────────────────────────────────────

/** Visual accent for a therapy type; keeps colour decisions out of feature code. */
export type DisciplineAccent = 'ot' | 'aba' | 'slt' | 'other';

export interface TherapyType {
  id: ID;
  code: string;
  name: string;
  accent: DisciplineAccent;
  defaultDurationMinutes: number;
  active: boolean;
}

// ── People ──────────────────────────────────────────────────────────────────

export type Gender = 'male' | 'female' | 'other';

export interface Guardian {
  name: string;
  relationship: string;
  phone: string;
  altPhone?: string;
  email?: string;
}

export type PatientStatus = 'active' | 'waitlist' | 'on_hold' | 'discharged';

export interface Patient {
  id: ID;
  /** Human-readable ID shown on screens and receipts, e.g. CZ-0042 */
  code: string;
  fullName: string;
  /** Optional name in Bangla script */
  nameBn?: string;
  dateOfBirth: ISODate;
  gender: Gender;
  guardian: Guardian;
  address?: string;
  school?: string;
  therapyTypeIds: ID[];
  primaryTherapistId?: ID;
  status: PatientStatus;
  referralSource?: string;
  primaryConcern?: string;
  registeredAt: ISODate;
  notes?: string;
}

export type TherapistStatus = 'active' | 'on_leave' | 'inactive';

export interface WorkingHours {
  /** 0 = Sunday … 6 = Saturday */
  day: number;
  start: string;
  end: string;
}

export interface Therapist {
  id: ID;
  name: string;
  title: string;
  email: string;
  phone: string;
  specializationIds: ID[];
  qualifications: string;
  status: TherapistStatus;
  workingHours: WorkingHours[];
  joinedAt: ISODate;
}

// ── Scheduling ──────────────────────────────────────────────────────────────

export type AppointmentStatus = 'scheduled' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';
export type AppointmentKind = 'session' | 'assessment';
export type NoteStatus = 'none' | 'draft' | 'submitted';

export interface Appointment {
  id: ID;
  patientId: ID;
  therapistId: ID;
  therapyTypeId: ID;
  kind: AppointmentKind;
  start: ISODateTime;
  end: ISODateTime;
  status: AppointmentStatus;
  room?: string;
  patientPackageId?: ID;
  /** Shared by appointments created from one recurring booking */
  seriesId?: ID;
  noteStatus: NoteStatus;
  cancelReason?: string;
  notes?: string;
}

export type RecurrenceFrequency = 'none' | 'weekly';

export interface BookingRequest {
  patientId: ID;
  therapyTypeId: ID;
  therapistId: ID;
  kind: AppointmentKind;
  start: ISODateTime;
  durationMinutes: number;
  patientPackageId?: ID;
  recurrence: { frequency: RecurrenceFrequency; weekdays: number[]; occurrences: number };
  notes?: string;
}

export interface TimeSlot {
  start: ISODateTime;
  end: ISODateTime;
  available: boolean;
  /** Why the slot is unavailable, shown in the UI */
  reason?: string;
}

// ── Clinical ────────────────────────────────────────────────────────────────

export type FieldType =
  'text' | 'textarea' | 'number' | 'select' | 'multiselect' | 'checkbox' | 'radio' | 'date';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldCondition {
  fieldId: string;
  /** Show when the referenced field equals, or for arrays includes, one of these values */
  in: (string | boolean)[];
}

export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: FieldOption[];
  showIf?: FieldCondition;
  width?: 'full' | 'half';
  /** Hide behind "Show more fields" until the user asks for it */
  optional?: boolean;
  min?: number;
  max?: number;
}

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  fields: FormField[];
}

export type TemplateKind = 'assessment' | 'session_note';

export interface FormTemplate {
  id: ID;
  kind: TemplateKind;
  name: string;
  /** Empty means "applies to every therapy type" */
  therapyTypeIds: ID[];
  version: number;
  status: 'published' | 'draft' | 'archived';
  updatedAt: ISODateTime;
  sections: FormSection[];
}

export type FieldValue = string | number | boolean | string[] | null | undefined;
export type FormValues = Record<string, FieldValue>;

export type AssessmentStatus = 'scheduled' | 'draft' | 'completed';

export interface Assessment {
  id: ID;
  patientId: ID;
  therapistId: ID;
  therapyTypeId: ID;
  templateId: ID;
  templateVersion: number;
  date: ISODate;
  status: AssessmentStatus;
  values: FormValues;
  updatedAt: ISODateTime;
}

export type GoalStatus = 'active' | 'achieved' | 'paused';

export interface Goal {
  id: ID;
  patientId: ID;
  therapyTypeId: ID;
  title: string;
  status: GoalStatus;
  targetDate?: ISODate;
  createdAt: ISODate;
}

export interface TherapyPlan {
  id: ID;
  patientId: ID;
  therapyTypeId: ID;
  therapistId: ID;
  sessionsPerWeek: number;
  sessionMinutes: number;
  startDate: ISODate;
  reviewDate: ISODate;
  focus: string;
}

export type GoalProgress = 'not_started' | 'emerging' | 'progressing' | 'achieved';
export type Participation = 'excellent' | 'good' | 'fair' | 'poor';

export interface GoalEntry {
  goalId: ID;
  progress: GoalProgress;
  comment?: string;
}

export interface SessionNote {
  id: ID;
  appointmentId: ID;
  patientId: ID;
  therapistId: ID;
  therapyTypeId: ID;
  date: ISODate;
  status: 'draft' | 'submitted';
  activities: string;
  participation?: Participation;
  goals: GoalEntry[];
  observations: string;
  nextPlan: string;
  /** Values for any extra fields from the therapy type's note template */
  custom: FormValues;
  updatedAt: ISODateTime;
  submittedAt?: ISODateTime;
}

// ── Assessments (served by the API) ─────────────────────────────────────────
// Templates are versioned forms (apps/api/src/assessments/engine.ts is the schema);
// an assessment keeps the exact version it was filled in with.

/** Why the assessment is done; the discipline is the therapy type */
export type AssessmentKind = 'INITIAL' | 'FOLLOW_UP' | 'REASSESSMENT';
export type AssessmentRecordStatus = 'DRAFT' | 'COMPLETED' | 'AMENDED';
export type AssessmentTemplateStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type TemplateVersionStatus = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
export type GoalPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export type TemplateFieldType =
  'TEXT' | 'TEXTAREA' | 'NUMBER' | 'SINGLE_SELECT' | 'MULTI_SELECT' | 'RADIO' | 'CHECKBOX' | 'DATE';

export interface TemplateFieldOption {
  value: string;
  label: string;
}

export interface TemplateFieldValidation {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  minSelections?: number;
  maxSelections?: number;
}

/** TEXT/TEXTAREA/selects/DATE: string; NUMBER: number; MULTI_SELECT: string[]; CHECKBOX: true */
export type AnswerValue = string | number | boolean | string[];
export type Answers = Record<string, AnswerValue>;

export interface TemplateField {
  /** Stable identifier answers are stored under */
  key: string;
  type: TemplateFieldType;
  label: string;
  helpText?: string;
  placeholder?: string;
  required: boolean;
  options?: TemplateFieldOption[];
  defaultValue?: AnswerValue;
  validation?: TemplateFieldValidation;
}

export interface TemplateSection {
  key: string;
  title: string;
  description?: string;
  fields: TemplateField[];
}

export interface TemplateDefinition {
  sections: TemplateSection[];
}

type UserRef = { id: ID; fullName: string };
type TherapyTypeRef = { id: ID; name: string; code: string; color: string | null };

/** GET /assessment-templates */
export interface AssessmentTemplateItem {
  id: ID;
  name: string;
  description: string | null;
  /** Null: any assessment type */
  purpose: AssessmentKind | null;
  status: AssessmentTemplateStatus;
  therapyType: TherapyTypeRef & { isActive: boolean };
  latestVersion: number;
  published: { id: ID; version: number; publishedAt: ISODateTime; fieldCount: number } | null;
  draft: { id: ID; version: number; updatedAt: ISODateTime } | null;
  assessmentCount: number;
  createdBy: UserRef;
  archivedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  actions: {
    edit: boolean;
    startVersion: boolean;
    discardDraft: boolean;
    publish: boolean;
    archive: boolean;
    restore: boolean;
  };
}

/** GET /assessment-templates/:id */
export interface AssessmentTemplateDetail extends Omit<
  AssessmentTemplateItem,
  'draft' | 'published'
> {
  draft: (NonNullable<AssessmentTemplateItem['draft']> & { definition: TemplateDefinition }) | null;
  published:
    | (NonNullable<AssessmentTemplateItem['published']> & {
        publishedBy: UserRef | null;
        definition: TemplateDefinition;
      })
    | null;
}

/** GET /assessment-templates/:id/versions */
export interface TemplateVersionItem {
  id: ID;
  version: number;
  status: TemplateVersionStatus;
  publishedAt: ISODateTime | null;
  publishedBy: UserRef | null;
  createdBy: UserRef;
  createdAt: ISODateTime;
  fieldCount: number;
  assessmentCount: number;
}

export interface TemplateVersionDetail {
  id: ID;
  version: number;
  status: TemplateVersionStatus;
  definition: TemplateDefinition;
  publishedAt: ISODateTime | null;
  publishedBy: UserRef | null;
  createdAt: ISODateTime;
  template: { id: ID; name: string };
}

export interface AssessmentActions {
  /** Open the clinical content, and print it */
  view: boolean;
  edit: boolean;
  complete: boolean;
  amend: boolean;
  discard: boolean;
}

/** GET /assessments: who, when and where it stands; never clinical content */
export interface AssessmentItem {
  id: ID;
  type: AssessmentKind;
  status: AssessmentRecordStatus;
  /** Center-local date */
  assessmentDate: ISODate;
  appointmentId: ID | null;
  revision: number;
  patient: { id: ID; code: string; fullName: string; photoUrl: string | null; isDeleted: boolean };
  therapist: { id: ID; code: string; fullName: string; isDeleted: boolean; isYou: boolean };
  therapyType: TherapyTypeRef;
  template: { id: ID; name: string; versionId: ID; version: number };
  completedAt: ISODateTime | null;
  completedBy: UserRef | null;
  amendmentCount: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  actions: AssessmentActions;
}

export type ClinicalSummaryKey =
  | 'summary'
  | 'keyFindings'
  | 'strengths'
  | 'areasOfDifficulty'
  | 'clinicalImpression'
  | 'followUpRecommendation'
  | 'additionalRecommendations';

export type ClinicalSummary = Record<ClinicalSummaryKey, string | null> & {
  suggestedReviewDate: ISODate | null;
};

export interface AssessmentRecommendation {
  therapyType: TherapyTypeRef;
  sessionsPerWeek: number | null;
  durationMinutes: number | null;
  reviewAfterWeeks: number | null;
  note: string | null;
}

export interface AssessmentGoal {
  title: string;
  description: string | null;
  priority: GoalPriority | null;
  targetReviewDate: ISODate | null;
}

export interface AssessmentContent {
  answers: Answers;
  clinicalSummary: ClinicalSummary;
  recommendations: AssessmentRecommendation[];
  goals: AssessmentGoal[];
}

export interface AssessmentAmendmentEntry {
  number: number;
  reason: string;
  /** Labels of what changed, never values */
  changedFields: string[];
  amendedAt: ISODateTime;
  amendedBy: UserRef;
}

interface AssessmentDetailBase extends AssessmentItem {
  appointment: {
    id: ID;
    status: AppointmentRecordStatus;
    date: ISODate;
    startTime: ClockTime;
    endTime: ClockTime;
  } | null;
  createdBy: UserRef;
}

/** GET /assessments/:id with clinical access */
export interface AssessmentDetail extends AssessmentDetailBase {
  clinicalAccess: true;
  patient: AssessmentItem['patient'] & {
    gender: PatientGender | null;
    ageAtAssessment: PatientAge | null;
    primaryConcern: string | null;
    referralSource: ReferralSource | null;
    referralOther: string | null;
  };
  therapist: AssessmentItem['therapist'] & {
    designation: string | null;
    qualifications: string | null;
    registrationNumber: string | null;
  };
  template: AssessmentItem['template'] & {
    description: string | null;
    versionStatus: TemplateVersionStatus;
  };
  form: TemplateDefinition;
  content: AssessmentContent;
  amendments: AssessmentAmendmentEntry[];
  updatedBy: UserRef | null;
}

/** GET /assessments/:id for callers who may only see that it exists */
export interface AssessmentStatusDetail extends AssessmentDetailBase {
  clinicalAccess: false;
  form: null;
  content: null;
  amendments: [];
  updatedBy: null;
}

/** GET /assessments/:id/amendments/:number: the content before that correction */
export interface AssessmentAmendmentSnapshot extends AssessmentAmendmentEntry {
  previousRevision: number;
  previousContent: AssessmentContent & { type: AssessmentKind; assessmentDate: ISODate };
  form: TemplateDefinition;
}

/** GET /assessments/patient-options */
export interface AssessmentPatientOption {
  id: ID;
  code: string;
  fullName: string;
  photoUrl: string | null;
  status: PatientRecordStatus;
  gender: PatientGender | null;
  age: PatientAge | null;
}

// ── Therapy plans (served by the API) ───────────────────────────────────────
// A plan is the intended treatment for one patient in one service. It never books,
// sells or bills anything; see apps/api/src/therapy-plans.

export type TherapyPlanStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'DISCONTINUED';
export type PlanPeriodUnit = 'DAY' | 'WEEK' | 'MONTH';
export type TherapyGoalStatus =
  'NOT_STARTED' | 'IN_PROGRESS' | 'ACHIEVED' | 'ON_HOLD' | 'DISCONTINUED';
export type GoalMeasurementType =
  'NARRATIVE' | 'PERCENTAGE' | 'COUNT' | 'DURATION' | 'FREQUENCY' | 'RATING_SCALE' | 'CUSTOM';
export type DurationUnit = 'SECONDS' | 'MINUTES' | 'HOURS';
export type ReviewOverallProgress =
  'SIGNIFICANT' | 'MODERATE' | 'MINIMAL' | 'NONE' | 'REGRESSION' | 'NOT_ENOUGH_INFORMATION';
export type ReviewRecommendation =
  | 'CONTINUE'
  | 'MODIFY'
  | 'INCREASE_FREQUENCY'
  | 'DECREASE_FREQUENCY'
  | 'PAUSE'
  | 'COMPLETE'
  | 'REFER_FOR_ASSESSMENT';
export type TherapyPlanEvent =
  | 'ACTIVATED'
  | 'PAUSED'
  | 'RESUMED'
  | 'COMPLETED'
  | 'DISCONTINUED'
  | 'REVISED'
  | 'THERAPIST_REASSIGNED'
  | 'GOAL_ADDED'
  | 'GOAL_UPDATED';

export interface MeasurementConfig {
  unit?: string;
  scaleMin?: number;
  scaleMax?: number;
}

/** What the caller may do with a plan now; the API still checks each request */
export interface PlanActions {
  view: boolean;
  edit: boolean;
  discard: boolean;
  activate: boolean;
  pause: boolean;
  resume: boolean;
  complete: boolean;
  discontinue: boolean;
  revise: boolean;
  review: boolean;
  recordProgress: boolean;
  manageGoals: boolean;
  reassign: boolean;
}

/** A row of GET /therapy-plans */
export interface TherapyPlanItem {
  id: ID;
  /** e.g. TP-0007 */
  code: string;
  title: string;
  status: TherapyPlanStatus;
  patient: { id: ID; code: string; fullName: string; photoUrl: string | null; isDeleted: boolean };
  therapyType: TherapyTypeRef & { isActive: boolean };
  therapist: {
    id: ID;
    code: string;
    fullName: string;
    isActive: boolean;
    isDeleted: boolean;
    isYou: boolean;
  };
  frequency: {
    sessionsPerPeriod: number | null;
    unit: PlanPeriodUnit | null;
    durationMinutes: number | null;
    /** "3 sessions per week" */
    label: string | null;
  };
  startDate: ISODate;
  targetEndDate: ISODate | null;
  nextReviewDate: ISODate | null;
  reviewState: 'OVERDUE' | 'DUE_SOON' | null;
  sourceAssessmentId: ID | null;
  /** Null without access to the clinical content */
  goalSummary: ({ total: number } & Record<TherapyGoalStatus, number>) | null;
  revision: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  actions: PlanActions;
}

export interface GoalProgressEntry {
  id: ID;
  goalId: ID;
  observationDate: ISODate;
  goalStatus: TherapyGoalStatus | null;
  measuredValue: number | null;
  observation: string | null;
  correctsId: ID | null;
  correctionReason: string | null;
  /** Replaced by a later correction; kept for the record */
  isCorrected: boolean;
  correctedById: ID | null;
  recordedBy: UserRef;
  createdAt: ISODateTime;
}

export interface PlanGoal {
  id: ID;
  title: string;
  description: string | null;
  category: { id: ID; name: string; isActive: boolean } | null;
  priority: GoalPriority | null;
  measurementType: GoalMeasurementType;
  measurementConfig: MeasurementConfig | null;
  baseline: { value: number | null; text: string | null };
  target: { value: number | null; text: string | null };
  targetDate: ISODate | null;
  status: TherapyGoalStatus;
  statusChangedAt: ISODateTime | null;
  statusChangedBy: UserRef | null;
  notes: string | null;
  displayOrder: number;
  sourceAssessmentGoalId: ID | null;
  latestProgress: GoalProgressEntry | null;
  progressCount: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface PlanReviewItem {
  id: ID;
  number: number;
  reviewDate: ISODate;
  overallProgress: ReviewOverallProgress;
  recommendation: ReviewRecommendation;
  nextReviewDate: ISODate | null;
  therapist: { id: ID; fullName: string; isYou: boolean };
  reviewedBy: UserRef;
  completedAt: ISODateTime;
  updatedAt: ISODateTime;
  amendmentCount: number;
}

/** A goal as it stood at a review */
export interface ReviewGoalSnapshot {
  id: ID;
  title: string;
  category: string | null;
  priority: GoalPriority | null;
  status: TherapyGoalStatus;
  measurementType: GoalMeasurementType;
  measurementConfig: MeasurementConfig | null;
  baseline: { value: number | null; text: string | null };
  target: { value: number | null; text: string | null };
  targetDate: ISODate | null;
  latestProgress: {
    observationDate: ISODate;
    measuredValue: number | null;
    goalStatus: TherapyGoalStatus | null;
    observation: string | null;
  } | null;
  progressCount: number;
}

export interface PlanReviewContent {
  reviewDate: ISODate;
  overallProgress: ReviewOverallProgress;
  recommendation: ReviewRecommendation;
  observations: string | null;
  goalSummary: string | null;
  notes: string | null;
  nextReviewDate: ISODate | null;
}

/** GET /therapy-plans/:id/reviews/:reviewId */
export interface PlanReviewDetail extends PlanReviewItem {
  therapyPlanId: ID;
  observations: string | null;
  goalSummary: string | null;
  notes: string | null;
  goalSnapshot: ReviewGoalSnapshot[];
  planSnapshot: {
    status: TherapyPlanStatus;
    frequency: string | null;
    durationMinutes: number | null;
    nextReviewDate: ISODate | null;
    targetEndDate: ISODate | null;
  };
  amendments: {
    number: number;
    reason: string;
    changedFields: string[];
    previousContent: PlanReviewContent;
    amendedAt: ISODateTime;
    amendedBy: UserRef;
  }[];
  actions: { amend: boolean };
}

export interface PlanHistoryEntry {
  number: number;
  event: TherapyPlanEvent;
  /** Labels of what changed, never values */
  changedFields: string[];
  previousSnapshot: Record<string, unknown> | null;
  newSnapshot: Record<string, unknown> | null;
  reason: string | null;
  goalId: ID | null;
  reviewId: ID | null;
  revisedAt: ISODateTime;
  revisedBy: UserRef;
}

interface TherapyPlanDetailBase extends TherapyPlanItem {
  reviewInterval: { value: number | null; unit: PlanPeriodUnit | null };
  activatedAt: ISODateTime | null;
  activatedBy: UserRef | null;
  pausedAt: ISODateTime | null;
  completedAt: ISODateTime | null;
  discontinuedAt: ISODateTime | null;
  createdBy: UserRef;
}

/** GET /therapy-plans/:id with clinical access */
export interface TherapyPlanDetail extends TherapyPlanDetailBase {
  clinicalAccess: true;
  treatmentFocus: string | null;
  clinicalNotes: string | null;
  additionalInstructions: string | null;
  statusReason: string | null;
  completionSummary: string | null;
  completedBy: UserRef | null;
  discontinuedBy: UserRef | null;
  updatedBy: UserRef | null;
  sourceAssessment: {
    id: ID;
    type: AssessmentKind;
    status: AssessmentRecordStatus;
    assessmentDate: ISODate;
    therapyType: TherapyTypeRef & { isActive: boolean };
    therapist: { id: ID; fullName: string };
  } | null;
  goals: PlanGoal[];
  reviews: PlanReviewItem[];
  history: PlanHistoryEntry[];
}

/** GET /therapy-plans/:id for callers who may only see that it exists and its schedule */
export interface TherapyPlanStatusDetail extends TherapyPlanDetailBase {
  clinicalAccess: false;
  goals: [];
  reviews: [];
  history: [];
}

/** GET /therapy-plans/assessment-options: completed assessments to start a plan from */
export interface PlanAssessmentOption {
  id: ID;
  type: AssessmentKind;
  status: AssessmentRecordStatus;
  assessmentDate: ISODate;
  summary: string | null;
  suggestedReviewDate: ISODate | null;
  therapyType: TherapyTypeRef;
  therapist: { id: ID; fullName: string };
  recommendations: AssessmentRecommendation[];
  goals: (AssessmentGoal & { id: ID })[];
  therapyPlans: { id: ID; code: string; status: TherapyPlanStatus; therapyTypeId: ID }[];
}

/** GET /therapy-goal-categories */
export interface GoalCategory {
  id: ID;
  name: string;
  description: string | null;
  isActive: boolean;
  displayOrder: number;
  therapyType: (TherapyTypeRef & { isActive: boolean }) | null;
  goalCount: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ── Packages & billing ──────────────────────────────────────────────────────

/** How the package is billed. Independent of how sessions recur on the calendar. */
export type BillingCadence = 'single' | 'daily' | 'weekly' | 'monthly' | 'custom';

export interface TherapyPackage {
  id: ID;
  name: string;
  therapyTypeId: ID;
  billingCadence: BillingCadence;
  price: number;
  sessionCount: number;
  sessionMinutes: number;
  validityDays: number;
  status: 'active' | 'archived';
  description?: string;
}

export type PatientPackageStatus = 'active' | 'completed' | 'expired' | 'cancelled';
export type PrototypePaymentStatus = 'paid' | 'partial' | 'unpaid';

export interface PatientPackage {
  id: ID;
  patientId: ID;
  packageId: ID;
  name: string;
  therapyTypeId: ID;
  totalSessions: number;
  usedSessions: number;
  /** Booked but not yet completed */
  scheduledSessions: number;
  startDate: ISODate;
  expiresAt: ISODate;
  price: number;
  paidAmount: number;
  status: PatientPackageStatus;
}

export type PrototypeInvoiceStatus = 'paid' | 'partial' | 'unpaid' | 'overdue' | 'void';

export interface PrototypeInvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface PrototypeInvoice {
  id: ID;
  number: string;
  patientId: ID;
  patientPackageId?: ID;
  issuedAt: ISODate;
  dueAt: ISODate;
  items: PrototypeInvoiceItem[];
  discount: number;
  total: number;
  paid: number;
  status: PrototypeInvoiceStatus;
}

export type PrototypePaymentMethod = 'cash' | 'bkash' | 'nagad' | 'card' | 'bank';

export interface PrototypePayment {
  id: ID;
  receiptNumber: string;
  invoiceId?: ID;
  patientId: ID;
  amount: number;
  method: PrototypePaymentMethod;
  reference?: string;
  receivedAt: ISODateTime;
  receivedBy: string;
}

export type PrototypeExpenseCategory =
  'rent' | 'salary' | 'utilities' | 'supplies' | 'maintenance' | 'marketing' | 'other';

export interface PrototypeExpense {
  id: ID;
  date: ISODate;
  category: PrototypeExpenseCategory;
  description: string;
  amount: number;
  method: PrototypePaymentMethod;
  paidTo?: string;
}

// ── Misc ────────────────────────────────────────────────────────────────────

export interface AppNotification {
  id: ID;
  title: string;
  body: string;
  href?: string;
  createdAt: ISODateTime;
  read: boolean;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Packages ────────────────────────────────────────────────────────────────

/** Money as the API sends it: an exact two-decimal string, e.g. "9000.00" */
export type Money = string;

export type PackagePeriodUnit = 'DAY' | 'WEEK' | 'MONTH';
export type PackageActivationPolicy = 'ENROLLMENT_DATE' | 'FIXED_DATE' | 'FIRST_SESSION';
export type PackageDiscountType = 'NONE' | 'FIXED' | 'PERCENTAGE' | 'PRICE_OVERRIDE';
/** EXPIRED and EXHAUSTED are derived from dates and balances on every read */
export type EnrollmentStatus = 'PENDING' | 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED' | 'CANCELLED';
export type PackageMovementType =
  | 'INITIAL_ALLOCATION'
  | 'BONUS_CREDIT'
  | 'MANUAL_CREDIT'
  | 'MANUAL_DEBIT'
  | 'SESSION_CONSUMPTION'
  | 'CONSUMPTION_REVERSAL';
export type PackageChargeReason = 'COMPLETED' | 'NO_SHOW' | 'LATE_CANCELLATION';
export type PackageReleaseReason =
  'APPOINTMENT_CANCELLED' | 'NO_SHOW_NOT_CHARGED' | 'REMOVED' | 'ENROLLMENT_CANCELLED';
export type AdjustmentType =
  'BONUS_CREDIT' | 'MANUAL_CREDIT' | 'MANUAL_DEBIT' | 'CONSUMPTION_REVERSAL';

export interface PackageTherapyType {
  id: ID;
  name: string;
  code: string;
  color: string | null;
  isActive: boolean;
}

/** GET /packages, /packages/:id */
export interface TherapyPackageItem {
  id: ID;
  code: string;
  name: string;
  description: string | null;
  sessionCount: number;
  defaultDurationMinutes: number | null;
  price: Money;
  validityValue: number;
  validityUnit: PackagePeriodUnit;
  activationPolicy: PackageActivationPolicy;
  usageLimitCount: number | null;
  usageLimitPeriod: PackagePeriodUnit | null;
  usageLimit: { count: number; period: PackagePeriodUnit } | null;
  coversAssessments: boolean;
  chargeNoShow: boolean;
  chargeLateCancellation: boolean;
  isActive: boolean;
  displayOrder: number;
  therapyTypes: PackageTherapyType[];
  enrollmentCount: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  actions: {
    edit: boolean;
    activate: boolean;
    deactivate: boolean;
    duplicate: boolean;
    delete: boolean;
    enroll: boolean;
  };
}

export interface EnrollmentSessions {
  purchased: number;
  /** Purchased plus credits minus manual debits */
  total: number;
  consumed: number;
  reserved: number;
  remaining: number;
  availableToBook: number;
}

/** GET /package-enrollments */
export interface EnrollmentItem {
  id: ID;
  code: string;
  status: EnrollmentStatus;
  patient: { id: ID; code: string; fullName: string; photoUrl: string | null; isDeleted: boolean };
  package: { id: ID; name: string; code: string };
  therapyTypes: PackageTherapyType[];
  therapyPlan: { id: ID; code: string; status: TherapyPlanStatus } | null;
  activationPolicy: PackageActivationPolicy;
  startDate: ISODate | null;
  endDate: ISODate | null;
  /** Days from today to the last valid day; negative after it */
  daysLeft: number | null;
  expiringSoon: boolean;
  sessions: EnrollmentSessions;
  currency: string;
  finalPrice: Money;
  renewedFromId: ID | null;
  cancelledAt: ISODateTime | null;
  createdAt: ISODateTime;
  actions: { renew: boolean; cancel: boolean; adjust: boolean };
}

export interface EnrollmentAppointment {
  id: ID;
  status: AppointmentRecordStatus;
  type: AppointmentType;
  date: ISODate;
  startTime: ClockTime;
  therapist: { id: ID; fullName: string };
  therapyType: { id: ID; name: string; code: string; color: string | null };
}

/** GET /package-enrollments/:id */
export interface EnrollmentDetail extends EnrollmentItem {
  sessions: EnrollmentSessions & {
    additionalCredits: number;
    manualDebits: number;
    reversed: number;
  };
  terms: {
    sessionCount: number;
    defaultDurationMinutes: number | null;
    validity: { value: number; unit: PackagePeriodUnit };
    usageLimit: { count: number; period: PackagePeriodUnit } | null;
    coversAssessments: boolean;
    chargeNoShow: boolean;
    chargeLateCancellation: boolean;
  };
  pricing: {
    currency: string;
    catalogPrice: Money;
    discountType: PackageDiscountType;
    discountValue: Money | null;
    /** Catalog price minus the agreed price; negative when set higher */
    discountAmount: Money;
    finalPrice: Money;
  };
  catalogPackage: { id: ID; code: string; name: string; isActive: boolean };
  customEndDate: boolean;
  activatedAt: ISODateTime | null;
  notes: string | null;
  cancellationReason: string | null;
  cancelledBy: { id: ID; fullName: string } | null;
  createdBy: { id: ID; fullName: string };
  updatedAt: ISODateTime;
  therapyPlan: { id: ID; code: string; title: string; status: TherapyPlanStatus } | null;
  renewedFrom: { id: ID; code: string; startDate: ISODate | null; endDate: ISODate | null } | null;
  renewals: { id: ID; code: string; createdAt: ISODateTime }[];
  /** Booked sessions holding one of its sessions, earliest first */
  upcoming: EnrollmentAppointment[];
}

/** One entry of GET /package-enrollments/:id/ledger, oldest first */
export interface EnrollmentMovement {
  id: string;
  type: PackageMovementType | 'SESSION_RESERVED' | 'RESERVATION_RELEASED';
  quantity: number;
  at: ISODateTime;
  by: { id: ID; fullName: string } | null;
  reason: string | null;
  chargeReason: PackageChargeReason | null;
  releaseReason: PackageReleaseReason | null;
  reversesId: ID | null;
  reversed: boolean;
  appointment: EnrollmentAppointment | null;
}

/** GET /package-enrollments/options: a package and whether it can pay for a session */
export interface EnrollmentOption extends EnrollmentItem {
  eligible: boolean;
  problems: { reason: string; message: string }[];
  /** The appointment being changed already uses it */
  current: boolean;
}

export interface AppointmentPackage {
  enrollmentId: ID;
  code: string;
  name: string;
  coverage: 'HELD' | 'CHARGED' | 'REVERSED' | 'RELEASED';
  chargeReason: PackageChargeReason | null;
  releaseReason: PackageReleaseReason | null;
  consumptionId: ID | null;
}

// ── Sessions: attendance, session records and notes (served by the API) ─────
// A session is addressed by its appointment's ID. Attendance, the session's lifecycle,
// its note and the appointment's status are separate records the API keeps in step.

export type AttendanceStatus = 'NOT_MARKED' | 'PRESENT' | 'ABSENT' | 'LATE';
export type SessionStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'VOIDED';
export type SessionNoteStatus = 'DRAFT' | 'COMPLETED' | 'AMENDED';
/** NONE: no note started yet */
export type NoteState = 'NONE' | SessionNoteStatus;
export type SessionCorrectionOutcome = 'NOT_ATTENDED' | 'NOT_DELIVERED';
export type SessionNoteTemplateStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

/** What the signed-in user may do with a session now (decided by the API) */
export interface SessionActions {
  checkIn: boolean;
  markPresent: boolean;
  markLate: boolean;
  /** Also makes the appointment a no-show */
  markAbsent: boolean;
  /** After the appointment closed, with a reason */
  correctAttendance: boolean;
  start: boolean;
  /** When attendance isn't marked, completing asks for it */
  complete: boolean;
  /** Void a completed session, reversing its package charge */
  correct: boolean;
  writeNote: boolean;
  editNote: boolean;
  viewNote: boolean;
  amendNote: boolean;
}

/** A row of the session lists: an appointment with its attendance, session and note */
export interface SessionItem extends Omit<AppointmentItem, 'attendance'> {
  attendance: {
    status: AttendanceStatus;
    checkInAt: ISODateTime | null;
    actualStartAt: ISODateTime | null;
    actualEndAt: ISODateTime | null;
    /** The same times as the center's wall clock */
    checkInTime: ClockTime | null;
    actualStartTime: ClockTime | null;
    actualEndTime: ClockTime | null;
  };
  sessionStatus: SessionStatus;
  /** The plan the session belongs to, once it started */
  plan: { id: ID; code: string; status: TherapyPlanStatus } | null;
  note: {
    id: ID;
    status: SessionNoteStatus;
    completedAt: ISODateTime | null;
    updatedAt: ISODateTime;
  } | null;
  noteStatus: NoteState;
  /** The session took place but its note isn't signed off yet */
  notePending: boolean;
  /** No prices or balances */
  packageUsage: AppointmentPackage['coverage'] | null;
  sessionActions: SessionActions;
}

/** GET /sessions/:id */
export interface SessionDetail extends SessionItem {
  attendance: SessionItem['attendance'] & {
    note: string | null;
    revision: number | null;
    recordedAt: ISODateTime | null;
    recordedBy: { id: ID; fullName: string } | null;
  };
  session: {
    status: SessionStatus;
    startedAt: ISODateTime | null;
    startedBy: { id: ID; fullName: string } | null;
    completedAt: ISODateTime | null;
    completedBy: { id: ID; fullName: string } | null;
    voidedAt: ISODateTime | null;
    voidedBy: { id: ID; fullName: string } | null;
    voidReason: string | null;
  };
  note:
    | (NonNullable<SessionItem['note']> & {
        completedBy: { id: ID; fullName: string } | null;
        therapist: { id: ID; fullName: string };
      })
    | null;
  /** The plan the session belongs to, if the caller may see plans */
  plan: { id: ID; code: string; title: string; status: TherapyPlanStatus } | null;
  package: Omit<AppointmentPackage, 'consumptionId'> | null;
  history: AppointmentHistoryEntry[];
}

/** GET /sessions/today */
export interface TodaySessions extends Paginated<SessionItem> {
  date: ISODate;
  timezone: string;
  /** For the whole day, whatever the filters */
  summary: {
    expected: number;
    arrived: number;
    notMarked: number;
    absent: number;
    completed: number;
    cancelled: number;
    notesPending: number;
  };
}

/** GET /my-sessions */
export interface MySessions {
  therapist: { id: ID; code: string; fullName: string } | null;
  today: SessionItem[];
  /** Oldest first */
  pendingNotes: SessionItem[];
  recent: SessionItem[];
}

/** GET /patients/:id/sessions */
export interface PatientSessions extends Paginated<
  SessionItem & {
    /** Goals with progress in the note; null without clinical access */
    goalsRecorded: number | null;
  }
> {
  patient: { id: ID; code: string; fullName: string };
}

/** Progress for one goal, as a note records it */
export interface NoteGoalEntry {
  goalId: ID;
  observation: string | null;
  measuredValue: number | null;
  goalStatus: TherapyGoalStatus | null;
  /** Completed notes: the progress entry it was recorded as */
  progressId?: ID;
}

/** A goal of the session's plan, to choose from */
export interface NotePlanGoal {
  id: ID;
  title: string;
  description: string | null;
  status: TherapyGoalStatus;
  measurementType: GoalMeasurementType;
  measurementConfig: MeasurementConfig | null;
  baselineText: string | null;
  baselineValue: number | null;
  targetText: string | null;
  targetValue: number | null;
  targetDate: ISODate | null;
  category: { id: ID; name: string } | null;
  latestProgress: {
    observationDate: ISODate;
    measuredValue: number | null;
    goalStatus: TherapyGoalStatus | null;
  } | null;
}

/** GET /sessions/:id/note */
export interface SessionNoteDetail {
  id: ID;
  appointmentId: ID;
  status: SessionNoteStatus;
  revision: number;
  session: {
    appointmentId: ID;
    date: ISODate;
    startTime: ClockTime;
    endTime: ClockTime;
    appointmentStatus: AppointmentRecordStatus;
    sessionStatus: SessionStatus;
    patient: { id: ID; code: string; fullName: string };
    therapyType: { id: ID; name: string; code: string; color: string | null };
  };
  template: {
    id: ID;
    name: string;
    description: string | null;
    versionId: ID;
    version: number;
    versionStatus: TemplateVersionStatus;
  };
  form: TemplateDefinition;
  answers: Answers;
  goals: NoteGoalEntry[];
  plan: { id: ID; code: string; title: string; status: TherapyPlanStatus } | null;
  planGoals: NotePlanGoal[];
  therapist: { id: ID; code: string; fullName: string; designation: string | null; isYou: boolean };
  createdBy: { id: ID; fullName: string };
  updatedBy: { id: ID; fullName: string } | null;
  completedBy: { id: ID; fullName: string } | null;
  completedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  amendments: {
    number: number;
    reason: string;
    /** Labels of what changed, never values */
    changedFields: string[];
    amendedAt: ISODateTime;
    amendedBy: { id: ID; fullName: string };
  }[];
  actions: { edit: boolean; complete: boolean; amend: boolean; discard: boolean };
}

/** GET /sessions/:id/note/amendments/:number: the note before that correction */
export interface NoteAmendmentSnapshot {
  number: number;
  reason: string;
  changedFields: string[];
  amendedAt: ISODateTime;
  amendedBy: { id: ID; fullName: string };
  previousRevision: number;
  previousContent: { answers: Answers; goals: NoteGoalEntry[] };
  form: TemplateDefinition;
}

/** GET /session-note-templates */
export interface NoteTemplateItem {
  id: ID;
  name: string;
  description: string | null;
  status: SessionNoteTemplateStatus;
  /** Preselected for new notes of its therapy (or, if general, of any without one) */
  isDefault: boolean;
  /** Null: a general template for every therapy */
  therapyType: {
    id: ID;
    name: string;
    code: string;
    color: string | null;
    isActive: boolean;
  } | null;
  latestVersion: number;
  published: { id: ID; version: number; publishedAt: ISODateTime; fieldCount: number } | null;
  draft: { id: ID; version: number; updatedAt: ISODateTime } | null;
  noteCount: number;
  createdBy: { id: ID; fullName: string };
  archivedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  actions: {
    edit: boolean;
    startVersion: boolean;
    discardDraft: boolean;
    publish: boolean;
    archive: boolean;
    restore: boolean;
    makeDefault: boolean;
  };
}

/** GET /session-note-templates/:id */
export interface NoteTemplateDetail extends Omit<NoteTemplateItem, 'draft' | 'published'> {
  draft: (NonNullable<NoteTemplateItem['draft']> & { definition: TemplateDefinition }) | null;
  published:
    | (NonNullable<NoteTemplateItem['published']> & {
        publishedBy: { id: ID; fullName: string } | null;
        definition: TemplateDefinition;
      })
    | null;
}

/** GET /session-note-templates/:id/versions */
export interface NoteTemplateVersionItem extends Omit<TemplateVersionItem, 'assessmentCount'> {
  noteCount: number;
}

// ── Billing (served by the API) ─────────────────────────────────────────────
// Invoices are obligations, payments money received, allocations how payments apply to
// invoices; unapplied money is the patient's credit. Money is always a two-decimal
// string from the API; previews are computed in whole paisa (see finance-display).

type PersonRef = { id: ID; fullName: string };

export type BillableServiceCategory = 'ASSESSMENT' | 'THERAPY_SESSION' | 'OTHER';
export type AssessmentBillingPolicy = 'ON_BOOKING' | 'MANUAL';
export type SessionBillingPolicy = 'ON_COMPLETION' | 'MANUAL';
export type PackageBillingPolicy = 'ON_ENROLLMENT' | 'MANUAL';
export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
export type InvoiceItemKind =
  'PACKAGE' | 'ASSESSMENT_FEE' | 'SESSION_FEE' | 'ADDITIONAL_FEE' | 'OTHER';
export type BillingDiscountType = 'FIXED' | 'PERCENTAGE';
export type PaymentStatus = 'RECORDED' | 'REVERSED';
export type AllocationReleaseReason = 'REALLOCATED' | 'INVOICE_VOIDED' | 'PAYMENT_REVERSED';
export type ExpenseStatus = 'RECORDED' | 'VOID';
export type AgingBucket = 'NOT_DUE' | 'DAYS_1_7' | 'DAYS_8_30' | 'DAYS_31_60' | 'DAYS_60_PLUS';

/** GET /billing/settings */
export interface BillingSettings {
  invoicePrefix: string;
  receiptPrefix: string;
  defaultDueDays: number;
  allowPartialPayment: boolean;
  allowAdvancePayment: boolean;
  allowManualDiscount: boolean;
  /** Percentage; "0.00" means no tax */
  taxRate: Money;
  taxLabel: string;
  assessmentBillingPolicy: AssessmentBillingPolicy;
  sessionBillingPolicy: SessionBillingPolicy;
  packageBillingPolicy: PackageBillingPolicy;
  /** The center's own (center profile) */
  currency: string;
  timezone: string;
  updatedAt: ISODateTime;
}

export interface PaymentMethodItem {
  id: ID;
  name: string;
  requiresReference: boolean;
  isActive: boolean;
  displayOrder: number;
}

export interface ExpenseCategoryItem {
  id: ID;
  name: string;
  isActive: boolean;
  displayOrder: number;
}

export interface BillableServiceItem {
  id: ID;
  code: string;
  name: string;
  category: BillableServiceCategory;
  therapyType: (TherapyTypeRef & { isActive: boolean }) | null;
  price: Money;
  defaultDurationMinutes: number | null;
  description: string | null;
  isActive: boolean;
  displayOrder: number;
  usageCount: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  actions: { edit: boolean; activate: boolean; deactivate: boolean };
}

export interface BillingPatientRef {
  id: ID;
  code: string;
  fullName: string;
  photoUrl: string | null;
  status: PatientRecordStatus;
  isDeleted: boolean;
}

export interface InvoiceActions {
  edit: boolean;
  discard: boolean;
  issue: boolean;
  collect: boolean;
  void: boolean;
}

/** An invoice in lists */
export interface InvoiceSummary {
  id: ID;
  number: string | null;
  status: InvoiceStatus;
  patient: BillingPatientRef;
  invoiceDate: ISODate;
  dueDate: ISODate | null;
  currency: string;
  subtotal: Money;
  discountAmount: Money;
  taxAmount: Money;
  totalAmount: Money;
  paidAmount: Money;
  outstanding: Money;
  overdue: boolean;
  daysOverdue: number | null;
  aging: AgingBucket | null;
  itemCount: number;
  automatic: boolean;
  issuedAt: ISODateTime | null;
  createdAt: ISODateTime;
  actions: InvoiceActions;
}

export interface InvoiceLine {
  id: ID;
  position: number;
  kind: InvoiceItemKind;
  description: string;
  quantity: number;
  unitPrice: Money;
  amount: Money;
  discountType: BillingDiscountType | null;
  discountValue: Money | null;
  discountAmount: Money;
  totalAmount: Money;
  active: boolean;
  service: { id: ID; code: string; name: string; category: BillableServiceCategory } | null;
  appointment: {
    id: ID;
    type: AppointmentType;
    status: AppointmentRecordStatus;
    date: ISODate;
    therapyType: TherapyTypeRef;
    therapist: PersonRef;
  } | null;
  packageEnrollment: { id: ID; code: string; packageName: string } | null;
}

export interface InvoiceAllocation {
  id: ID;
  amount: Money;
  createdAt: ISODateTime;
  createdBy: PersonRef;
  active: boolean;
  releasedAt: ISODateTime | null;
  releasedBy: PersonRef | null;
  releaseReason: AllocationReleaseReason | null;
  releaseNote: string | null;
  payment: {
    id: ID;
    number: string;
    collectedAt: ISODateTime;
    status: PaymentStatus;
    method: { id: ID; name: string };
  };
}

/** GET /invoices/:id */
export interface InvoiceDetail extends InvoiceSummary {
  invoiceDiscount: { type: BillingDiscountType; value: Money; amount: Money } | null;
  taxRate: Money;
  taxLabel: string | null;
  notes: string | null;
  revision: number;
  updatedAt: ISODateTime;
  createdBy: PersonRef;
  updatedBy: PersonRef | null;
  issuedBy: PersonRef | null;
  voidedAt: ISODateTime | null;
  voidedBy: PersonRef | null;
  voidReason: string | null;
  reissuedFrom: { id: ID; number: string | null } | null;
  reissues: { id: ID; number: string | null; status: InvoiceStatus }[];
  items: InvoiceLine[];
  allocations: InvoiceAllocation[];
  patientCredit: Money;
  history: { id: ID; action: string; at: ISODateTime; by: PersonRef | null; metadata: unknown }[];
  actions: InvoiceActions & { applyCredit: boolean; reallocate: boolean };
}

export interface CenterLetterhead {
  name: string;
  code: string;
  phone: string;
  email: string | null;
  address: string;
  district: string | null;
  website: string | null;
  logoUrl: string | null;
}

export interface PayerContact {
  name: string | null;
  relationship: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
}

/** GET /invoices/:id/print */
export interface InvoicePrint {
  center: CenterLetterhead;
  contact: PayerContact;
  invoice: InvoiceDetail;
}

/** Something a patient could be invoiced for: GET /billing/charges */
export interface BillableCharge {
  key: string;
  kind: InvoiceItemKind;
  description: string;
  date: ISODate;
  packageEnrollmentId: ID | null;
  appointmentId: ID | null;
  appointment: {
    id: ID;
    type: AppointmentType;
    status: AppointmentRecordStatus;
    date: ISODate;
    therapyType: TherapyTypeRef;
    therapist: PersonRef;
  } | null;
  service: { id: ID; code: string; name: string } | null;
  /** Null when no active service prices it (see `problem`) */
  unitPrice: Money | null;
  problem: string | null;
}

export interface PaymentActions {
  allocate: boolean;
  refund: boolean;
  reverse: boolean;
  reallocate: boolean;
}

export interface PaymentSummary {
  id: ID;
  number: string;
  status: PaymentStatus;
  patient: BillingPatientRef;
  amount: Money;
  currency: string;
  allocatedAmount: Money;
  refundedAmount: Money;
  unappliedAmount: Money;
  method: { id: ID; name: string; isActive: boolean };
  transactionReference: string | null;
  collectedAt: ISODateTime;
  collectedBy: PersonRef;
  reversedAt: ISODateTime | null;
  invoices: { id: ID; number: string | null }[];
  createdAt: ISODateTime;
  actions: PaymentActions;
}

export interface PaymentRefund {
  id: ID;
  amount: Money;
  reason: string;
  reference: string | null;
  refundedAt: ISODateTime;
  method: { id: ID; name: string; isActive: boolean };
  approvedBy: PersonRef;
}

/** GET /payments/:id */
export interface PaymentDetail extends PaymentSummary {
  notes: string | null;
  reversalReason: string | null;
  reversedBy: PersonRef | null;
  allocations: {
    id: ID;
    amount: Money;
    active: boolean;
    createdAt: ISODateTime;
    createdBy: PersonRef;
    releasedAt: ISODateTime | null;
    releasedBy: PersonRef | null;
    releaseReason: AllocationReleaseReason | null;
    releaseNote: string | null;
    invoice: {
      id: ID;
      number: string | null;
      status: InvoiceStatus;
      invoiceDate: ISODate;
      totalAmount: Money;
      outstanding: Money;
    };
  }[];
  refunds: (PaymentRefund & { createdAt: ISODateTime })[];
  /** Always false: manual records are not confirmed by any payment provider */
  verified: false;
}

export interface ExpenseItem {
  id: ID;
  expenseDate: ISODate;
  description: string;
  amount: Money;
  reference: string | null;
  notes: string | null;
  status: ExpenseStatus;
  revision: number;
  corrections: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  voidedAt: ISODateTime | null;
  voidReason: string | null;
  category: { id: ID; name: string; isActive: boolean };
  method: { id: ID; name: string; isActive: boolean };
  createdBy: PersonRef;
  updatedBy: PersonRef | null;
  voidedBy: PersonRef | null;
  actions: { correct: boolean; void: boolean };
}

export interface ExpenseDetail extends ExpenseItem {
  revisions: {
    id: ID;
    reason: string;
    changed: string[];
    before: Record<string, string | null>;
    after: Record<string, string | null>;
    createdAt: ISODateTime;
    createdBy: PersonRef;
  }[];
}

/** GET /finance/summary */
export interface FinanceSummary {
  currency: string;
  from: ISODate | null;
  to: ISODate;
  today: ISODate;
  todayCollections: Money;
  todayPayments: number;
  todayRefunds: Money;
  collections: Money;
  payments: number;
  refunds: Money;
  netCollections: Money;
  invoiced: Money;
  invoiceCount: number;
  outstanding: Money;
  outstandingInvoices: number;
  overdue: Money;
  overdueInvoices: number;
  unappliedCredit: Money;
  expenses: Money;
  expenseCount: number;
  netCashMovement: Money;
  byMethod: {
    method: { id: ID; name: string };
    payments: number;
    collected: Money;
    refunds: Money;
    expenses: Money;
    net: Money;
  }[];
  recentPayments: PaymentSummary[];
  outstandingList: InvoiceSummary[];
  recentExpenses: ExpenseItem[];
}

export interface DueItem extends InvoiceSummary {
  contact: PayerContact;
}

/** GET /finance/dues */
export interface DuesPage extends Paginated<DueItem> {
  currency: string;
  outstanding: Money;
  aging: { bucket: AgingBucket; invoices: number; outstanding: Money }[];
}

/** GET /finance/collections */
export interface CollectionsReport {
  currency: string;
  from: ISODate | null;
  to: ISODate;
  collectedById: ID | null;
  rows: {
    date: ISODate;
    collector: PersonRef | null;
    method: { id: ID; name: string } | null;
    payments: number;
    collected: Money;
    reversedPayments: number;
    reversed: Money;
    refundCount: number;
    refunds: Money;
    net: Money;
  }[];
  totals: {
    payments: number;
    collected: Money;
    reversedPayments: number;
    reversed: Money;
    refundCount: number;
    refunds: Money;
    net: Money;
  };
}

/** GET /finance/expenses-summary */
export interface ExpensesSummary {
  currency: string;
  from: ISODate | null;
  to: ISODate;
  categories: { category: { id: ID; name: string } | null; expenses: number; amount: Money }[];
  methods: { method: { id: ID; name: string } | null; expenses: number; amount: Money }[];
  total: Money;
  count: number;
}

/** GET /finance/package-sales */
export interface PackageSalesReport {
  currency: string;
  from: ISODate | null;
  to: ISODate;
  rows: {
    package: { id: ID; name: string; code: string };
    enrollments: number;
    cancelled: number;
    uninvoiced: number;
    agreed: Money;
    invoiced: Money;
    collected: Money;
  }[];
  totals: { enrollments: number; agreed: Money; invoiced: Money; collected: Money };
}

/** GET /patients/:id/billing-summary */
export interface PatientBillingSummary {
  patient: { id: ID; code: string; fullName: string };
  currency: string;
  outstanding: Money;
  openInvoices: number;
  overdue: Money;
  overdueInvoices: number;
  unappliedCredit: Money;
  invoiced: Money;
  paid: Money;
  refunded: Money;
  draftInvoices: number;
  uninvoicedCharges: number | null;
}
