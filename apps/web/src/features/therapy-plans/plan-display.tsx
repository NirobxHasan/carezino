'use client';

import {
  AlarmClock,
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  CirclePause,
  CirclePlay,
  FilePenLine,
  Flag,
  type LucideIcon,
} from 'lucide-react';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import type {
  DurationUnit,
  GoalMeasurementType,
  MeasurementConfig,
  PlanPeriodUnit,
  ReviewOverallProgress,
  ReviewRecommendation,
  TherapyGoalStatus,
  TherapyPlanEvent,
  TherapyPlanItem,
  TherapyPlanStatus,
} from '@/lib/types';

type StatusDef = { label: string; tone: BadgeTone; icon: LucideIcon };

export const PLAN_STATUSES: Record<TherapyPlanStatus, StatusDef> = {
  DRAFT: { label: 'Draft', tone: 'warning', icon: FilePenLine },
  ACTIVE: { label: 'Active', tone: 'success', icon: CirclePlay },
  PAUSED: { label: 'Paused', tone: 'info', icon: CirclePause },
  COMPLETED: { label: 'Completed', tone: 'primary', icon: CheckCircle2 },
  DISCONTINUED: { label: 'Discontinued', tone: 'neutral', icon: Ban },
};

export const GOAL_STATUSES: Record<TherapyGoalStatus, StatusDef> = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral', icon: CircleDashed },
  IN_PROGRESS: { label: 'In progress', tone: 'info', icon: CircleDot },
  ACHIEVED: { label: 'Achieved', tone: 'success', icon: Flag },
  ON_HOLD: { label: 'On hold', tone: 'warning', icon: CirclePause },
  DISCONTINUED: { label: 'Discontinued', tone: 'neutral', icon: Ban },
};

export const MEASUREMENT_TYPES: Record<
  GoalMeasurementType,
  { label: string; description: string; numeric: boolean }
> = {
  NARRATIVE: { label: 'Descriptive', description: 'Described in words', numeric: false },
  PERCENTAGE: { label: 'Percentage', description: '0–100%', numeric: true },
  COUNT: { label: 'Count', description: 'A whole number, e.g. attempts', numeric: true },
  DURATION: { label: 'Duration', description: 'Seconds, minutes or hours', numeric: true },
  FREQUENCY: { label: 'Frequency', description: 'How often, e.g. per session', numeric: true },
  RATING_SCALE: { label: 'Rating scale', description: 'A score on a scale', numeric: true },
  CUSTOM: { label: 'Custom unit', description: 'A number in your own unit', numeric: true },
};

export const DURATION_UNITS: Record<DurationUnit, { label: string; short: string }> = {
  SECONDS: { label: 'Seconds', short: 'sec' },
  MINUTES: { label: 'Minutes', short: 'min' },
  HOURS: { label: 'Hours', short: 'h' },
};

export const PERIOD_UNITS: Record<PlanPeriodUnit, { per: string; plural: string }> = {
  DAY: { per: 'day', plural: 'days' },
  WEEK: { per: 'week', plural: 'weeks' },
  MONTH: { per: 'month', plural: 'months' },
};

export const OVERALL_PROGRESS: Record<ReviewOverallProgress, string> = {
  SIGNIFICANT: 'Significant progress',
  MODERATE: 'Moderate progress',
  MINIMAL: 'Minimal progress',
  NONE: 'No observable progress',
  REGRESSION: 'Regression',
  NOT_ENOUGH_INFORMATION: 'Not enough information',
};

export const RECOMMENDATIONS: Record<ReviewRecommendation, string> = {
  CONTINUE: 'Continue current plan',
  MODIFY: 'Modify treatment plan',
  INCREASE_FREQUENCY: 'Increase frequency',
  DECREASE_FREQUENCY: 'Decrease frequency',
  PAUSE: 'Pause treatment',
  COMPLETE: 'Complete treatment',
  REFER_FOR_ASSESSMENT: 'Refer for additional assessment',
};

export const PLAN_EVENTS: Record<TherapyPlanEvent, string> = {
  ACTIVATED: 'Plan activated',
  PAUSED: 'Plan paused',
  RESUMED: 'Plan resumed',
  COMPLETED: 'Plan completed',
  DISCONTINUED: 'Plan discontinued',
  REVISED: 'Plan revised',
  THERAPIST_REASSIGNED: 'Therapist reassigned',
  GOAL_ADDED: 'Goal added',
  GOAL_UPDATED: 'Goal changed',
};

