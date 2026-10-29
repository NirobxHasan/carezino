import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import {
  CommaList,
  EmptyToNull,
  IfPresent,
  Money,
  Trim,
  TrimOrNull,
  applyAll,
} from '../common/validation';
import {
  AppointmentType,
  PackageActivationPolicy,
  PackageDiscountType,
  PackagePeriodUnit,
} from '../generated/prisma/enums';
import {
  ENROLLMENT_STATUSES,
  PACKAGE_LIMITS,
  type EnrollmentStatus,
} from './rules';

const L = PACKAGE_LIMITS;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Choose a date';
const UNIT_MESSAGE = 'Choose days, weeks or months';

const Text = (max: number, message?: string) =>
  applyAll([
    Trim(),
    IsString({ message }),
    MinLength(1, { message }),
    MaxLength(max, { message: `Use up to ${max} characters` }),
  ]);

const OptionalText = (max: number) =>
  applyAll([
    IsOptional(),
    TrimOrNull(),
    IsString(),
    MaxLength(max, { message: `Use up to ${max} characters` }),
  ]);

const Int = (min: number, max: number, message: string) =>
  applyAll([
    Type(() => Number),
    IsInt({ message }),
    Min(min, { message }),
    Max(max, { message }),
  ]);

const Reason = (message: string) =>
  applyAll([
    Trim(),
    IsString({ message }),
    MinLength(L.reason.min, { message }),
    MaxLength(L.reason.max, {
      message: `Use up to ${L.reason.max} characters`,
    }),
  ]);

const Paging = () => [
  applyAll([IsOptional(), Type(() => Number), IsInt(), Min(1)]),
  applyAll([IsOptional(), Type(() => Number), IsInt(), Min(1), Max(100)]),
];
const [Page, PageSize] = Paging();

// ── Catalog ─────────────────────────────────────────────────────────────────

const SESSIONS_MESSAGE = `Enter ${L.sessionCount.min} to ${L.sessionCount.max} sessions`;
const DURATION_MESSAGE = 'Enter 5 to 480 minutes';
const LIMIT_MESSAGE = `Enter ${L.usageLimitCount.min} to ${L.usageLimitCount.max} sessions`;

export class CreatePackageDto {
  @Text(L.name, 'Package name is required')
  name!: string;

  /** Generated (PKG-0001) when left out; stored upper-cased */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(L.code, { message: `Use up to ${L.code} characters` })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, {
    message: 'Use letters, numbers, dashes and underscores',
  })
  code?: string;

  @OptionalText(L.description)
  description?: string | null;

  @IsArray({ message: 'Choose at least one therapy' })
  @ArrayMinSize(1, { message: 'Choose at least one therapy' })
  @ArrayMaxSize(L.therapyTypes)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  therapyTypeIds!: string[];

  @Int(L.sessionCount.min, L.sessionCount.max, SESSIONS_MESSAGE)
  sessionCount!: number;

  @IsOptional()
  @EmptyToNull()
  @Int(5, 480, DURATION_MESSAGE)
  defaultDurationMinutes?: number | null;

  @Money()
  price!: string;

  @Int(1, L.validity.DAY, 'Enter how long it’s valid for')
  validityValue!: number;

  @IsEnum(PackagePeriodUnit, { message: UNIT_MESSAGE })
  validityUnit!: PackagePeriodUnit;

  @IsOptional()
  @IsEnum(PackageActivationPolicy, { message: 'Choose when validity starts' })
  activationPolicy?: PackageActivationPolicy;

  /** Both or neither: at most this many sessions per period */
  @IsOptional()
  @EmptyToNull()
  @Int(L.usageLimitCount.min, L.usageLimitCount.max, LIMIT_MESSAGE)
  usageLimitCount?: number | null;

  @IsOptional()
  @EmptyToNull()
  @IsEnum(PackagePeriodUnit, { message: 'Choose day, week or month' })
  usageLimitPeriod?: PackagePeriodUnit | null;

  @IsOptional()
  @IsBoolean()
  coversAssessments?: boolean;

  @IsOptional()
  @IsBoolean()
  chargeNoShow?: boolean;

  @IsOptional()
  @IsBoolean()
  chargeLateCancellation?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Int(0, 9999, 'Enter 0 to 9999')
  displayOrder?: number;
}

