import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { EmptyToNull, Trim, TrimOrNull } from '../common/validation';
import {
  AppointmentStatus,
  AppointmentType,
  AttendanceStatus,
  SessionNoteTemplateStatus,
  TherapyGoalStatus,
  TherapySessionStatus,
} from '../generated/prisma/enums';
import { NOTE_STATES, type NoteState } from './rules';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Choose a date';
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = 'Enter a time, e.g. 10:30';

export const SESSION_LIMITS = {
  attendanceNote: 1000,
  reason: { min: 5, max: 1000 },
  goals: 30,
  observation: 5000,
  templatesPerCenter: 200,
  templateName: 120,
  templateDescription: 1000,
} as const;

/** "DRAFT,COMPLETED" or ?status=DRAFT&status=COMPLETED → an array */
const CommaList = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.split(',').filter(Boolean)
      : Array.isArray(value)
        ? value.flatMap((v) => String(v).split(',')).filter(Boolean)
        : value,
  );

const Reason = (message: string) => {
  const { min, max } = SESSION_LIMITS.reason;
  return (target: object, key: string) => {
    Trim()(target, key);
    IsString({ message })(target, key);
    MinLength(min, { message })(target, key);
    MaxLength(max, { message: `Use up to ${max} characters` })(target, key);
  };
};

// ── Lists ───────────────────────────────────────────────────────────────────

class SessionFilters {
  /** Patient name or ID, the primary contact's mobile, or the therapist's name */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

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

  /** The appointment's status */
  @IsOptional()
  @CommaList()
  @IsArray()
  @IsEnum(AppointmentStatus, { each: true })
  status?: AppointmentStatus[];

  @IsOptional()
  @CommaList()
  @IsArray()
  @IsEnum(AttendanceStatus, { each: true })
  attendance?: AttendanceStatus[];

  @IsOptional()
  @CommaList()
  @IsArray()
  @IsEnum(TherapySessionStatus, { each: true })
  sessionStatus?: TherapySessionStatus[];

