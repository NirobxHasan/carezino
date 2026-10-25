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
  GoalMeasurementType,
  GoalPriority,
  PlanPeriodUnit,
  ReviewOverallProgress,
  ReviewRecommendation,
  TherapyGoalStatus,
  TherapyPlanStatus,
} from '../generated/prisma/enums';
import { PLAN_LIMITS } from './rules';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Choose a date';
const UNIT_MESSAGE = 'Choose day, week or month';

/** "ACTIVE,PAUSED" or ?status=ACTIVE&status=PAUSED → an array */
const CommaList = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.split(',').filter(Boolean)
      : Array.isArray(value)
        ? value.flatMap((v) => String(v).split(',')).filter(Boolean)
        : value,
  );

const applyAll =
  (decorators: PropertyDecorator[]): PropertyDecorator =>
  (target, key) =>
    decorators.forEach((d) => d(target, key));

/** Optional, clearable text: an empty string becomes null. */
const OptionalText = (max: number) =>
  applyAll([
    IsOptional(),
    TrimOrNull(),
    IsString(),
    MaxLength(max, { message: `Use up to ${max} characters` }),
  ]);

const OptionalDate = () =>
  applyAll([
    IsOptional(),
    EmptyToNull(),
    Matches(ISO_DATE, { message: DATE_MESSAGE }),
  ]);

/** Optional, clearable whole number within a range. */
const OptionalInt = (min: number, max: number, unit = '') =>
  applyAll([
    IsOptional(),
    EmptyToNull(),
    IsInt({ message: 'Enter a whole number' }),
    Min(min, { message: `Enter ${min} to ${max}${unit}` }),
    Max(max, { message: `Enter ${min} to ${max}${unit}` }),
  ]);

const OptionalNumber = () =>
  applyAll([
    IsOptional(),
    EmptyToNull(),
    IsNumber(
      { allowNaN: false, allowInfinity: false },
      { message: 'Enter a number' },
    ),
  ]);

const Reason = (message: string) =>
  applyAll([
    Trim(),
    IsString({ message }),
    MinLength(PLAN_LIMITS.reason.min, { message }),
    MaxLength(PLAN_LIMITS.reason.max, {
      message: `Use up to ${PLAN_LIMITS.reason.max} characters`,
    }),
  ]);

const OptionalReason = () =>
  applyAll([
    IsOptional(),
    Trim(),
    IsString(),
    MaxLength(PLAN_LIMITS.reason.max, {
      message: `Use up to ${PLAN_LIMITS.reason.max} characters`,
    }),
  ]);

const Revision = () =>
  applyAll([
    Type(() => Number),
    IsInt({ message: 'Reload the plan and try again' }),
    Min(1),
  ]);

// ── Listing ─────────────────────────────────────────────────────────────────

export const REVIEW_DUE = ['OVERDUE', 'NEXT_7_DAYS', 'NEXT_30_DAYS'] as const;
export type ReviewDue = (typeof REVIEW_DUE)[number];

export const PLAN_SORTS = [
  'createdAt',
  'updatedAt',
  'nextReviewDate',
  'patientName',
] as const;
export type PlanSort = (typeof PLAN_SORTS)[number];

export class ListPlansQuery {
  /** Patient name or ID, plan ID or therapist name */
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
  therapyTypeId?: string;

  @IsOptional()
  @IsUUID()
  therapistId?: string;

  @IsOptional()
  @CommaList()
  @IsArray()
  @IsEnum(TherapyPlanStatus, { each: true })
  status?: TherapyPlanStatus[];

  /** Active or paused plans whose next review is overdue or due soon */
  @IsOptional()
  @IsIn(REVIEW_DUE)
  reviewDue?: ReviewDue;

  /** Start dates, both included */
  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  startFrom?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  startTo?: string;

  @IsOptional()
  @IsIn(PLAN_SORTS)
  sortBy?: PlanSort;

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

export class AssessmentOptionsQuery {
  @IsUUID('all', { message: 'Choose a patient' })
  patientId!: string;
}

// ── Goals ───────────────────────────────────────────────────────────────────

export class MeasurementConfigDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40, { message: 'Use up to 40 characters' })
  unit?: string;

  @IsOptional()
  @EmptyToNull()
  @IsInt({ message: 'Enter a whole number' })
  scaleMin?: number | null;

  @IsOptional()
  @EmptyToNull()
  @IsInt({ message: 'Enter a whole number' })
  scaleMax?: number | null;
}

