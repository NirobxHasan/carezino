import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { normalizePhone } from '../common/identifiers';
import {
  EmptyToNull,
  IfPresent,
  IsAnyMobile,
  IsPhone,
  NormalizeAnyMobile,
  NormalizeEmail,
  NormalizeUrl,
  Trim,
  TrimOrNull,
  URL_OPTIONS,
} from '../common/validation';
import {
  ConsentGivenBy,
  ConsentPurpose,
  Gender,
  GuardianContactType,
  GuardianRelationship,
  PatientStatus,
  ReferralSource,
} from '../generated/prisma/enums';
import { MAX_AGE_YEARS } from './age';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Choose a valid date';
/** Upper-cased first; letters, numbers and dashes, e.g. P-0042 or 2026-017 */
const CODE = /^[A-Z0-9][A-Z0-9-]{0,19}$/;
export const LIMITS = {
  therapyInterests: 20,
  name: 120,
  text: 2000,
  address: 500,
} as const;

/** Upper-cases and trims; an empty string becomes undefined. */
const NormalizeCode = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const code = value.trim().toUpperCase();
    return code === '' ? undefined : code;
  });

/** Like NormalizePhone, but an empty string becomes null so it can be cleared. */
const NormalizeOptionalPhone = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    if (value.trim() === '') return null;
    return normalizePhone(value) ?? value.trim();
  });

/** How a patient is reached first: themselves, or a guardian or caregiver. */
export const CONTACT_TYPES = ['SELF', 'GUARDIAN', 'CAREGIVER'] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const PATIENT_SORT_FIELDS = [
  'registeredAt',
  'fullName',
  'code',
] as const;
export type PatientSortField = (typeof PATIENT_SORT_FIELDS)[number];

export class ListPatientsQuery {
  /** Patient name or ID, any linked guardian's name or mobile, or the patient's own mobile */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(PatientStatus)
  status?: PatientStatus;

  /** Patients interested in this therapy type */
  @IsOptional()
  @IsUUID()
  therapyTypeId?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  /** Registration dates in the center's time zone, both included */
  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  registeredFrom?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  registeredTo?: string;

  /** Defaults to registeredAt, newest first */
  @IsOptional()
  @IsIn(PATIENT_SORT_FIELDS)
  sortBy?: PatientSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/** When the date of birth isn't known. Stored as months, as of the day it's saved. */
export class ApproximateAgeDto {
  @IsInt({ message: 'Enter whole years' })
  @Min(0, { message: 'Age can’t be negative' })
  @Max(MAX_AGE_YEARS, { message: `Enter an age up to ${MAX_AGE_YEARS} years` })
  years!: number;

  @IsOptional()
  @IsInt({ message: 'Enter whole months' })
  @Min(0, { message: 'Enter 0 to 11 months' })
  @Max(11, { message: 'Enter 0 to 11 months' })
  months?: number;
}

/**
 * A guardian or caregiver's own details, shared by every patient they're linked to.
 * Each is required where a subclass's rules say so.
 */
class GuardianDetailFields {
  @IsOptional()
  @NormalizeAnyMobile()
  @IsAnyMobile()
  secondaryMobile?: string;

  @IsOptional()
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(LIMITS.address)
  address?: string;
}

/** What the conditional rules below look at; subclasses declare contactType. */
type Contact = ContactFields & { contactType: ContactType };

/**
 * A contact for a patient: the patient themselves (SELF, registration only), or a guardian
 * or caregiver, new or already on record (guardianId). With guardianId, the guardian's
 * own details are left as they are: they're changed through PATCH /guardians/:id, which
 * makes clear that every patient they're linked to sees the change.
 */
class ContactFields extends GuardianDetailFields {
  @ValidateIf((o: Contact) => o.contactType !== 'SELF')
  @IsOptional()
  @IsUUID('all', { message: 'Choose a guardian' })
  guardianId?: string;

  @ValidateIf((o: Contact) => o.contactType !== 'SELF' && !o.guardianId)
  @Trim()
  @IsString({ message: 'Contact name is required' })
  @IsNotEmpty({ message: 'Contact name is required' })
  @MaxLength(LIMITS.name)
  fullName?: string;

