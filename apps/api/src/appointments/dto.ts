import { applyDecorators } from '@nestjs/common';
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { LIMITS } from '../center-settings/limits';
import { Trim, TrimOrNull } from '../common/validation';
import {
  AppointmentStatus,
  AppointmentType,
  CancellationReason,
} from '../generated/prisma/enums';
import { FREQUENCIES, type Frequency } from './recurrence';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Choose a date';
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const CLOCK_MESSAGE = 'Choose a time';
const { min: minDuration, max: maxDuration } = LIMITS.durationMinutes;
const DURATION_MESSAGE = `Choose a length from ${minDuration} to ${maxDuration} minutes`;
export const NOTE_MAX = 2000;
const REASON_MAX = 500;

/** "SCHEDULED,CONFIRMED" or ?status=SCHEDULED&status=CONFIRMED → an array */
const CommaList = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.split(',').filter(Boolean)
      : Array.isArray(value)
        ? value.flatMap((v) => String(v).split(',')).filter(Boolean)
        : value,
  );

/** Session length in minutes, with one message for every way it can be wrong. */
const Duration = () =>
  applyDecorators(
    Type(() => Number),
    IsInt({ message: DURATION_MESSAGE }),
    Min(minDuration, { message: DURATION_MESSAGE }),
    Max(maxDuration, { message: DURATION_MESSAGE }),
  );

export class AvailableSlotsQuery {
  @IsUUID('all', { message: 'Choose a therapist' })
  therapistId!: string;

  @IsUUID('all', { message: 'Choose a therapy' })
  therapyTypeId!: string;

  /** Center-local date */
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  date!: string;

  @Duration()
  durationMinutes!: number;

  /** Also avoid this patient's other appointments */
  @IsOptional()
  @IsUUID()
  patientId?: string;

  /** The appointment being rescheduled, whose own time counts as free */
  @IsOptional()
  @IsUUID()
  excludeAppointmentId?: string;
}

/** Who and what is booked; shared by single and recurring bookings. */
class BookingFields {
  @IsUUID('all', { message: 'Choose a patient' })
  patientId!: string;

  @IsEnum(AppointmentType, { message: 'Choose assessment or therapy session' })
  type!: AppointmentType;

  @IsUUID('all', { message: 'Choose a therapy' })
  therapyTypeId!: string;

  @IsUUID('all', { message: 'Choose a therapist' })
  therapistId!: string;

  @Duration()
  durationMinutes!: number;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(NOTE_MAX, { message: `Use up to ${NOTE_MAX} characters` })
  internalNotes?: string;

  /**
   * Book over clashes with other appointments. Only honoured when the center allows
   * double booking, and only for clashes: every other rule still applies.
   */
  @IsOptional()
  @IsBoolean()
  allowOverlap?: boolean;

  /**
   * The patient's package enrollment that pays for it: one session is held per
   * appointment. Needs package_enrollments.read. Without it nothing is held.
   */
  @IsOptional()
  @IsUUID('all', { message: 'Choose a package' })
  packageEnrollmentId?: string;
}

export class CreateAppointmentDto extends BookingFields {
  /** Center-local date and start time */
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  date!: string;

  @Matches(CLOCK, { message: CLOCK_MESSAGE })
  startTime!: string;
}

/** A new time, and optionally a new therapist, length or therapy, for one appointment. */
export class RescheduleAppointmentDto {
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  date!: string;

  @Matches(CLOCK, { message: CLOCK_MESSAGE })
  startTime!: string;

  @IsOptional()
  @Duration()
  durationMinutes?: number;

  @IsOptional()
  @IsUUID('all', { message: 'Choose a therapist' })
  therapistId?: string;

  /** Needs appointments.update as well */
  @IsOptional()
  @IsUUID('all', { message: 'Choose a therapy' })
  therapyTypeId?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(REASON_MAX, { message: `Use up to ${REASON_MAX} characters` })
  reason?: string;

  @IsOptional()
  @IsBoolean()
  allowOverlap?: boolean;

  /**
   * Left out: the appointment keeps its package, which must still cover the new time.
   * null: taken off its package. An ID: moved to that package.
   */
  @IsOptional()
  @IsUUID('all', { message: 'Choose a package' })
  packageEnrollmentId?: string | null;
}

/** Which package pays for an open appointment; null takes it off its package. */
export class ChangeAppointmentPackageDto {
  @ValidateIf(
    (o: ChangeAppointmentPackageDto) => o.packageEnrollmentId !== null,
  )
  @IsUUID('all', { message: 'Choose a package' })
  packageEnrollmentId!: string | null;
}