export const planLinks = {
  list: '/therapy-plans',
  detail: (id: string, tab?: string) => `/therapy-plans/${id}${tab ? `?tab=${tab}` : ''}`,
  edit: (id: string) => `/therapy-plans/${id}/edit`,
  review: (id: string) => `/therapy-plans/${id}/reviews/new`,
  /** The new-plan form, prefilled with whatever is known */
  create: (prefill: Record<string, string | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(prefill)) if (value) q.set(key, value);
    const s = q.toString();
    return s ? `/therapy-plans/new?${s}` : '/therapy-plans/new';
  },
  categories: '/settings/goal-categories',
};

export function PlanStatusBadge({ status }: { status: TherapyPlanStatus }) {
  const def = PLAN_STATUSES[status];
  const Icon = def.icon;
  return (
    <Badge tone={def.tone}>
      <Icon aria-hidden />
      {def.label}
    </Badge>
  );
}

export function GoalStatusBadge({ status }: { status: TherapyGoalStatus }) {
  const def = GOAL_STATUSES[status];
  const Icon = def.icon;
  return (
    <Badge tone={def.tone}>
      <Icon aria-hidden />
      {def.label}
    </Badge>
  );
}

/** "Overdue" / "Due soon" next to a review date, for plans in force. */
export function ReviewDueBadge({ state }: { state: TherapyPlanItem['reviewState'] }) {
  if (!state) return null;
  return (
    <Badge tone={state === 'OVERDUE' ? 'danger' : 'warning'}>
      <AlarmClock aria-hidden />
      {state === 'OVERDUE' ? 'Review overdue' : 'Review due soon'}
    </Badge>
  );
}

/** "3 sessions per week · 45 min" */
export function describeFrequency(f: TherapyPlanItem['frequency']) {
  return [f.label, f.durationMinutes && `${f.durationMinutes} min`].filter(Boolean).join(' · ');
}

/** "Every 8 weeks" */
export function describeInterval(value: number | null, unit: PlanPeriodUnit | null) {
  if (!value || !unit) return null;
  return `Every ${value} ${value === 1 ? PERIOD_UNITS[unit].per : PERIOD_UNITS[unit].plural}`;
}

/** The unit a measured value is shown in, e.g. "%", "min", "times per session". */
export function measureUnit(type: GoalMeasurementType, config: MeasurementConfig | null) {
  switch (type) {
    case 'PERCENTAGE':
      return '%';
    case 'DURATION':
      return DURATION_UNITS[(config?.unit as DurationUnit) ?? 'MINUTES']?.short ?? config?.unit;
    case 'RATING_SCALE':
      return config ? `of ${config.scaleMax}` : '';
    default:
      return config?.unit ?? '';
  }
}

/** A measured value with its unit: "80%", "8 successful attempts", "4 of 5". */
export function formatMeasure(
  type: GoalMeasurementType,
  config: MeasurementConfig | null,
  value: number | null | undefined,
) {
  if (value === null || value === undefined) return null;
  const unit = measureUnit(type, config);
  const n = Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (type === 'PERCENTAGE') return `${n}%`;
  return unit ? `${n} ${unit}` : n;
}

/** A baseline or target: its value with unit, and/or its description. */
export function describeLevel(
  type: GoalMeasurementType,
  config: MeasurementConfig | null,
  level: { value: number | null; text: string | null },
) {
  const value = formatMeasure(type, config, level.value);
  return [value, level.text].filter(Boolean).join(' · ') || null;
}

/** "Rating scale (1–5)", "Duration (minutes)", "Custom unit (steps)" */
export function describeMeasurement(type: GoalMeasurementType, config: MeasurementConfig | null) {
  const label = MEASUREMENT_TYPES[type].label;
  if (type === 'RATING_SCALE' && config) return `${label} (${config.scaleMin}–${config.scaleMax})`;
  if (type === 'DURATION' && config?.unit) {
    return `${label} (${DURATION_UNITS[config.unit as DurationUnit]?.label.toLowerCase() ?? config.unit})`;
  }
  if (config?.unit) return `${label} (${config.unit})`;
  return label;
}