  @ValidateIf((o: Contact) => o.contactType === 'SELF' || !o.guardianId)
  @NormalizeAnyMobile()
  @IsString({ message: 'Mobile number is required' })
  @IsAnyMobile()
  mobile?: string;

  @ValidateIf((o: Contact) => o.contactType !== 'SELF')
  @IsEnum(GuardianRelationship, { message: 'Choose a relationship' })
  relationship?: GuardianRelationship;

  @ValidateIf(
    (o: Contact) =>
      o.contactType !== 'SELF' && o.relationship === GuardianRelationship.OTHER,
  )
  @Trim()
  @IsString({ message: 'Describe the relationship' })
  @IsNotEmpty({ message: 'Describe the relationship' })
  @MaxLength(60)
  customRelationship?: string;

  @IsOptional()
  @IsBoolean()
  isEmergencyContact?: boolean;
}

/** The one primary contact registration starts with. More can be added afterwards. */
export class RegistrationContactDto extends ContactFields {
  @IsIn(CONTACT_TYPES, { message: 'Choose who the contact is' })
  contactType!: ContactType;
}

/** Consent recorded at registration, given by the primary contact. */
export class RegistrationConsentDto {
  @IsEnum(ConsentPurpose, { message: 'Choose what consent is for' })
  purpose!: ConsentPurpose;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  version?: string;
}

/** Fields shared by registration and editing. */
class PatientProfileFields {
  /** Validated as a real, past calendar date by the service */
  @IsOptional()
  @EmptyToNull()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  dateOfBirth?: string | null;

  /** Only without a date of birth; null removes it */
  @IsOptional()
  @ValidateNested()
  @Type(() => ApproximateAgeDto)
  approximateAge?: ApproximateAgeDto | null;

  @IsOptional()
  @EmptyToNull()
  @IsEnum(Gender, { message: 'Choose a gender' })
  gender?: Gender | null;

  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(LIMITS.text)
  primaryConcern?: string | null;

  /** Replaces the patient's therapy interests */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(LIMITS.therapyInterests, {
    message: `Choose up to ${LIMITS.therapyInterests} therapy services`,
  })
  @ArrayUnique({ message: 'Each therapy service can only be added once' })
  @IsUUID('all', { each: true, message: 'Choose a therapy service' })
  therapyTypeIds?: string[];

  @IsOptional()
  @NormalizeUrl()
  @IsUrl(URL_OPTIONS, { message: 'Enter a web address for the photo' })
  @MaxLength(500)
  photoUrl?: string | null;

  /** Accepted only when the center types its own codes (CenterGeneralSettings) */
  @IsOptional()
  @NormalizeCode()
  @Matches(CODE, {
    message: 'Use up to 20 letters, numbers or dashes, e.g. P-0042',
  })
  code?: string;

  @IsOptional()
  @NormalizeOptionalPhone()
  @IsPhone({ message: 'Enter a valid phone number' })
  emergencyPhone?: string | null;

  @IsOptional()
  @EmptyToNull()
  @IsEnum(ReferralSource, { message: 'Choose a referral source' })
  referralSource?: ReferralSource | null;

  /** Required with referralSource OTHER (checked by the service), ignored otherwise */
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(100)
  referralOther?: string | null;

  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(LIMITS.text)
  internalNotes?: string | null;
}

export class CreatePatientDto extends PatientProfileFields {
  @Trim()
  @IsString({ message: 'Full name is required' })
  @IsNotEmpty({ message: 'Full name is required' })
  @MaxLength(LIMITS.name)
  fullName!: string;

  /** Defaults to the center's setting */
  @IsOptional()
  @IsIn([PatientStatus.NEW, PatientStatus.ACTIVE], {
    message: 'New patients start as new or active',
  })
  status?: PatientStatus;

  @ValidateNested()
  @Type(() => RegistrationContactDto)
  @IsNotEmpty({ message: 'Add the primary contact' })
  contact!: RegistrationContactDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RegistrationConsentDto)
  consents?: RegistrationConsentDto[];
}

/**
 * Send only what changed; an empty string or null clears an optional field. Status,
 * guardians and consents have their own endpoints. The patient's own contact details are
 * here: a self-managing patient's mobile can't be cleared while they're the primary contact.
 */