  /** NONE: no note started. PENDING: completed sessions whose note isn't signed off. */
  @IsOptional()
  @CommaList()
  @IsArray()
  @IsIn([...NOTE_STATES, 'PENDING'], { each: true })
  noteStatus?: (NoteState | 'PENDING')[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

/** One day's sessions, for the front desk. */
export class TodaySessionsQuery extends SessionFilters {
  /** Center-local date; today when left out */
  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  date?: string;
}

export class ListSessionsQuery extends SessionFilters {
  /** Center-local dates, both included */
  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  to?: string;

  /** By start time; newest first by default */
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class PatientSessionsQuery {
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

// ── Attendance ──────────────────────────────────────────────────────────────

/**
 * A center-local "HH:mm" on the appointment's date, or null to clear it; left out keeps
 * what's recorded.
 */
const OptionalClock = () => (target: object, key: string) => {
  IsOptional()(target, key);
  EmptyToNull()(target, key);
  ValidateIf((_: unknown, v: unknown) => v !== null)(target, key);
  Matches(CLOCK, { message: TIME_MESSAGE })(target, key);
};

export class CheckInDto {
  /** Arrived late: recorded as LATE instead of PRESENT */
  @IsOptional()
  @IsBoolean()
  late?: boolean;
}

export class RecordAttendanceDto {
  @IsEnum(AttendanceStatus, {
    message: 'Choose present, late, absent or not marked',
  })
  status!: AttendanceStatus;

  /** When the patient arrived */
  @OptionalClock()
  checkInTime?: string | null;

  @OptionalClock()
  actualStartTime?: string | null;

  @OptionalClock()
  actualEndTime?: string | null;

  /** Empty clears it */
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(SESSION_LIMITS.attendanceNote, {
    message: `Use up to ${SESSION_LIMITS.attendanceNote} characters`,
  })
  note?: string | null;

  /** Required when the appointment has closed (a correction) */
  @IsOptional()
  @Trim()
  @IsString({ message: 'Say why the attendance is being corrected' })
  @MinLength(SESSION_LIMITS.reason.min, {
    message: 'Say why the attendance is being corrected',
  })
  @MaxLength(SESSION_LIMITS.reason.max, {
    message: `Use up to ${SESSION_LIMITS.reason.max} characters`,
  })
  reason?: string;

  /** The attendance revision the change was made from; a stale one is refused */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  revision?: number;
}

// ── Sessions ────────────────────────────────────────────────────────────────

export const ATTENDED_CHOICES = [
  AttendanceStatus.PRESENT,
  AttendanceStatus.LATE,
] as const;

export class CompleteSessionDto {
  /** Records attendance first, when it isn't marked yet */
  @IsOptional()
  @IsIn(ATTENDED_CHOICES, { message: 'Choose present or late' })
  attendance?: (typeof ATTENDED_CHOICES)[number];
}

export const CORRECTION_OUTCOMES = ['NOT_ATTENDED', 'NOT_DELIVERED'] as const;
export type CorrectionOutcome = (typeof CORRECTION_OUTCOMES)[number];

export class CorrectSessionDto {
  /**
   * NOT_ATTENDED: the patient didn't come (the appointment becomes a no-show).
   * NOT_DELIVERED: the session didn't take place (the appointment is cancelled).
   */
  @IsIn(CORRECTION_OUTCOMES, {
    message: 'Choose what actually happened',
  })
  outcome!: CorrectionOutcome;

  @Reason('Say why the session is being corrected')
  reason!: string;
}

// ── Notes ───────────────────────────────────────────────────────────────────

export class GoalEntryDto {
  @IsUUID('all', { message: 'Choose a goal' })
  goalId!: string;

  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(SESSION_LIMITS.observation, {
    message: `Use up to ${SESSION_LIMITS.observation} characters`,
  })
  observation?: string | null;

  /** In the goal's own unit; checked against its measurement */
  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({}, { message: 'Enter a number' })
  measuredValue?: number | null;

  /** The clinician's judgement; it becomes the goal's status */
  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(TherapyGoalStatus, { message: 'Choose a goal status' })
  goalStatus?: TherapyGoalStatus | null;
}

export class CreateNoteDto {
  /** Left out: the default template for the therapy, or the general one */
  @IsOptional()
  @IsUUID('all', { message: 'Choose a template' })
  templateId?: string;
}

/** A note's content. Each part sent replaces what's there; parts left out stay. */
class NoteContentDto {
  @Type(() => Number)
  @IsInt({ message: 'Reload the note and try again' })
  @Min(1)
  revision!: number;

  /** Field key → answer; checked against the template version by the engine */
  @IsOptional()
  @IsObject({ message: 'Invalid answers' })
  answers?: Record<string, unknown>;

  /** Goals addressed in the session and the progress seen */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SESSION_LIMITS.goals, {
    message: `Record up to ${SESSION_LIMITS.goals} goals`,
  })
  @ValidateNested({ each: true })
  @Type(() => GoalEntryDto)
  goals?: GoalEntryDto[];
}

export class UpdateNoteDto extends NoteContentDto {}

/** Saves what's sent and signs the note off. */
export class CompleteNoteDto extends NoteContentDto {}

export class AmendNoteDto extends NoteContentDto {
  @Reason('Say why the note is being corrected')
  reason!: string;
}

// ── Templates ───────────────────────────────────────────────────────────────

export class ListNoteTemplatesQuery {
  @IsOptional()
  @IsUUID()
  therapyTypeId?: string;

  /** Published templates a note of this therapy type can use (its own and general ones) */
  @IsOptional()
  @IsUUID()
  usableFor?: string;

  @IsOptional()
  @CommaList()
  @IsArray()
  @IsEnum(SessionNoteTemplateStatus, { each: true })
  status?: SessionNoteTemplateStatus[];

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;
}

class NoteTemplateDetails {
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(SESSION_LIMITS.templateDescription, {
    message: `Use up to ${SESSION_LIMITS.templateDescription} characters`,
  })
  description?: string | null;

  /** Null: a general template for every therapy type */
  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @IsUUID('all', { message: 'Choose a therapy' })
  therapyTypeId?: string | null;

  /** Checked by the engine (forms/engine.ts), not by class-validator */
  @IsOptional()
  @IsObject({ message: 'Invalid form definition' })
  definition?: Record<string, unknown>;
}

export class CreateNoteTemplateDto extends NoteTemplateDetails {
  @Trim()
  @IsString({ message: 'Template name is required' })
  @IsNotEmpty({ message: 'Template name is required' })
  @MaxLength(SESSION_LIMITS.templateName, {
    message: `Use up to ${SESSION_LIMITS.templateName} characters`,
  })
  name!: string;

  /** Start from the standard session note instead of an empty form */
  @IsOptional()
  @IsBoolean()
  starter?: boolean;
}

export class UpdateNoteTemplateDto extends NoteTemplateDetails {
  @IsOptional()
  @Trim()
  @IsString({ message: 'Template name is required' })
  @IsNotEmpty({ message: 'Template name is required' })
  @MaxLength(SESSION_LIMITS.templateName, {
    message: `Use up to ${SESSION_LIMITS.templateName} characters`,
  })
  name?: string;

  /** Preselected for new notes of its therapy type; published templates only */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
