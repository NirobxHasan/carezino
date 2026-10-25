'use client';

import { DatePicker } from '@/components/forms/date-picker';
import { Field } from '@/components/forms/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { GoalInput } from '@/lib/api/therapy-plans';
import type {
  DurationUnit,
  GoalCategory,
  GoalMeasurementType,
  GoalPriority,
  PlanGoal,
} from '@/lib/types';
import { GOAL_PRIORITIES } from '../assessments/assessment-display';
import { DURATION_UNITS, MEASUREMENT_TYPES, measureUnit } from './plan-display';

/** A goal as edited in a form: every input as text, converted on save. */
export interface GoalDraft {
  /** Local key for lists */
  key: string;
  id?: string;
  sourceAssessmentGoalId?: string | null;
  title: string;
  description: string;
  categoryId: string;
  priority: GoalPriority | '';
  measurementType: GoalMeasurementType;
  unit: string;
  scaleMin: string;
  scaleMax: string;
  baselineValue: string;
  baselineText: string;
  targetValue: string;
  targetText: string;
  targetDate: string;
  notes: string;
}

let keyCounter = 0;
export const newGoalKey = () => `goal-${++keyCounter}`;

export function emptyGoal(overrides: Partial<GoalDraft> = {}): GoalDraft {
  return {
    key: newGoalKey(),
    title: '',
    description: '',
    categoryId: '',
    priority: '',
    measurementType: 'NARRATIVE',
    unit: '',
    scaleMin: '1',
    scaleMax: '5',
    baselineValue: '',
    baselineText: '',
    targetValue: '',
    targetText: '',
    targetDate: '',
    notes: '',
    ...overrides,
  };
}

const text = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export function goalToDraft(goal: PlanGoal): GoalDraft {
  const c = goal.measurementConfig;
  return {
    key: goal.id,
    id: goal.id,
    sourceAssessmentGoalId: goal.sourceAssessmentGoalId,
    title: goal.title,
    description: goal.description ?? '',
    categoryId: goal.category?.id ?? '',
    priority: goal.priority ?? '',
    measurementType: goal.measurementType,
    unit: c?.unit ?? '',
    scaleMin: text(c?.scaleMin ?? 1),
    scaleMax: text(c?.scaleMax ?? 5),
    baselineValue: text(goal.baseline.value),
    baselineText: goal.baseline.text ?? '',
    targetValue: text(goal.target.value),
    targetText: goal.target.text ?? '',
    targetDate: goal.targetDate ?? '',
    notes: goal.notes ?? '',
  };
}

const num = (v: string) => {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : NaN;
};

/** The draft as the API takes it. Unused measurement settings are left out. */
export function draftToInput(d: GoalDraft): GoalInput {
  const numeric = MEASUREMENT_TYPES[d.measurementType].numeric;
  const config =
    d.measurementType === 'RATING_SCALE'
      ? { scaleMin: num(d.scaleMin) ?? undefined, scaleMax: num(d.scaleMax) ?? undefined }
      : ['COUNT', 'DURATION', 'FREQUENCY', 'CUSTOM'].includes(d.measurementType) && d.unit.trim()
        ? { unit: d.unit.trim() }
        : null;
  return {
    ...(d.id && { id: d.id }),
    sourceAssessmentGoalId: d.sourceAssessmentGoalId ?? null,
    title: d.title.trim(),
    description: d.description,
    categoryId: d.categoryId || null,
    priority: d.priority || null,
    measurementType: d.measurementType,
    measurementConfig: config,
    baselineText: d.baselineText,
    baselineValue: numeric ? num(d.baselineValue) : null,
    targetText: d.targetText,
    targetValue: numeric ? num(d.targetValue) : null,
    targetDate: d.targetDate || null,
    notes: d.notes,
  };
}

/** The API's errors for one goal, under `prefix` (e.g. "goals.2"), by field name. */
export function goalErrors(errors: Record<string, string>, prefix = '') {
  const at = prefix ? `${prefix}.` : '';
  const out: Record<string, string> = {};
  for (const [path, message] of Object.entries(errors)) {
    if (path.startsWith(at)) out[path.slice(at.length)] = message;
  }
  return out;
}

/**
 * The fields of one goal. Numbers are offered only for measured goals; narrative goals
 * are described in words. `lockMeasurement` keeps the measurement as it is once
 * progress has been recorded against it.
 */
