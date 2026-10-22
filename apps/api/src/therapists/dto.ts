import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';

import { IntervalDto } from '../center-settings/dto';
import { LIMITS } from '../center-settings/limits';
import {
  EmptyToNull,
  IfPresent,
  IsAnyMobile,
  NormalizeAnyMobile,
  NormalizeEmail,
  NormalizeUrl,
  Trim,
  TrimOrNull,
  URL_OPTIONS,
} from '../common/validation';
import {
  EmploymentType,
  Gender,
  TherapistStatus,
  TimeOffReason,
} from '../generated/prisma/enums';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Choose a date';
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const CLOCK_MESSAGE = 'Enter a time like 09:00';
const { min: minYears, max: maxYears } = LIMITS.yearsOfExperience;
const YEARS_MESSAGE = `Enter whole years from ${minYears} to ${maxYears}`;

export const THERAPIST_SORT_FIELDS = [
  'fullName',
  'code',
  'joiningDate',
  'createdAt',
] as const;
export type TherapistSortField = (typeof THERAPIST_SORT_FIELDS)[number];

export class ListTherapistsQuery {
  /** Name, therapist ID, mobile or email */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(TherapistStatus)
  status?: TherapistStatus;

  /** Therapists who offer this therapy type */
  @IsOptional()
  @IsUUID()
  therapyTypeId?: string;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  joinedFrom?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  joinedTo?: string;

  @IsOptional()
  @IsIn(THERAPIST_SORT_FIELDS)
  sortBy?: TherapistSortField;

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

/** The therapy types a therapist provides. Replaces the current set. */
export class SpecializationsDto {
  @IsArray()
  @ArrayMaxSize(LIMITS.specializationsPerTherapist, {
    message: `Choose up to ${LIMITS.specializationsPerTherapist} therapy types`,
  })
  @ArrayUnique({ message: 'Each therapy type can only be added once' })
  @IsUUID('all', { each: true, message: 'Choose a therapy type' })
  therapyTypeIds!: string[];

  /** Must be one of therapyTypeIds. Defaults to the current primary, else the first. */
  @IsOptional()
  @IsUUID('all', { message: 'Choose a therapy type' })
  primaryTherapyTypeId?: string;
}

export class AvailabilityDayDto {
  /** 0 = Sunday … 6 = Saturday */
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  /** Off days keep their intervals, so switching the day back on restores them */
  @IsBoolean()
  isAvailable!: boolean;

  @IsArray()
  @ArrayMaxSize(LIMITS.intervalsPerDay, {
    message: `Use at most ${LIMITS.intervalsPerDay} time ranges a day`,
  })
  @ValidateNested({ each: true })
  @Type(() => IntervalDto)
  intervals!: IntervalDto[];
}

/** The whole week: all seven days, each exactly once. Replaces what's stored. */
export class UpdateAvailabilityDto {
  @IsArray()
  @ArrayMinSize(7, { message: 'Send all seven days' })
  @ArrayMaxSize(7, { message: 'Send all seven days' })
  @ValidateNested({ each: true })
  @Type(() => AvailabilityDayDto)
  days!: AvailabilityDayDto[];
}

/** Profile fields shared by create and update. */
class TherapistProfileFields {
  @IsOptional()
  @NormalizeEmail({ clearable: true })
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @EmptyToNull()
  @IsEnum(Gender, { message: 'Choose a gender' })
  gender?: Gender | null;

  @IsOptional()
  @NormalizeUrl()
  @IsUrl(URL_OPTIONS, { message: 'Enter a web address for the photo' })
  @MaxLength(500)
  photoUrl?: string | null;

  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(100)
  designation?: string | null;

  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(1000)
  qualifications?: string | null;

  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(60)
  registrationNumber?: string | null;

  @IsOptional()
  @EmptyToNull()
  @IsInt({ message: YEARS_MESSAGE })
  @Min(minYears, { message: 'Experience can’t be negative' })
  @Max(maxYears, { message: YEARS_MESSAGE })
  yearsOfExperience?: number | null;