/** Any of the package's fields. Existing enrollments keep their own terms. */
export class UpdatePackageDto {
  @IfPresent()
  @Text(L.name, 'Package name is required')
  name?: string;

  @IfPresent()
  @Trim()
  @IsString({ message: 'Package code is required' })
  @MinLength(1, { message: 'Package code is required' })
  @MaxLength(L.code, { message: `Use up to ${L.code} characters` })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, {
    message: 'Use letters, numbers, dashes and underscores',
  })
  code?: string;

  @OptionalText(L.description)
  description?: string | null;

  @IfPresent()
  @IsArray({ message: 'Choose at least one therapy' })
  @ArrayMinSize(1, { message: 'Choose at least one therapy' })
  @ArrayMaxSize(L.therapyTypes)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  therapyTypeIds?: string[];

  @IfPresent()
  @Int(L.sessionCount.min, L.sessionCount.max, SESSIONS_MESSAGE)
  sessionCount?: number;

  @IsOptional()
  @EmptyToNull()
  @Int(5, 480, DURATION_MESSAGE)
  defaultDurationMinutes?: number | null;

  @IfPresent()
  @Money()
  price?: string;

  @IfPresent()
  @Int(1, L.validity.DAY, 'Enter how long it’s valid for')
  validityValue?: number;

  @IfPresent()
  @IsEnum(PackagePeriodUnit, { message: UNIT_MESSAGE })
  validityUnit?: PackagePeriodUnit;

  @IfPresent()
  @IsEnum(PackageActivationPolicy, { message: 'Choose when validity starts' })
  activationPolicy?: PackageActivationPolicy;

  @IsOptional()
  @EmptyToNull()
  @Int(L.usageLimitCount.min, L.usageLimitCount.max, LIMIT_MESSAGE)
  usageLimitCount?: number | null;

  @IsOptional()
  @EmptyToNull()
  @IsEnum(PackagePeriodUnit, { message: 'Choose day, week or month' })
  usageLimitPeriod?: PackagePeriodUnit | null;

  @IfPresent()
  @IsBoolean()
  coversAssessments?: boolean;

  @IfPresent()
  @IsBoolean()
  chargeNoShow?: boolean;

  @IfPresent()
  @IsBoolean()
  chargeLateCancellation?: boolean;

  @IfPresent()
  @Int(0, 9999, 'Enter 0 to 9999')
  displayOrder?: number;
}

export class PackageStatusDto {
  @IsBoolean()
  isActive!: boolean;
}

export const PACKAGE_SORTS = [
  'displayOrder',
  'name',
  'price',
  'createdAt',
] as const;
export type PackageSort = (typeof PACKAGE_SORTS)[number];

export class ListPackagesQuery {
  /** Name or code */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsUUID()
  therapyTypeId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'all'])
  status?: 'ACTIVE' | 'INACTIVE' | 'all';

  @IsOptional()
  @IsIn(PACKAGE_SORTS)
  sortBy?: PackageSort;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @Page
  page?: number;

  @PageSize
  pageSize?: number;
}

// ── Enrollments ─────────────────────────────────────────────────────────────

/** The terms of a purchase; shared by enrolling and renewing. */
class EnrollmentTermsDto {
  /** The same purchase sent twice (e.g. a double click) is recorded once */
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsOptional()
  @EmptyToNull()
  @IsUUID('all', { message: 'Choose a therapy plan' })
  therapyPlanId?: string | null;

  /** Default: the package's */
  @IsOptional()
  @IsEnum(PackageActivationPolicy, { message: 'Choose when validity starts' })
  activationPolicy?: PackageActivationPolicy;

  /** Required for FIXED_DATE; center-local */
  @ValidateIf(
    (o: EnrollmentTermsDto) =>
      o.activationPolicy === PackageActivationPolicy.FIXED_DATE ||
      o.startDate !== undefined,
  )
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  startDate?: string;

  /** A different last day than the validity gives. Needs package_enrollments.override_terms. */
  @IsOptional()
  @EmptyToNull()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  endDate?: string | null;