/**
 * A goal's definition. On a draft plan the whole list is sent with the plan; on an
 * active one each goal is added or changed on its own, with a reason.
 */
export class GoalInputDto {
  /** An existing goal of this plan, when editing a draft's goal list */
  @IsOptional()
  @IsUUID()
  id?: string;

  /** The assessment goal it's copied from (the plan's source assessment) */
  @IsOptional()
  @EmptyToNull()
  @IsUUID()
  sourceAssessmentGoalId?: string | null;

  @Trim()
  @IsString({ message: 'Goal title is required' })
  @IsNotEmpty({ message: 'Goal title is required' })
  @MaxLength(PLAN_LIMITS.goalTitle, {
    message: `Use up to ${PLAN_LIMITS.goalTitle} characters`,
  })
  title!: string;

  @OptionalText(PLAN_LIMITS.goalText)
  description?: string | null;

  @IsOptional()
  @EmptyToNull()
  @IsUUID('all', { message: 'Choose a category' })
  categoryId?: string | null;

  @IsOptional()
  @EmptyToNull()
  @IsEnum(GoalPriority, { message: 'Choose high, medium or low' })
  priority?: GoalPriority | null;

  @IsOptional()
  @IsEnum(GoalMeasurementType, { message: 'Choose how the goal is measured' })
  measurementType?: GoalMeasurementType;

  /** Checked against the measurement type by measurement.ts */
  @IsOptional()
  @ValidateNested()
  @Type(() => MeasurementConfigDto)
  measurementConfig?: MeasurementConfigDto | null;

  @OptionalText(PLAN_LIMITS.goalText)
  baselineText?: string | null;

  @OptionalNumber()
  baselineValue?: number | null;

  @OptionalText(PLAN_LIMITS.goalText)
  targetText?: string | null;

  @OptionalNumber()
  targetValue?: number | null;

  @OptionalDate()
  targetDate?: string | null;

  @OptionalText(PLAN_LIMITS.goalText)
  notes?: string | null;
}

export class AddGoalDto extends GoalInputDto {
  /** Required once the plan is active: why the goal is added */
  @OptionalReason()
  reason?: string;
}

export class UpdateGoalDto {
  @IfPresent()
  @Trim()
  @IsString({ message: 'Goal title is required' })
  @IsNotEmpty({ message: 'Goal title is required' })
  @MaxLength(PLAN_LIMITS.goalTitle, {
    message: `Use up to ${PLAN_LIMITS.goalTitle} characters`,
  })
  title?: string;

  @OptionalText(PLAN_LIMITS.goalText)
  description?: string | null;

  @IsOptional()
  @EmptyToNull()
  @IsUUID('all', { message: 'Choose a category' })
  categoryId?: string | null;

  @IsOptional()
  @EmptyToNull()
  @IsEnum(GoalPriority, { message: 'Choose high, medium or low' })
  priority?: GoalPriority | null;

  @IfPresent()
  @IsEnum(GoalMeasurementType, { message: 'Choose how the goal is measured' })
  measurementType?: GoalMeasurementType;

  @IsOptional()
  @ValidateNested()
  @Type(() => MeasurementConfigDto)
  measurementConfig?: MeasurementConfigDto | null;

  @OptionalText(PLAN_LIMITS.goalText)
  baselineText?: string | null;

  @OptionalNumber()
  baselineValue?: number | null;

  @OptionalText(PLAN_LIMITS.goalText)
  targetText?: string | null;

  @OptionalNumber()
  targetValue?: number | null;

  @OptionalDate()
  targetDate?: string | null;

  @OptionalText(PLAN_LIMITS.goalText)
  notes?: string | null;

  /** Never set by a draft's goal list: drafts' goals haven't started */
  @IfPresent()
  @IsEnum(TherapyGoalStatus, { message: 'Choose a status' })
  status?: TherapyGoalStatus;

  /**
   * Required when changing anything but the status of an active plan's goal; optional
   * for status changes
   */
  @OptionalReason()
  reason?: string;
}

export class RecordProgressDto {
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  observationDate!: string;

