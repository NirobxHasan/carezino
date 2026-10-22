import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
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

import { EmptyToNull, IfPresent, Trim, TrimOrNull } from '../common/validation';
import {
  AssessmentStatus,
  AssessmentTemplateStatus,
  AssessmentType,
  GoalPriority,
} from '../generated/prisma/enums';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Choose a date';
const TYPE_MESSAGE = 'Choose initial, follow-up or reassessment';

export const ASSESSMENT_LIMITS = {
  templatesPerCenter: 200,
  templateName: 120,
  templateDescription: 1000,
  summaryText: 5000,
  recommendations: 20,
  goals: 30,
  goalTitle: 200,
  goalDescription: 2000,
  recommendationNote: 1000,
  sessionsPerWeek: { min: 1, max: 21 },
  durationMinutes: { min: 5, max: 480 },
  reviewAfterWeeks: { min: 1, max: 104 },
  amendmentReason: { min: 5, max: 1000 },
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

const Text = (max: number) => [
  IsOptional(),
  TrimOrNull(),
  IsString(),
  MaxLength(max, { message: `Use up to ${max} characters` }),
];

const applyAll =
  (decorators: PropertyDecorator[]): PropertyDecorator =>
  (target, key) =>
    decorators.forEach((d) => d(target, key));

/** Optional, clearable text: an empty string becomes null. */
const OptionalText = (max: number) => applyAll(Text(max));

const OptionalDate = () =>
  applyAll([
    IsOptional(),
    EmptyToNull(),
    Matches(ISO_DATE, { message: DATE_MESSAGE }),
  ]);

// ── Templates ───────────────────────────────────────────────────────────────

export class ListTemplatesQuery {
  @IsOptional()
  @IsUUID()
  therapyTypeId?: string;

  @IsOptional()
  @CommaList()
  @IsArray()
  @IsEnum(AssessmentTemplateStatus, { each: true })
  status?: AssessmentTemplateStatus[];

  /** Templates meant for this assessment type, or for any */
  @IsOptional()
  @IsEnum(AssessmentType)
  purpose?: AssessmentType;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;
}

class TemplateDetails {
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(ASSESSMENT_LIMITS.templateDescription, {
    message: `Use up to ${ASSESSMENT_LIMITS.templateDescription} characters`,
  })
  description?: string | null;

  /** Null: any assessment type */
  @IsOptional()
  @EmptyToNull()
  @IsEnum(AssessmentType, { message: TYPE_MESSAGE })
  purpose?: AssessmentType | null;

  /** Checked by the engine (engine.ts), not by class-validator */
  @IsOptional()
  @IsObject({ message: 'Invalid form definition' })
  definition?: Record<string, unknown>;
}

export class CreateTemplateDto extends TemplateDetails {
  @Trim()
  @IsString({ message: 'Template name is required' })
  @IsNotEmpty({ message: 'Template name is required' })
  @MaxLength(ASSESSMENT_LIMITS.templateName, {
    message: `Use up to ${ASSESSMENT_LIMITS.templateName} characters`,
  })
  name!: string;

  @IsUUID('all', { message: 'Choose a therapy' })
  therapyTypeId!: string;

  /** Start from the general starter form instead of an empty one */
  @IsOptional()
  @IsBoolean()
  starter?: boolean;
}

export class UpdateTemplateDto extends TemplateDetails {
  @IfPresent()
  @Trim()
  @IsString({ message: 'Template name is required' })
  @IsNotEmpty({ message: 'Template name is required' })
  @MaxLength(ASSESSMENT_LIMITS.templateName, {
    message: `Use up to ${ASSESSMENT_LIMITS.templateName} characters`,
  })
  name?: string;

  /** Only until a version has been published */
  @IfPresent()
  @IsUUID('all', { message: 'Choose a therapy' })
  therapyTypeId?: string;
}

// ── Assessments ─────────────────────────────────────────────────────────────

export class ListAssessmentsQuery {
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  therapyTypeId?: string;

  @IsOptional()
  @IsUUID()
  therapistId?: string;

  @IsOptional()
  @IsEnum(AssessmentType)
  type?: AssessmentType;

  @IsOptional()
  @CommaList()
  @IsArray()
  @IsEnum(AssessmentStatus, { each: true })
  status?: AssessmentStatus[];

  /** Patient name or ID, or therapist name */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Assessment dates, both included */
  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  to?: string;

  /** By assessment date; newest first by default */
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

export class PatientOptionsQuery {
  /** Patient name or ID */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreateAssessmentDto {
  @IsUUID('all', { message: 'Choose a patient' })
  patientId!: string;

  @IsUUID('all', { message: 'Choose a therapy' })
  therapyTypeId!: string;

  @IsEnum(AssessmentType, { message: TYPE_MESSAGE })
  type!: AssessmentType;

  @IsUUID('all', { message: 'Choose a template' })
  templateId!: string;

  @IsUUID('all', { message: 'Choose a therapist' })
  therapistId!: string;

  /** Center-local date */
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  assessmentDate!: string;

  /** The assessment appointment this records */
  @IsOptional()
  @EmptyToNull()
  @IsUUID('all', { message: 'Choose an appointment' })
  appointmentId?: string | null;
}

export class ClinicalSummaryDto {
  /** Required to complete the assessment */
  @OptionalText(ASSESSMENT_LIMITS.summaryText)
  summary?: string | null;

  @OptionalText(ASSESSMENT_LIMITS.summaryText)
  keyFindings?: string | null;

  @OptionalText(ASSESSMENT_LIMITS.summaryText)
  strengths?: string | null;

  @OptionalText(ASSESSMENT_LIMITS.summaryText)
  areasOfDifficulty?: string | null;

  @OptionalText(ASSESSMENT_LIMITS.summaryText)
  clinicalImpression?: string | null;

  @OptionalText(ASSESSMENT_LIMITS.summaryText)
  followUpRecommendation?: string | null;

  @OptionalText(ASSESSMENT_LIMITS.summaryText)
  additionalRecommendations?: string | null;

  @OptionalDate()
  suggestedReviewDate?: string | null;
}

const { sessionsPerWeek, durationMinutes, reviewAfterWeeks } =
  ASSESSMENT_LIMITS;

export class RecommendationDto {
  @IsUUID('all', { message: 'Choose a therapy' })
  therapyTypeId!: string;

  @IsOptional()
  @EmptyToNull()
  @IsInt({ message: 'Enter a whole number' })
  @Min(sessionsPerWeek.min, {
    message: `Enter ${sessionsPerWeek.min} to ${sessionsPerWeek.max}`,
  })
  @Max(sessionsPerWeek.max, {
    message: `Enter ${sessionsPerWeek.min} to ${sessionsPerWeek.max}`,
  })
  sessionsPerWeek?: number | null;

  @IsOptional()
  @EmptyToNull()
  @IsInt({ message: 'Enter whole minutes' })
  @Min(durationMinutes.min, {
    message: `Enter ${durationMinutes.min} to ${durationMinutes.max} minutes`,
  })
  @Max(durationMinutes.max, {
    message: `Enter ${durationMinutes.min} to ${durationMinutes.max} minutes`,
  })
  durationMinutes?: number | null;

  @IsOptional()
  @EmptyToNull()
  @IsInt({ message: 'Enter whole weeks' })
  @Min(reviewAfterWeeks.min, {
    message: `Enter ${reviewAfterWeeks.min} to ${reviewAfterWeeks.max} weeks`,
  })
  @Max(reviewAfterWeeks.max, {
    message: `Enter ${reviewAfterWeeks.min} to ${reviewAfterWeeks.max} weeks`,
  })
  reviewAfterWeeks?: number | null;

  @OptionalText(ASSESSMENT_LIMITS.recommendationNote)
  note?: string | null;
}

export class GoalDto {
  @Trim()
  @IsString({ message: 'Goal title is required' })
  @IsNotEmpty({ message: 'Goal title is required' })
  @MaxLength(ASSESSMENT_LIMITS.goalTitle, {
    message: `Use up to ${ASSESSMENT_LIMITS.goalTitle} characters`,
  })
  title!: string;

  @OptionalText(ASSESSMENT_LIMITS.goalDescription)
  description?: string | null;

  @IsOptional()
  @EmptyToNull()
  @IsEnum(GoalPriority, { message: 'Choose high, medium or low' })
  priority?: GoalPriority | null;

  @OptionalDate()
  targetReviewDate?: string | null;
}

/**
 * The clinical content of an assessment. Each part that's sent replaces what's there;
 * parts left out stay as they are. Lists are stored in the order sent.
 */
export class AssessmentContentDto {
  @IsOptional()
  @IsEnum(AssessmentType, { message: TYPE_MESSAGE })
  type?: AssessmentType;

  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  assessmentDate?: string;

  /** Field key → answer; checked against the template version by the engine */
  @IsOptional()
  @IsObject({ message: 'Invalid answers' })
  answers?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => ClinicalSummaryDto)
  clinicalSummary?: ClinicalSummaryDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ASSESSMENT_LIMITS.recommendations, {
    message: `Add up to ${ASSESSMENT_LIMITS.recommendations} recommendations`,
  })
  @ValidateNested({ each: true })
  @Type(() => RecommendationDto)
  recommendations?: RecommendationDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ASSESSMENT_LIMITS.goals, {
    message: `Add up to ${ASSESSMENT_LIMITS.goals} goals`,
  })
  @ValidateNested({ each: true })
  @Type(() => GoalDto)
  goals?: GoalDto[];
}

class Revisioned extends AssessmentContentDto {
  /** The revision the change was made from; a stale one is refused with a 409 */
  @Type(() => Number)
  @IsInt({ message: 'Reload the assessment and try again' })
  @Min(1)
  revision!: number;
}

export class UpdateAssessmentDto extends Revisioned {
  /** Null unlinks the appointment */
  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @IsUUID('all', { message: 'Choose an appointment' })
  appointmentId?: string | null;
}

/** Saves whatever content is sent, then signs the assessment off. */
export class CompleteAssessmentDto extends Revisioned {}

export class AmendAssessmentDto extends Revisioned {
  @Trim()
  @IsString({ message: 'Say why the assessment is being corrected' })
  @MinLength(ASSESSMENT_LIMITS.amendmentReason.min, {
    message: 'Say why the assessment is being corrected',
  })
  @MaxLength(ASSESSMENT_LIMITS.amendmentReason.max, {
    message: `Use up to ${ASSESSMENT_LIMITS.amendmentReason.max} characters`,
  })
  reason!: string;
}
