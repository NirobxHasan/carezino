import { applyDecorators } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { IfPresent, Trim, TrimOrNull } from '../common/validation';
import {
  DateDisplayFormat,
  DefaultDurationBehavior,
  PatientStatus,
  TimeDisplayFormat,
} from '../generated/prisma/enums';
import { LIMITS } from './limits';

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const CLOCK_MESSAGE = 'Enter a time like 09:00';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Choose a date';

// ── Working hours ───────────────────────────────────────────────────────────

export class IntervalDto {
  @IsString({ message: CLOCK_MESSAGE })
  @Matches(CLOCK, { message: CLOCK_MESSAGE })
  start!: string;

  @IsString({ message: CLOCK_MESSAGE })
  @Matches(CLOCK, { message: CLOCK_MESSAGE })
  end!: string;
}

export class WorkingDayDto {
  /** 0 = Sunday … 6 = Saturday */
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  /** Empty for a closed day */
  @IsArray()
  @ArrayMaxSize(LIMITS.intervalsPerDay, {
    message: `Use at most ${LIMITS.intervalsPerDay} time ranges a day`,
  })
  @ValidateNested({ each: true })
  @Type(() => IntervalDto)
  intervals!: IntervalDto[];
}

/** The whole week: all seven days, each exactly once. Replaces what's stored. */
export class UpdateWorkingHoursDto {
  @IsArray()
  @ArrayMinSize(7, { message: 'Send all seven days' })
  @ArrayMaxSize(7, { message: 'Send all seven days' })
  @ValidateNested({ each: true })
  @Type(() => WorkingDayDto)
  days!: WorkingDayDto[];
}

// ── Closures ────────────────────────────────────────────────────────────────

export class ListClosuresQuery {
  /** upcoming: not yet over (includes ongoing); past: already over */
  @IsOptional()
  @IsIn(['upcoming', 'past'])
  period?: 'upcoming' | 'past';
}

export class CreateClosureDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MaxLength(120)
  title!: string;

  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  startDate!: string;

  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  endDate!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /** Defaults to true. Part-day closures cover a single date. */
  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  /** Required when allDay is false */
  @IsOptional()
  @Matches(CLOCK, { message: CLOCK_MESSAGE })
  startTime?: string;

  @IsOptional()
  @Matches(CLOCK, { message: CLOCK_MESSAGE })
  endTime?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateClosureDto {
  @IfPresent()
  @Trim()
  @IsString({ message: 'Title is required' })
  @IsNotEmpty({ message: 'Title is required' })
  @MaxLength(120)
  title?: string;

  @IfPresent()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  startDate?: string;

  @IfPresent()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  endDate?: string;

  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(500)
  reason?: string | null;

  @IfPresent()
  @IsBoolean()
  allDay?: boolean;

  @IsOptional()
  @Matches(CLOCK, { message: CLOCK_MESSAGE })
  startTime?: string | null;

  @IsOptional()
  @Matches(CLOCK, { message: CLOCK_MESSAGE })
  endTime?: string | null;

  @IfPresent()
  @IsBoolean()
  isActive?: boolean;
}

// ── Scheduling & general settings ───────────────────────────────────────────

/** A whole number within limits, with one message for every way it can be wrong. */
const Range = ({ min, max }: { min: number; max: number }, message: string) =>
  applyDecorators(
    IsInt({ message }),
    Min(min, { message }),
    Max(max, { message }),
  );

/** Every field is optional; send only what changed. */
export class UpdateSchedulingSettingsDto {
  @IfPresent()
  @IsIn(LIMITS.slotIntervalMinutes, {
    message: `Choose one of ${LIMITS.slotIntervalMinutes.join(', ')} minutes`,
  })
  slotIntervalMinutes?: number;

  @IfPresent()
  @Range(
    LIMITS.bookingBufferMinutes,
    `Enter 0 to ${LIMITS.bookingBufferMinutes.max} minutes`,
  )
  bookingBufferMinutes?: number;

  @IfPresent()
  @IsBoolean()
  allowCustomDuration?: boolean;

  @IfPresent()
  @IsBoolean()
  allowBookingOnClosedDays?: boolean;

  @IfPresent()
  @Range(
    LIMITS.advanceBookingLimitDays,
    `Enter 1 to ${LIMITS.advanceBookingLimitDays.max} days`,
  )
  advanceBookingLimitDays?: number;

  @IfPresent()
  @Range(
    LIMITS.minimumBookingNoticeMinutes,
    'Enter a notice period of up to 30 days',
  )
  minimumBookingNoticeMinutes?: number;

  @IfPresent()
  @IsBoolean()
  allowDoubleBooking?: boolean;

  @IfPresent()
  @IsBoolean()
  allowPastDateBooking?: boolean;

  @IfPresent()
  @Range(LIMITS.cancellationCutoffMinutes, 'Enter a cutoff of up to 30 days')
  cancellationCutoffMinutes?: number;
}

/** New patients start as active or on the waitlist; other statuses come later. */
export const NEW_PATIENT_STATUSES = [
  PatientStatus.ACTIVE,
  PatientStatus.WAITLIST,
] as const;

export class UpdateGeneralSettingsDto {
  @IfPresent()
  @IsEnum(DefaultDurationBehavior, { message: 'Choose how durations are set' })
  defaultDurationBehavior?: DefaultDurationBehavior;

  @IfPresent()
  @IsBoolean()
  autoGeneratePatientCode?: boolean;

  /** e.g. "P-". Send an empty string or null to remove it. Stored upper-cased. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim().toUpperCase();
    return trimmed === '' ? null : trimmed;
  })
  @Matches(/^[A-Z0-9][A-Z0-9-]{0,7}$/, {
    message: 'Use up to 8 letters, numbers or dashes, e.g. P-',
  })
  patientCodePrefix?: string | null;

  @IfPresent()
  @IsIn(NEW_PATIENT_STATUSES, {
    message: 'New patients can start as active or on the waitlist',
  })
  defaultPatientStatus?: PatientStatus;

  @IfPresent()
  @IsEnum(DateDisplayFormat, { message: 'Choose a date format' })
  dateFormat?: DateDisplayFormat;

  @IfPresent()
  @IsEnum(TimeDisplayFormat, { message: 'Choose 12-hour or 24-hour time' })
  timeFormat?: TimeDisplayFormat;

  @IfPresent()
  @IsInt({ message: 'Choose a day' })
  @Min(0, { message: 'Choose a day' })
  @Max(6, { message: 'Choose a day' })
  weekStartsOn?: number;
}