export class CancelAppointmentDto {
  @IsEnum(CancellationReason, { message: 'Choose a reason' })
  reason!: CancellationReason;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(REASON_MAX, { message: `Use up to ${REASON_MAX} characters` })
  note?: string;
}

/** Cancelling has its own endpoint, which records why. */
export const STATUS_CHANGES = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.COMPLETED,
  AppointmentStatus.NO_SHOW,
] as const;

export class ChangeAppointmentStatusDto {
  @IsIn(STATUS_CHANGES, { message: 'Choose confirmed, completed or no-show' })
  status!: (typeof STATUS_CHANGES)[number];

  /** COMPLETED only: the patient's attendance, when it isn't marked yet */
  @IsOptional()
  @IsIn(['PRESENT', 'LATE'], { message: 'Choose present or late' })
  attendance?: 'PRESENT' | 'LATE';
}

export class UpdateAppointmentDto {
  @IsOptional()
  @IsEnum(AppointmentType, { message: 'Choose assessment or therapy session' })
  type?: AppointmentType;

  /** An empty string clears it */
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(NOTE_MAX, { message: `Use up to ${NOTE_MAX} characters` })
  internalNotes?: string | null;
}

class AppointmentFilters {
  @IsOptional()
  @IsUUID()
  therapistId?: string;

  @IsOptional()
  @IsUUID()
  therapyTypeId?: string;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  @IsOptional()
  @CommaList()
  @IsArray()
  @IsEnum(AppointmentStatus, { each: true })
  status?: AppointmentStatus[];
}

export class ListAppointmentsQuery extends AppointmentFilters {
  /** Patient name or ID, the primary contact's mobile, or the therapist's name */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Center-local dates, both included */
  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  to?: string;

  /** upcoming: starting from now on; past: started before now */
  @IsOptional()
  @IsIn(['upcoming', 'past'])
  timeframe?: 'upcoming' | 'past';

  /** By start time */
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

export class CalendarQuery extends AppointmentFilters {
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  startDate!: string;

  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  endDate!: string;
}

export class RecurrenceDto {
  @IsIn(FREQUENCIES, { message: 'Choose daily, weekly or monthly' })
  frequency!: Frequency;

  @Type(() => Number)
  @IsInt({ message: 'Enter a whole number' })
  @Min(LIMITS.seriesInterval.min, { message: 'Repeat at least every 1' })
  @Max(LIMITS.seriesInterval.max, {
    message: `Repeat at most every ${LIMITS.seriesInterval.max}`,
  })
  interval!: number;

  /** Weekly only: 0 = Sunday … 6 = Saturday */
  @ValidateIf((o: RecurrenceDto) => o.frequency === 'WEEKLY')
  @IsArray({ message: 'Choose at least one day' })
  @ArrayMinSize(1, { message: 'Choose at least one day' })
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  /** Center-local date of the first possible occurrence */
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  startDate!: string;

  @IsIn(['UNTIL', 'COUNT'], { message: 'Choose how the series ends' })
  endType!: 'UNTIL' | 'COUNT';

  /** Last possible date, included */
  @ValidateIf((o: RecurrenceDto) => o.endType === 'UNTIL')
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  until?: string;

  @ValidateIf((o: RecurrenceDto) => o.endType === 'COUNT')
  @Type(() => Number)
  @IsInt({ message: 'Enter a whole number' })
  @Min(1, { message: 'Book at least 1 session' })
  @Max(LIMITS.seriesOccurrences, {
    message: `Book up to ${LIMITS.seriesOccurrences} sessions at a time`,
  })
  count?: number;
}

export class SeriesDto extends BookingFields {
  /** Center-local start time of every occurrence */
  @Matches(CLOCK, { message: CLOCK_MESSAGE })
  startTime!: string;

  @ValidateNested()
  @Type(() => RecurrenceDto)
  recurrence!: RecurrenceDto;
}

export class CreateSeriesDto extends SeriesDto {
  /**
   * False (default): all or nothing, any conflict rejects the booking. True: book the
   * dates that are free and record the others as skipped.
   */
  @IsOptional()
  @IsBoolean()
  skipConflicts?: boolean;
}

export class CancelSeriesDto extends CancelAppointmentDto {
  /** Cancel this appointment of the series and every later open one; default: from now */
  @IsOptional()
  @IsUUID()
  fromAppointmentId?: string;
}
