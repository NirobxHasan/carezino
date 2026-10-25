'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { RequirePermission } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { usePlanPage } from './plan-details';
import { planLinks } from './plan-display';
import { PlanForm } from './plan-form';
import { NewReviewPage } from './reviews';

export function NewPlanScreen() {
  // Visited routes keep their state: start over after saving, or when arriving with
  // another patient or assessment to prefill from.
  const search = useSearchParams();
  const [round, setRound] = React.useState(0);
  return (
    <RequirePermission permission="therapy_plans.create">
      <div className="animate-in">
        <PageHeader
          back={{ href: planLinks.list, label: 'Therapy plans' }}
          title="New therapy plan"
          description="Who it’s for, the treatment and its goals. It’s saved as a draft until you activate it."
        />
        <PlanForm key={`${search.toString()}:${round}`} onSaved={() => setRound((r) => r + 1)} />
      </div>
    </RequirePermission>
  );
}

function NotEditable({ id }: { id: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        Only drafts can be edited, by their responsible therapist. Active plans are revised from
        their page.{' '}
        <Link href={planLinks.detail(id)} className="text-primary underline">
          Back to the plan
        </Link>
      </CardContent>
    </Card>
  );
}

function EditPlan() {
  const { id, plan, fallback } = usePlanPage();
  if (!plan) return fallback;
  if (!plan.clinicalAccess || !plan.actions.edit) return <NotEditable id={id} />;
  return (
    <div className="animate-in">
      <PageHeader
        back={{ href: planLinks.detail(plan.id), label: plan.title }}
        title={`Edit ${plan.code}`}
        description={`${plan.patient.fullName} · draft`}
      />
      <PlanForm key={plan.revision} plan={plan} />
    </div>
  );
}

export function EditPlanScreen() {
  return (
    <RequirePermission permission="therapy_plans.update">
      <EditPlan />
    </RequirePermission>
  );
}

function ReviewPlan() {
  const { id, plan, fallback } = usePlanPage();
  if (!plan) return fallback;
  if (!plan.clinicalAccess) return <NotEditable id={id} />;
  return <NewReviewPage plan={plan} />;
}

export function NewReviewRouteScreen() {
  return <ReviewPlan />;
}
