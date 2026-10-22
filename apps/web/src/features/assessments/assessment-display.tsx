'use client';

import * as React from 'react';
import { CheckCircle2, FilePenLine, FileText, History, type LucideIcon } from 'lucide-react';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { useSession } from '@/lib/session';
import type {
  AssessmentKind,
  AssessmentRecordStatus,
  AssessmentTemplateStatus,
  ClinicalSummaryKey,
  GoalPriority,
  TemplateFieldType,
} from '@/lib/types';

export const ASSESSMENT_KINDS: Record<AssessmentKind, string> = {
  INITIAL: 'Initial assessment',
  FOLLOW_UP: 'Follow-up assessment',
  REASSESSMENT: 'Reassessment',
};

export const ASSESSMENT_STATUSES: Record<
  AssessmentRecordStatus,
  { label: string; tone: BadgeTone; icon: LucideIcon }
> = {
  DRAFT: { label: 'Draft', tone: 'warning', icon: FilePenLine },
  COMPLETED: { label: 'Completed', tone: 'success', icon: CheckCircle2 },
  AMENDED: { label: 'Amended', tone: 'info', icon: History },
};

export const TEMPLATE_STATUSES: Record<
  AssessmentTemplateStatus,
  { label: string; tone: BadgeTone }
> = {
  DRAFT: { label: 'Draft', tone: 'warning' },
  PUBLISHED: { label: 'Published', tone: 'success' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
};

export const FIELD_TYPES: Record<TemplateFieldType, { label: string; description: string }> = {
  TEXT: { label: 'Short text', description: 'One line, e.g. a referral name' },
  TEXTAREA: { label: 'Long text', description: 'Paragraphs, e.g. observations' },
  NUMBER: { label: 'Number', description: 'A measured or counted value' },
  SINGLE_SELECT: { label: 'Dropdown', description: 'Pick one from a list' },
  RADIO: { label: 'Single choice', description: 'Pick one, all options visible' },
  MULTI_SELECT: { label: 'Multi-select', description: 'Pick any number' },
  CHECKBOX: { label: 'Checkbox', description: 'A single yes, e.g. “Guardian present”' },
  DATE: { label: 'Date', description: 'A calendar date' },
};

export const GOAL_PRIORITIES: Record<GoalPriority, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

/** The common clinical summary every assessment has, in display order. */
export const SUMMARY_FIELDS: { key: ClinicalSummaryKey; label: string; required?: boolean }[] = [
  { key: 'summary', label: 'Assessment summary', required: true },
  { key: 'keyFindings', label: 'Key findings' },
  { key: 'strengths', label: 'Strengths' },
  { key: 'areasOfDifficulty', label: 'Areas of difficulty' },
  { key: 'clinicalImpression', label: 'Clinical impression' },
  { key: 'followUpRecommendation', label: 'Follow-up recommendation' },
];

export const assessmentLinks = {
  list: '/assessments',
  detail: (id: string) => `/assessments/${id}`,
  print: (id: string) => `/assessments/${id}/print`,
  /** The new-assessment form, prefilled with whatever is known */
  create: (prefill: Record<string, string | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(prefill)) if (value) q.set(key, value);
    const s = q.toString();
    return s ? `/assessments/new?${s}` : '/assessments/new';
  },
  templates: '/settings/assessment-templates',
  template: (id: string) => `/settings/assessment-templates/${id}`,
};

export function AssessmentStatusBadge({
  status,
  className,
}: {
  status: AssessmentRecordStatus;
  className?: string;
}) {
  const def = ASSESSMENT_STATUSES[status];
  const Icon = def.icon;
  return (
    <Badge tone={def.tone} className={className}>
      <Icon aria-hidden />
      {def.label}
    </Badge>
  );
}

export function TemplateStatusBadge({ status }: { status: AssessmentTemplateStatus }) {
  const def = TEMPLATE_STATUSES[status];
  return <Badge tone={def.tone}>{def.label}</Badge>;
}

export function TemplateLabel({ template }: { template: { name: string; version: number } }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px]">
      <FileText className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden />
      <span className="truncate">{template.name}</span>
      <span className="shrink-0 text-muted-foreground">v{template.version}</span>
    </span>
  );
}

/** An instant as the center's wall clock, e.g. "26 Oct 2026, 10:04". */
export function useInstant() {
  const { activeCenter } = useSession();
  return React.useMemo(() => {
    const f = new Intl.DateTimeFormat('en-GB', {
      timeZone: activeCenter.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return (iso: string) => f.format(new Date(iso));
  }, [activeCenter.timezone]);
}

/** "3 sessions a week · 45 min · review after 8 weeks" */
export function describeRecommendation(r: {
  sessionsPerWeek: number | null;
  durationMinutes: number | null;
  reviewAfterWeeks: number | null;
}) {
  return [
    r.sessionsPerWeek && `${r.sessionsPerWeek} session${r.sessionsPerWeek === 1 ? '' : 's'} a week`,
    r.durationMinutes && `${r.durationMinutes} min per session`,
    r.reviewAfterWeeks &&
      `review after ${r.reviewAfterWeeks} week${r.reviewAfterWeeks === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(' · ');
}