  /** The goal's status as judged now; also becomes the goal's status */
  @IsOptional()
  @EmptyToNull()
  @IsEnum(TherapyGoalStatus, { message: 'Choose a status' })
  goalStatus?: TherapyGoalStatus | null;

  /** Measured goals only, in the goal's unit */
  @OptionalNumber()
  measuredValue?: number | null;

  @OptionalText(PLAN_LIMITS.observation)
  observation?: string | null;

  /** An earlier entry of this goal that this one corrects */
  @IsOptional()
  @IsUUID()
  correctsId?: string;

  /** Required with correctsId */
  @OptionalReason()
  correctionReason?: string;
}

// ── Plans ───────────────────────────────────────────────────────────────────

const { sessions, reviewInterval, durationMinutes } = PLAN_LIMITS;
const maxSessions = Math.max(...Object.values(sessions));
const maxInterval = Math.max(...Object.values(reviewInterval));

const Title = () =>
  applyAll([
    Trim(),
    IsString({ message: 'Plan title is required' }),
    IsNotEmpty({ message: 'Plan title is required' }),
    MaxLength(PLAN_LIMITS.title, {
      message: `Use up to ${PLAN_LIMITS.title} characters`,
    }),
  ]);

/** The plan's optional details. Each one sent replaces what's stored. */
class PlanOptionalDetailsDto {
  @OptionalText(PLAN_LIMITS.text)
  treatmentFocus?: string | null;

  @OptionalText(PLAN_LIMITS.text)
  clinicalNotes?: string | null;

  @OptionalInt(1, maxSessions)
  sessionsPerPeriod?: number | null;

  @IsOptional()
  @EmptyToNull()
  @IsEnum(PlanPeriodUnit, { message: UNIT_MESSAGE })
  frequencyUnit?: PlanPeriodUnit | null;

  @OptionalInt(durationMinutes.min, durationMinutes.max, ' minutes')
  durationMinutes?: number | null;

  @OptionalInt(1, maxInterval)
  reviewIntervalValue?: number | null;

  @IsOptional()
  @EmptyToNull()
  @IsEnum(PlanPeriodUnit, { message: UNIT_MESSAGE })
  reviewIntervalUnit?: PlanPeriodUnit | null;

  @OptionalText(PLAN_LIMITS.text)
  additionalInstructions?: string | null;

  @OptionalDate()
  targetEndDate?: string | null;

  @OptionalDate()
  nextReviewDate?: string | null;
}

/** For changes: title and start date may be left out, but not cleared. */
export class PlanDetailsDto extends PlanOptionalDetailsDto {
  @IfPresent()
  @Title()
  title?: string;

  @IfPresent()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  startDate?: string;
}

export class CreatePlanDto extends PlanOptionalDetailsDto {
  @IsUUID('all', { message: 'Choose a patient' })
  patientId!: string;

  @IsUUID('all', { message: 'Choose a therapy' })
  therapyTypeId!: string;

  @IsUUID('all', { message: 'Choose the responsible therapist' })
  therapistId!: string;

  /** A completed assessment of the patient this plan is based on */
  @IsOptional()
  @EmptyToNull()
  @IsUUID('all', { message: 'Choose an assessment' })
  sourceAssessmentId?: string | null;

  @Title()
  title!: string;

  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  startDate!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PLAN_LIMITS.goals, {
    message: `Add up to ${PLAN_LIMITS.goals} goals`,
  })
  @ValidateNested({ each: true })
  @Type(() => GoalInputDto)
  goals?: GoalInputDto[];
}

export class UpdateDraftDto extends PlanDetailsDto {
  @Revision()
  revision!: number;

  /** Null unlinks the assessment */
  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @IsUUID('all', { message: 'Choose an assessment' })
  sourceAssessmentId?: string | null;

  /** Changing the therapy re-checks the therapist and the assessment */
  @IfPresent()
  @IsUUID('all', { message: 'Choose a therapy' })
  therapyTypeId?: string;

  @IfPresent()
  @IsUUID('all', { message: 'Choose the responsible therapist' })
  therapistId?: string;

  /** The whole goal list, in order: goals with an id are kept, others added, the rest removed */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PLAN_LIMITS.goals, {
    message: `Add up to ${PLAN_LIMITS.goals} goals`,
  })
  @ValidateNested({ each: true })
  @Type(() => GoalInputDto)
  goals?: GoalInputDto[];
}

