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
  /** Booked over a clash on purpose (the center allows double booking) */
  allowOverlap: boolean;
  lateCancellation: boolean;
  cancellationReason: CancellationReason | null;
  cancelledAt: ISODateTime | null;
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
  'CREATED' | 'UPDATED' | 'RESCHEDULED' | 'STATUS_CHANGED' | 'CANCELLED';

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
export type PaymentStatus = 'paid' | 'partial' | 'unpaid';

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

export type InvoiceStatus = 'paid' | 'partial' | 'unpaid' | 'overdue' | 'void';

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Invoice {
  id: ID;
  number: string;
  patientId: ID;
  patientPackageId?: ID;
  issuedAt: ISODate;
  dueAt: ISODate;
  items: InvoiceItem[];
  discount: number;
  total: number;
  paid: number;
  status: InvoiceStatus;
}

export type PaymentMethod = 'cash' | 'bkash' | 'nagad' | 'card' | 'bank';

export interface Payment {
  id: ID;
  receiptNumber: string;
  invoiceId?: ID;
  patientId: ID;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  receivedAt: ISODateTime;
  receivedBy: string;
}

export type ExpenseCategory =
  'rent' | 'salary' | 'utilities' | 'supplies' | 'maintenance' | 'marketing' | 'other';

export interface Expense {
  id: ID;
  date: ISODate;
  category: ExpenseCategory;
  description: string;
  amount: number;
  method: PaymentMethod;
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