export function GoalFields({
  value,
  onChange,
  errors = {},
  categories,
  lockMeasurement = false,
}: {
  value: GoalDraft;
  onChange: (patch: Partial<GoalDraft>) => void;
  errors?: Record<string, string>;
  categories: GoalCategory[];
  lockMeasurement?: boolean;
}) {
  const type = value.measurementType;
  const numeric = MEASUREMENT_TYPES[type].numeric;
  const unitLabel = measureUnit(type, {
    unit: value.unit || undefined,
    scaleMin: Number(value.scaleMin),
    scaleMax: Number(value.scaleMax),
  });
  // A deactivated category stays selectable on goals that already use it.
  const options = categories.filter((c) => c.isActive || c.id === value.categoryId);

  const level = (which: 'baseline' | 'target') => {
    const valueKey = `${which}Value` as const;
    const textKey = `${which}Text` as const;
    const label = which === 'baseline' ? 'Baseline' : 'Target';
    return (
      <div className="grid gap-2 sm:col-span-1">
        {numeric && (
          <Field label={label} optional error={errors[valueKey]}>
            <div className="flex items-center gap-2">
              <Input
                inputMode="decimal"
                value={value[valueKey]}
                onChange={(e) => onChange({ [valueKey]: e.target.value })}
                placeholder={which === 'baseline' ? 'e.g. 30' : 'e.g. 80'}
                className="w-28"
              />
              {unitLabel && <span className="text-[13px] text-muted-foreground">{unitLabel}</span>}
            </div>
          </Field>
        )}
        <Field label={numeric ? `${label} note` : label} optional error={errors[textKey]}>
          <Textarea
            rows={2}
            value={value[textKey]}
            onChange={(e) => onChange({ [textKey]: e.target.value })}
            placeholder={
              which === 'baseline'
                ? 'Where the patient is now, e.g. needs significant assistance'
                : 'What success looks like, e.g. minimal assistance in 4 of 5 opportunities'
            }
          />
        </Field>
      </div>
    );
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Goal title" required error={errors.title} className="sm:col-span-2">
        <Input
          value={value.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="e.g. Improve fine motor coordination"
          maxLength={200}
        />
      </Field>
      <Field label="Description" optional error={errors.description} className="sm:col-span-2">
        <Textarea
          rows={2}
          value={value.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </Field>
      <Field label="Category" optional error={errors.categoryId}>
        <Select
          value={value.categoryId || 'none'}
          onValueChange={(v) => onChange({ categoryId: v === 'none' ? '' : v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No category</SelectItem>
            {options.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
                {!c.isActive && <span className="text-muted-foreground"> (inactive)</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Priority" optional error={errors.priority}>
          <Select
            value={value.priority || 'none'}
            onValueChange={(v) => onChange({ priority: v === 'none' ? '' : (v as GoalPriority) })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not set</SelectItem>
              {Object.entries(GOAL_PRIORITIES).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Target date" optional error={errors.targetDate}>
          <DatePicker
            value={value.targetDate || undefined}
            onChange={(v) => onChange({ targetDate: v ?? '' })}
            placeholder="None"
          />
        </Field>
      </div>
      <Field
        label="How it’s measured"
        error={errors.measurementType}
        helper={
          lockMeasurement
            ? 'Progress has been recorded, so the measurement stays as it is.'
            : MEASUREMENT_TYPES[type].description
        }
      >
        <Select
          value={type}
          disabled={lockMeasurement}
          onValueChange={(v) => {
            const next = v as GoalMeasurementType;
            onChange({
              measurementType: next,
              unit: next === 'DURATION' ? 'MINUTES' : '',
              ...(!MEASUREMENT_TYPES[next].numeric && { baselineValue: '', targetValue: '' }),
            });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(MEASUREMENT_TYPES).map(([k, m]) => (
              <SelectItem key={k} value={k}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {type === 'DURATION' && (
        <Field label="Unit" required error={errors['measurementConfig.unit']}>
          <Select
            value={value.unit || 'MINUTES'}
            disabled={lockMeasurement}
            onValueChange={(v) => onChange({ unit: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DURATION_UNITS) as DurationUnit[]).map((u) => (
                <SelectItem key={u} value={u}>
                  {DURATION_UNITS[u].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {(type === 'COUNT' || type === 'FREQUENCY' || type === 'CUSTOM') && (
        <Field
          label={type === 'FREQUENCY' ? 'Per what' : 'Unit'}
          required={type !== 'COUNT'}
          optional={type === 'COUNT'}
          error={errors['measurementConfig.unit']}
        >
          <Input
            value={value.unit}
            disabled={lockMeasurement}
            onChange={(e) => onChange({ unit: e.target.value })}
            maxLength={40}
            placeholder={
              type === 'FREQUENCY'
                ? 'e.g. times per session'
                : type === 'COUNT'
                  ? 'e.g. successful attempts'
                  : 'e.g. steps'
            }
          />
        </Field>
      )}
      {type === 'RATING_SCALE' && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Lowest score" required error={errors['measurementConfig.scaleMin']}>
            <Input
              inputMode="numeric"
              value={value.scaleMin}
              disabled={lockMeasurement}
              onChange={(e) => onChange({ scaleMin: e.target.value })}
            />
          </Field>
          <Field label="Highest score" required error={errors['measurementConfig.scaleMax']}>
            <Input
              inputMode="numeric"
              value={value.scaleMax}
              disabled={lockMeasurement}
              onChange={(e) => onChange({ scaleMax: e.target.value })}
            />
          </Field>
        </div>
      )}
      {type === 'NARRATIVE' || type === 'PERCENTAGE' ? <div className="hidden sm:block" /> : null}
      {level('baseline')}
      {level('target')}
      <Field label="Notes" optional error={errors.notes} className="sm:col-span-2">
        <Textarea
          rows={2}
          value={value.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </Field>
    </div>
  );
}

/** A numeric input value the API would refuse as not a number. */
export function badNumber(d: GoalDraft) {
  const numeric = MEASUREMENT_TYPES[d.measurementType].numeric;
  const errors: Record<string, string> = {};
  if (numeric) {
    for (const key of ['baselineValue', 'targetValue'] as const) {
      if (d[key].trim() && !Number.isFinite(Number(d[key]))) errors[key] = 'Enter a number';
    }
  }
  return errors;
}
