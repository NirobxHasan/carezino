'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { FilePenLine, FileSearch, History, ListPlus, Lock, Printer } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { useBreadcrumbLabel } from '@/components/layout/breadcrumbs';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  assessmentsApi,
  useAmendmentSnapshot,
  useAssessment,
  type AnyAssessmentDetail,
} from '@/lib/api/assessments';
import { isApiError } from '@/lib/api/client';
import { keys } from '@/lib/api/keys';
import { useSession } from '@/lib/session';
import type { AssessmentDetail, AssessmentStatusDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { TherapyTypeChip, useCenterFormat } from '../appointments/appointment-display';
import { PATIENT_GENDERS, formatPatientAge } from '../patients/patient-display';
import { planLinks } from '../therapy-plans/plan-display';
import {
  ASSESSMENT_KINDS,
  AssessmentStatusBadge,
  TemplateLabel,
  assessmentLinks,
  useInstant,
} from './assessment-display';
import { AssessmentDocument } from './assessment-document';
import { AssessmentEditor } from './assessment-editor';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="grid gap-0.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className={cn('text-sm', empty && 'text-subtle-foreground')}>{empty ? '—' : children}</dd>
    </div>
  );
}

/** The content as it was before an amendment: the first is the signed original. */
function SnapshotDialog({
  assessment: a,
  number,
  onClose,
}: {
  assessment: AssessmentDetail;
  number: number | null;
  onClose: () => void;
}) {
  const snapshot = useAmendmentSnapshot(a.id, number);
  const fmt = useCenterFormat();
  const s = snapshot.data;
  return (
    <Dialog open={number !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {number === 1 ? 'Original signed version' : `Version before amendment ${number}`}
          </DialogTitle>
          <DialogDescription>
            {s
              ? `${ASSESSMENT_KINDS[s.previousContent.type]} on ${fmt.date(s.previousContent.assessmentDate)}. Replaced by ${s.amendedBy.fullName}.`
              : 'Loading…'}
          </DialogDescription>
        </DialogHeader>
        {snapshot.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : snapshot.error ? (
          <ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} />
        ) : (
          <AssessmentDocument form={s!.form} content={s!.previousContent} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AmendmentHistory({ assessment: a }: { assessment: AssessmentDetail }) {
  const instant = useInstant();
  const [open, setOpen] = React.useState<number | null>(null);
  return (
    <>
      <ol className="relative grid gap-4 border-l border-border pl-5">
        {a.completedAt && (
          <li className="relative">
            <span
              className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-success"
              aria-hidden
            />
            <p className="text-sm">Completed and signed</p>
            <p className="text-xs text-muted-foreground">
              {a.completedBy?.fullName} · {instant(a.completedAt)}
            </p>
          </li>
        )}
        {a.amendments.map((m) => (
          <li key={m.number} className="relative">
            <span
              className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-info"
              aria-hidden
            />
            <p className="text-sm">
              Amendment {m.number}: {m.changedFields.join(', ')}
            </p>
            <p className="text-[13px] text-muted-foreground">“{m.reason}”</p>
            <p className="text-xs text-muted-foreground">
              {m.amendedBy.fullName} · {instant(m.amendedAt)}
            </p>
            <Button
              variant="link"
              size="sm"
              className="h-auto text-xs"
              onClick={() => setOpen(m.number)}
            >
              {m.number === 1 ? 'View original version' : 'View version before this'}
            </Button>
          </li>
        ))}
      </ol>
      <SnapshotDialog assessment={a} number={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** A completed (or not yet editable) assessment, read-only, with its history. */
function AssessmentView({ assessment: a }: { assessment: AssessmentDetail }) {
  const fmt = useCenterFormat();
  const instant = useInstant();
  const { can } = useSession();
  const p = a.patient;
  return (
    <>
      <PageHeader
        back={{ href: assessmentLinks.list, label: 'Assessments' }}
        title={p.fullName}
        description={`${ASSESSMENT_KINDS[a.type]} · ${a.therapyType.name} · ${fmt.date(a.assessmentDate)}`}
        meta={
          <>
            <AssessmentStatusBadge status={a.status} />
            <TemplateLabel template={a.template} />
          </>
        }
        actions={
          <>
            {a.actions.edit && (
              <Button asChild>
                <Link href={assessmentLinks.detail(a.id)}>
                  <FilePenLine /> Continue draft
                </Link>
              </Button>
            )}
            <Button variant="secondary" asChild>
              <Link href={assessmentLinks.print(a.id)}>
                <Printer /> Print summary
              </Link>
            </Button>
            {a.actions.amend && (
              <Button variant="secondary" asChild>
                <Link href={`${assessmentLinks.detail(a.id)}?amend=1`}>
                  <History /> Amend
                </Link>
              </Button>
            )}
            {/* Recommendations and goals become suggestions in a new draft plan. */}
            {a.status !== 'DRAFT' && can('therapy_plans.create') && (
              <Button asChild>
                <Link href={planLinks.create({ patientId: p.id, assessmentId: a.id })}>
                  <ListPlus /> Create therapy plan
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <Card>
          <CardContent className="pt-6">
            <AssessmentDocument form={a.form} content={a.content} />
          </CardContent>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Assessment</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3">
                <Detail label="Patient">
                  {can('patients.read') ? (
                    <Link
                      href={`/patients/${p.id}?tab=assessments`}
                      className="font-medium hover:underline"
                    >
                      {p.fullName}
                    </Link>
                  ) : (
                    p.fullName
                  )}
                  <span className="block text-[13px] text-muted-foreground">
                    {[
                      p.code,
                      formatPatientAge(p.ageAtAssessment),
                      p.gender && PATIENT_GENDERS[p.gender],
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </Detail>
                <Detail label="Service">
                  <TherapyTypeChip therapyType={a.therapyType} full />
                </Detail>
                <Detail label="Therapist">
                  {a.therapist.fullName}
                  {a.therapist.designation && (
                    <span className="block text-[13px] text-muted-foreground">
                      {a.therapist.designation}
                    </span>
                  )}
                </Detail>
                <Detail label="Appointment">
                  {a.appointment && (
                    <Link
                      href={`/appointments/${a.appointment.id}`}
                      className="text-primary hover:underline"
                    >
                      {fmt.shortDate(a.appointment.date)}, {fmt.clock(a.appointment.startTime)}
                    </Link>
                  )}
                </Detail>
                <Detail label="Started">
                  {a.createdBy.fullName} · {instant(a.createdAt)}
                </Detail>
              </dl>
            </CardContent>
          </Card>
          {a.status !== 'DRAFT' && (
            <Card>
              <CardHeader>
                <CardTitle>Record history</CardTitle>
              </CardHeader>
              <CardContent>
                <AmendmentHistory assessment={a} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/** For callers who may see that an assessment exists, not what it says. */
function StatusOnlyView({ assessment: a }: { assessment: AssessmentStatusDetail }) {
  const fmt = useCenterFormat();
  return (
    <>
      <PageHeader
        back={{ href: assessmentLinks.list, label: 'Assessments' }}
        title={a.patient.fullName}
        description={`${ASSESSMENT_KINDS[a.type]} · ${a.therapyType.name} · ${fmt.date(a.assessmentDate)}`}
        meta={<AssessmentStatusBadge status={a.status} />}
      />
      <Card>
        <CardContent className="grid gap-6 pt-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <dl className="grid gap-3">
            <Detail label="Patient ID">{a.patient.code}</Detail>
            <Detail label="Therapist">{a.therapist.fullName}</Detail>
            <Detail label="Template">
              <TemplateLabel template={a.template} />
            </Detail>
            <Detail label="Appointment">
              {a.appointment && (
                <Link
                  href={`/appointments/${a.appointment.id}`}
                  className="text-primary hover:underline"
                >
                  {fmt.shortDate(a.appointment.date)}, {fmt.clock(a.appointment.startTime)}
                </Link>
              )}
            </Detail>
          </dl>
          <EmptyState
            compact
            icon={Lock}
            title="Clinical content is private"
            description="Only the therapist and staff with clinical access can read the findings."
          />
        </CardContent>
      </Card>
    </>
  );
}

const notFound = (
  <Card>
    <EmptyState
      icon={FileSearch}
      title="Assessment not found"
      description="It may belong to another center, or you may not have access to it."
      action={
        <Button variant="secondary" size="sm" asChild>
          <Link href={assessmentLinks.list}>Back to assessments</Link>
        </Button>
      }
    />
  </Card>
);

/** Loads an assessment for a page, with not-found and error states. */
export function useAssessmentPage() {
  const { id } = useParams<{ id: string }>();
  const query = useAssessment(id);
  useBreadcrumbLabel(id, query.data?.patient.fullName);
  let fallback: React.ReactNode = null;
  if (query.isPending) fallback = <PageSkeleton />;
  else if (query.error) {
    fallback =
      isApiError(query.error, 404) || isApiError(query.error, 400) ? (
        notFound
      ) : (
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      );
  }
  return { id, assessment: query.data as AnyAssessmentDetail | undefined, fallback };
}

function AssessmentPage() {
  const { id, assessment: a, fallback } = useAssessmentPage();
  const search = useSearchParams();
  const qc = useQueryClient();
  // Bumped to start the editor over from the latest saved version.
  const [generation, setGeneration] = React.useState(0);
  if (!a) return fallback;
  if (!a.clinicalAccess) return <StatusOnlyView assessment={a} />;
  const reload = async () => {
    qc.setQueryData(keys.assessment(id), await assessmentsApi.get(id));
    setGeneration((g) => g + 1);
  };
  if (a.status === 'DRAFT' && a.actions.edit) {
    return (
      <AssessmentEditor
        key={`${a.id}-${generation}`}
        assessment={a}
        mode="draft"
        onReload={() => void reload()}
      />
    );
  }
  if (search.get('amend') && a.actions.amend) {
    return (
      <AssessmentEditor
        key={`${a.id}-${generation}`}
        assessment={a}
        mode="amend"
        onReload={() => void reload()}
      />
    );
  }
  return <AssessmentView assessment={a} />;
}

export function AssessmentDetailsScreen() {
  return (
    <RequirePermission permission="assessments.read_own">
      <div className="animate-in">
        <AssessmentPage />
      </div>
    </RequirePermission>
  );
}
