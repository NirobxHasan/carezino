import { parseIsoDate } from '../common/time';
import { Prisma } from '../generated/prisma/client';
import {
  GoalMeasurementType,
  type GoalPriority,
} from '../generated/prisma/enums';
import type { MeasurementConfigDto } from './dto';
import {
  isNumeric,
  validateConfig,
  valueError,
  type Errors,
  type MeasurementConfig,
} from './measurement';
import type { Db } from './shared';

/** A goal's definition as sent: a new goal, or an existing one merged with a change. */
export interface GoalFields {
  title: string;
  description?: string | null;
  categoryId?: string | null;
  priority?: GoalPriority | null;
  measurementType?: GoalMeasurementType;
  measurementConfig?: MeasurementConfigDto | MeasurementConfig | null;
  baselineText?: string | null;
  baselineValue?: number | null;
  targetText?: string | null;
  targetValue?: number | null;
  targetDate?: string | null;
  notes?: string | null;
}

/** The checked definition, ready to store. */
export interface GoalData {
  title: string;
  description: string | null;
  categoryId: string | null;
  priority: GoalPriority | null;
  measurementType: GoalMeasurementType;
  measurementConfig: Prisma.InputJsonValue | typeof Prisma.DbNull;
  baselineText: string | null;
  baselineValue: number | null;
  targetText: string | null;
  targetValue: number | null;
  targetDate: Date | null;
  notes: string | null;
}

export interface Category {
  id: string;
  name: string;
  therapyTypeId: string | null;
  isActive: boolean;
}

/** The center's categories among `ids`, for checking goals against. */
export async function loadCategories(
  db: Db,
  centerId: string,
  ids: (string | null | undefined)[],
) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Map<string, Category>();
  const rows = await db.therapyGoalCategory.findMany({
    where: { id: { in: wanted }, centerId },
    select: { id: true, name: true, therapyTypeId: true, isActive: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Checks one goal and normalizes it for storage. Errors are keyed under `path`, e.g.
 * "goals.2.targetValue". `keepCategoryId` is a category the goal already has, which may
 * stay even if it has since been deactivated.
 */
export function checkGoal(
  input: GoalFields,
  ctx: {
    therapyTypeId: string;
    categories: Map<string, Category>;
    keepCategoryId?: string | null;
  },
  path = '',
): { data: GoalData; config: MeasurementConfig | null; errors: Errors } {
  const at = (field: string) => (path ? `${path}.${field}` : field);
  const errors: Errors = {};

  const categoryId = input.categoryId ?? null;
  if (categoryId) {
    const category = ctx.categories.get(categoryId);
    if (!category) errors[at('categoryId')] = 'This category no longer exists';
    else if (!category.isActive && category.id !== ctx.keepCategoryId) {
      errors[at('categoryId')] = `${category.name} is inactive`;
    } else if (
      category.therapyTypeId &&
      category.therapyTypeId !== ctx.therapyTypeId
    ) {
      errors[at('categoryId')] = `${category.name} is for another therapy`;
    }
  }

  const type = input.measurementType ?? GoalMeasurementType.NARRATIVE;
  const checked = validateConfig(
    type,
    input.measurementConfig,
    at('measurementConfig'),
  );
  Object.assign(errors, checked.errors);
  const numeric = isNumeric(type);
  for (const field of ['baselineValue', 'targetValue'] as const) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    const error = numeric
      ? valueError(type, checked.config, value)
      : 'Narrative goals don’t take a number; describe it instead';
    if (error) errors[at(field)] = error;
  }

  let targetDate: Date | null = null;
  if (input.targetDate) {
    targetDate = parseIsoDate(input.targetDate);
    if (!targetDate) errors[at('targetDate')] = 'Choose a valid date';
  }

  return {
    errors,
    config: checked.config,
    data: {
      title: input.title,
      description: input.description ?? null,
      categoryId,
      priority: input.priority ?? null,
      measurementType: type,
      measurementConfig: checked.config
        ? (checked.config as Prisma.InputJsonValue)
        : Prisma.DbNull,
      baselineText: input.baselineText ?? null,
      baselineValue: numeric ? (input.baselineValue ?? null) : null,
      targetText: input.targetText ?? null,
      targetValue: numeric ? (input.targetValue ?? null) : null,
      targetDate,
      notes: input.notes ?? null,
    },
  };
}