export class RevisePlanDto extends PlanDetailsDto {
  @Revision()
  revision!: number;

  @Reason('Say why the plan is being revised')
  reason!: string;

  /** The review that led to this revision */
  @IsOptional()
  @IsUUID()
  reviewId?: string;
}

export class TransitionDto {
  @Revision()
  revision!: number;
}

export class ReasonedTransitionDto extends TransitionDto {
  @Reason('Give a reason')
  reason!: string;

  @IsOptional()
  @IsUUID()
  reviewId?: string;
}

export class ResumeDto extends TransitionDto {
  @OptionalReason()
  note?: string;

  @IsOptional()
  @IsUUID()
  reviewId?: string;
}

export class CompletePlanDto extends TransitionDto {
  @Trim()
  @IsString({ message: 'Summarize how the treatment concluded' })
  @MinLength(PLAN_LIMITS.reason.min, {
    message: 'Summarize how the treatment concluded',
  })
  @MaxLength(PLAN_LIMITS.text, {
    message: `Use up to ${PLAN_LIMITS.text} characters`,
  })
  completionSummary!: string;

  @IsOptional()
  @IsUUID()
  reviewId?: string;
}

export class ReassignPlanDto extends TransitionDto {
  @IsUUID('all', { message: 'Choose a therapist' })
  therapistId!: string;

  @Reason('Say why the plan is being reassigned')
  reason!: string;
}

// ── Reviews ─────────────────────────────────────────────────────────────────

class ReviewTextDto {
  @OptionalText(PLAN_LIMITS.text)
  observations?: string | null;

  @OptionalText(PLAN_LIMITS.text)
  goalSummary?: string | null;

  @OptionalText(PLAN_LIMITS.text)
  notes?: string | null;

  /** Also becomes the plan's next review date */
  @OptionalDate()
  nextReviewDate?: string | null;
}

export class CreateReviewDto extends ReviewTextDto {
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  reviewDate!: string;

  @IsEnum(ReviewOverallProgress, { message: 'Choose the overall progress' })
  overallProgress!: ReviewOverallProgress;

  @IsEnum(ReviewRecommendation, { message: 'Choose a recommendation' })
  recommendation!: ReviewRecommendation;
}

/** Each part sent replaces what's stored; the review before it is kept. */
export class AmendReviewDto extends ReviewTextDto {
  @IsOptional()
  @Matches(ISO_DATE, { message: DATE_MESSAGE })
  reviewDate?: string;

  @IsOptional()
  @IsEnum(ReviewOverallProgress, { message: 'Choose the overall progress' })
  overallProgress?: ReviewOverallProgress;

  @IsOptional()
  @IsEnum(ReviewRecommendation, { message: 'Choose a recommendation' })
  recommendation?: ReviewRecommendation;

  @Reason('Say why the review is being corrected')
  reason!: string;
}

// ── Goal categories ─────────────────────────────────────────────────────────

export class ListCategoriesQuery {
  /** Categories offered for this therapy (its own and the general ones) */
  @IsOptional()
  @IsUUID()
  therapyTypeId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'all'])
  status?: 'ACTIVE' | 'INACTIVE' | 'all';
}

export class CreateCategoryDto {
  @Trim()
  @IsString({ message: 'Category name is required' })
  @IsNotEmpty({ message: 'Category name is required' })
  @MaxLength(PLAN_LIMITS.categoryName, {
    message: `Use up to ${PLAN_LIMITS.categoryName} characters`,
  })
  name!: string;

  @OptionalText(PLAN_LIMITS.categoryDescription)
  description?: string | null;

  /** Null: offered for every therapy */
  @IsOptional()
  @EmptyToNull()
  @IsUUID('all', { message: 'Choose a therapy' })
  therapyTypeId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;
}

export class UpdateCategoryDto {
  @IfPresent()
  @Trim()
  @IsString({ message: 'Category name is required' })
  @IsNotEmpty({ message: 'Category name is required' })
  @MaxLength(PLAN_LIMITS.categoryName, {
    message: `Use up to ${PLAN_LIMITS.categoryName} characters`,
  })
  name?: string;

  @OptionalText(PLAN_LIMITS.categoryDescription)
  description?: string | null;

  @IsOptional()
  @EmptyToNull()
  @IsUUID('all', { message: 'Choose a therapy' })
  therapyTypeId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;
}

export class CategoryStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
