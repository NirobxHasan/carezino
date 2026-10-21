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
  defaultPatientStatus: 'ACTIVE' | 'WAITLIST';
  dateFormat: DateDisplayFormat;
  timeFormat: TimeDisplayFormat;
  /** 0 = Sunday, 1 = Monday, 6 = Saturday */
  weekStartsOn: number;
  updatedAt: ISODateTime;
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
