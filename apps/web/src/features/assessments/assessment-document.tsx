'use client';

import * as React from 'react';
import { Target } from 'lucide-react';

import { formatDate } from '@/lib/format';
import type { AssessmentContent, TemplateDefinition } from '@/lib/types';
import { cn } from '@/lib/utils';
import { TherapyTypeChip } from '../appointments/appointment-display';
import { GOAL_PRIORITIES, SUMMARY_FIELDS, describeRecommendation } from './assessment-display';
import { AnswersView } from './dynamic-form';

function Block({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('grid gap-3 break-inside-avoid-page', className)}>
      <div className="space-y-0.5 border-b border-border pb-2">
        <h2 className="text-section-title">{title}</h2>
        {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

const notRecorded = <p className="text-[13px] text-muted-foreground italic">Not recorded</p>;

/**
 * An assessment's clinical content, read-only: findings from its own template version,
 * the clinical summary, recommendations and suggested goals. Anything left blank says
 * so rather than disappearing, so "not assessed" never reads as a finding.
 */
export function AssessmentDocument({
  form,
  content,
  print = false,
}: {
  form: TemplateDefinition;
  content: AssessmentContent;
  print?: boolean;
}) {
  const { clinicalSummary: summary, recommendations, goals } = content;
  const missingSummary = SUMMARY_FIELDS.filter((f) => !summary[f.key]);
  return (
    <div className={cn('grid', print ? 'gap-6' : 'gap-8')}>
      <Block title="Findings">
        <AnswersView definition={form} answers={content.answers} compact={print} />
      </Block>

      <Block title="Clinical summary">
        <dl className="grid gap-3">
          {SUMMARY_FIELDS.filter((f) => summary[f.key]).map((f) => (
            <div key={f.key} className="grid gap-0.5">
              <dt className="text-[13px] text-muted-foreground">{f.label}</dt>
              <dd className="text-sm whitespace-pre-line">{summary[f.key]}</dd>
            </div>
          ))}
        </dl>
        {missingSummary.length === SUMMARY_FIELDS.length
          ? notRecorded
          : missingSummary.length > 0 && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Not recorded:</span>{' '}
                {missingSummary.map((f) => f.label).join(', ')}
              </p>
            )}
      </Block>

      <Block
        title="Recommendations"
        description={
          print ? undefined : 'Clinical suggestions only. Nothing has been booked or sold.'
        }
      >
        {recommendations.length === 0 && !summary.additionalRecommendations && notRecorded}
        {recommendations.length > 0 && (
          <ul className="grid gap-2">
            {recommendations.map((r, i) => (
              <li key={i} className="grid gap-0.5 rounded-lg border border-border p-3">
                <TherapyTypeChip therapyType={r.therapyType} full />
                <span className="text-sm">
                  {describeRecommendation(r) || 'Frequency not specified'}
                </span>
                {r.note && (
                  <span className="text-[13px] whitespace-pre-line text-muted-foreground">
                    {r.note}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {summary.additionalRecommendations && (
          <div className="grid gap-0.5">
            <p className="text-[13px] text-muted-foreground">Additional recommendations</p>
            <p className="text-sm whitespace-pre-line">{summary.additionalRecommendations}</p>
          </div>
        )}
        {summary.suggestedReviewDate && (
          <p className="text-sm">
            <span className="text-muted-foreground">Suggested review: </span>
            {formatDate(summary.suggestedReviewDate)}
          </p>
        )}
      </Block>

      <Block
        title="Initial goals"
        description={
          print ? undefined : 'Suggested by the assessment. A therapy plan decides which to adopt.'
        }
      >
        {goals.length === 0 ? (
          notRecorded
        ) : (
          <ol className="grid gap-2">
            {goals.map((g, i) => (
              <li key={i} className="flex gap-3">
                <Target className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <div className="grid gap-0.5">
                  <p className="text-sm font-medium">{g.title}</p>
                  {g.description && (
                    <p className="text-[13px] whitespace-pre-line text-muted-foreground">
                      {g.description}
                    </p>
                  )}
                  {(g.priority || g.targetReviewDate) && (
                    <p className="text-xs text-muted-foreground">
                      {[
                        g.priority && `${GOAL_PRIORITIES[g.priority]} priority`,
                        g.targetReviewDate && `review by ${formatDate(g.targetReviewDate)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Block>
    </div>
  );
}