  /** A different number of sessions. Needs package_enrollments.override_terms. */
  @IsOptional()
  @Int(L.sessionCount.min, L.sessionCount.max, SESSIONS_MESSAGE)
  sessionCount?: number;

  /** Anything but NONE needs package_enrollments.override_terms */
  @IsOptional()
  @IsEnum(PackageDiscountType, { message: 'Choose a discount type' })
  discountType?: PackageDiscountType;

  /** FIXED: the amount off. PERCENTAGE: the percentage off. */
  @IsOptional()
  @EmptyToNull()
  @Money('Enter the discount, e.g. 500 or 12.5')
  discountValue?: string | null;

  /** PRICE_OVERRIDE: the agreed price */
  @IsOptional()
  @EmptyToNull()
  @Money()
  agreedPrice?: string | null;

  @OptionalText(L.notes)
  notes?: string | null;
}

export class CreateEnrollmentDto extends EnrollmentTermsDto {
  @IsUUID('all', { message: 'Choose a patient' })
  patientId!: string;

  @IsUUID('all', { message: 'Choose a package' })
  packageId!: string;
}

/** A new purchase for the same patient; the package defaults to the renewed one's. */
export class RenewEnrollmentDto extends EnrollmentTermsDto {
  @IsOptional()
  @IsUUID('all', { message: 'Choose a package' })
  packageId?: string;
}

export class CancelEnrollmentDto {
  @Reason('Say why it’s cancelled (at least 3 characters)')
  reason!: string;
}

export const ADJUSTMENT_TYPES = [
  'BONUS_CREDIT',
  'MANUAL_CREDIT',
  'MANUAL_DEBIT',
  'CONSUMPTION_REVERSAL',
] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export class AdjustEnrollmentDto {
  @IsIn(ADJUSTMENT_TYPES, { message: 'Choose an adjustment' })
  type!: AdjustmentType;

  /** Sessions to add or remove; a reversal always restores one */
  @ValidateIf((o: AdjustEnrollmentDto) => o.type !== 'CONSUMPTION_REVERSAL')
  @Int(
    L.adjustment.min,
    L.adjustment.max,
    `Enter ${L.adjustment.min} to ${L.adjustment.max} sessions`,
  )
  quantity?: number;

  /** The SESSION_CONSUMPTION entry to reverse */
  @ValidateIf((o: AdjustEnrollmentDto) => o.type === 'CONSUMPTION_REVERSAL')
  @IsUUID('all', { message: 'Choose the session to reverse' })
  consumptionId?: string;

  @Reason('Say why (at least 3 characters)')
  reason!: string;

  /** The same adjustment sent twice is recorded once */
  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export const ENROLLMENT_SORTS = [
  'createdAt',
  'endDate',
  'patientName',
] as const;
export type EnrollmentSort = (typeof ENROLLMENT_SORTS)[number];

export class ListEnrollmentsQuery {
  /** Patient name or ID, guardian mobile, package name or enrollment ID */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  packageId?: string;

  @IsOptional()
  @IsUUID()
  therapyTypeId?: string;

  @IsOptional()
  @CommaList()
  @IsArray()
  @IsIn(ENROLLMENT_STATUSES, { each: true })
  status?: EnrollmentStatus[];

  /** Active and ending within the next PACKAGE_LIMITS.expiringSoonDays days */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  expiringSoon?: boolean;

  /** Start dates, both included */
  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  startFrom?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  startTo?: string;

  /** End dates, both included */
  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  endFrom?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  endTo?: string;

  @IsOptional()
  @IsIn(ENROLLMENT_SORTS)
  sortBy?: EnrollmentSort;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @Page
  page?: number;

  @PageSize
  pageSize?: number;
}

/** A patient's packages and whether each can pay for a session, for booking screens. */
export class EnrollmentOptionsQuery {
  @IsUUID('all', { message: 'Choose a patient' })
  patientId!: string;

  @IsOptional()
  @IsUUID()
  therapyTypeId?: string;

  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  /** The session's center-local date; default today */
  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  date?: string;

  /** An appointment being changed, whose own held session doesn't count against it */
  @IsOptional()
  @IsUUID()
  appointmentId?: string;
}