  /** Validated as a real calendar date by the service */
  @IsOptional()
  @EmptyToNull()
  @Matches(ISO_DATE, { message: 'Choose a valid date' })
  joiningDate?: string | null;

  @IsOptional()
  @EmptyToNull()
  @IsEnum(EmploymentType, { message: 'Choose an employment type' })
  employmentType?: EmploymentType | null;

  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  /** A staff membership of this center to link, or null to unlink */
  @IsOptional()
  @IsUUID('all', { message: 'Choose a staff member' })
  membershipId?: string | null;
}

export class CreateTherapistDto extends TherapistProfileFields {
  @Trim()
  @IsString({ message: 'Full name is required' })
  @IsNotEmpty({ message: 'Full name is required' })
  @MaxLength(120)
  fullName!: string;

  @NormalizeAnyMobile()
  @IsString({ message: 'Mobile number is required' })
  @IsAnyMobile()
  mobile!: string;

  @IsOptional()
  @IsEnum(TherapistStatus, { message: 'Choose active or inactive' })
  status?: TherapistStatus;

  @IsOptional()
  @ValidateNested()
  @Type(() => SpecializationsDto)
  specializations?: SpecializationsDto;

  /** Optional at onboarding: the weekly hours can be set up afterwards */
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAvailabilityDto)
  availability?: UpdateAvailabilityDto;
}

/**
 * Send only what changed; an empty string or null clears an optional field. The therapist
 * ID can't change, and status has its own endpoint.
 */
export class UpdateTherapistDto extends TherapistProfileFields {
  // Empty values become null (not undefined), so they're rejected rather than ignored.
  @IfPresent()
  @TrimOrNull()
  @IsString({ message: 'Full name is required' })
  @IsNotEmpty({ message: 'Full name is required' })
  @MaxLength(120)
  fullName?: string;

  @IfPresent()
  @NormalizeAnyMobile({ emptyAsNull: true })
  @IsString({ message: 'Mobile number is required' })
  @IsAnyMobile()
  mobile?: string;
}

export class ChangeTherapistStatusDto {
  @IsEnum(TherapistStatus, { message: 'Choose active or inactive' })
  status!: TherapistStatus;
}

export class ListTimeOffQuery {
  /** upcoming: not over yet (includes ongoing); past: already over */
  @IsOptional()
  @IsIn(['upcoming', 'past'])
  period?: 'upcoming' | 'past';
}

/**
 * Dates and times are wall-clock values in the center's time zone. All-day entries cover
 * startDate to endDate inclusive; otherwise startDate startTime → endDate endTime.
 */
export class CreateTimeOffDto {
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  startDate!: string;

  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  endDate!: string;

  /** Defaults to true */
  @IsOptional()
  @IsBoolean()
  isAllDay?: boolean;

  /** Required unless all day */
  @IsOptional()
  @Matches(CLOCK, { message: CLOCK_MESSAGE })
  startTime?: string;

  @IsOptional()
  @Matches(CLOCK, { message: CLOCK_MESSAGE })
  endTime?: string;

  @IsOptional()
  @EmptyToNull()
  @IsEnum(TimeOffReason, { message: 'Choose a reason' })
  reason?: TimeOffReason | null;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateTimeOffDto {
  @IfPresent()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  startDate?: string;

  @IfPresent()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  endDate?: string;

  @IfPresent()
  @IsBoolean()
  isAllDay?: boolean;

  @IsOptional()
  @Matches(CLOCK, { message: CLOCK_MESSAGE })
  startTime?: string | null;

  @IsOptional()
  @Matches(CLOCK, { message: CLOCK_MESSAGE })
  endTime?: string | null;

  @IsOptional()
  @EmptyToNull()
  @IsEnum(TimeOffReason, { message: 'Choose a reason' })
  reason?: TimeOffReason | null;

  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class ScheduleQuery {
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  startDate!: string;

  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  endDate!: string;
}