export class UpdatePatientDto extends PatientProfileFields {
  // Empty values become null (not undefined), so they're rejected rather than ignored.
  @IfPresent()
  @TrimOrNull()
  @IsString({ message: 'Full name is required' })
  @IsNotEmpty({ message: 'Full name is required' })
  @MaxLength(LIMITS.name)
  fullName?: string;

  @IsOptional()
  @NormalizeAnyMobile({ emptyAsNull: true })
  @IsAnyMobile()
  mobile?: string | null;

  @IsOptional()
  @NormalizeAnyMobile({ emptyAsNull: true })
  @IsAnyMobile()
  secondaryMobile?: string | null;

  @IsOptional()
  @NormalizeEmail({ clearable: true })
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(LIMITS.address)
  address?: string | null;
}

export class ChangePatientStatusDto {
  @IsIn([PatientStatus.ACTIVE, PatientStatus.INACTIVE], {
    message: 'Choose active or inactive',
  })
  status!: PatientStatus;
}

// ── Guardians ───────────────────────────────────────────────────────────────

export class SearchGuardiansQuery {
  /** A mobile number (at least 4 digits) or part of a name (at least 2 letters) */
  @Trim()
  @IsString({ message: 'Enter a mobile number or name' })
  @MinLength(2, { message: 'Enter at least 2 characters' })
  @MaxLength(100)
  q!: string;
}

/** Adds a guardian or caregiver to a patient, new or already on record. */
export class LinkGuardianDto extends ContactFields {
  @IsIn([GuardianContactType.GUARDIAN, GuardianContactType.CAREGIVER], {
    message: 'Choose guardian or caregiver',
  })
  contactType!: ContactType;

  /** Make them the patient's primary contact */
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

/** The relationship to this patient only; the guardian's own details are separate. */
export class UpdatePatientGuardianDto {
  @IfPresent()
  @IsEnum(GuardianContactType, { message: 'Choose guardian or caregiver' })
  contactType?: GuardianContactType;

  @IfPresent()
  @IsEnum(GuardianRelationship, { message: 'Choose a relationship' })
  relationship?: GuardianRelationship;

  /** Required with relationship OTHER, ignored otherwise */
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(60)
  customRelationship?: string | null;

  @IfPresent()
  @IsBoolean()
  isEmergencyContact?: boolean;
}

/** Changes every linked patient's copy, so the web app warns before sending it. */
export class UpdateGuardianDto {
  @IfPresent()
  @TrimOrNull()
  @IsString({ message: 'Contact name is required' })
  @IsNotEmpty({ message: 'Contact name is required' })
  @MaxLength(LIMITS.name)
  fullName?: string;

  @IfPresent()
  @NormalizeAnyMobile({ emptyAsNull: true })
  @IsString({ message: 'Mobile number is required' })
  @IsAnyMobile()
  mobile?: string;

  @IsOptional()
  @NormalizeAnyMobile({ emptyAsNull: true })
  @IsAnyMobile()
  secondaryMobile?: string | null;

  @IsOptional()
  @NormalizeEmail({ clearable: true })
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(LIMITS.address)
  address?: string | null;
}

/** Exactly one of: a guardian link of this patient, or the patient themselves. */
export class SetPrimaryContactDto {
  @ValidateIf((o: SetPrimaryContactDto) => o.self !== true)
  @IsUUID('all', { message: 'Choose a contact' })
  relationId?: string;

  @IsOptional()
  @IsIn([true], {
    message: 'Send self: true to make the patient their own contact',
  })
  self?: true;
}

// ── Consent ─────────────────────────────────────────────────────────────────

export class RecordConsentDto {
  @IsEnum(ConsentPurpose, { message: 'Choose what consent is for' })
  purpose!: ConsentPurpose;

  /** false records a refusal or withdrawal */
  @IsBoolean()
  granted!: boolean;

  @IsEnum(ConsentGivenBy, { message: 'Choose who gave consent' })
  givenBy!: ConsentGivenBy;

  /** A guardian currently linked to the patient; required when givenBy is GUARDIAN */
  @ValidateIf((o: RecordConsentDto) => o.givenBy === ConsentGivenBy.GUARDIAN)
  @IsUUID('all', { message: 'Choose who gave consent' })
  guardianId?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  version?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}
