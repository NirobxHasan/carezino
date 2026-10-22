'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useCurrentCenter } from '@/lib/api/staff';
import { formatPhone } from '@/lib/format';
import type { AssessmentDetail } from '@/lib/types';
import { useCenterFormat } from '../appointments/appointment-display';
import { PATIENT_GENDERS, formatPatientAge } from '../patients/patient-display';
import {
  ASSESSMENT_KINDS,
  ASSESSMENT_STATUSES,
  assessmentLinks,
  useInstant,
} from './assessment-display';
import { useAssessmentPage } from './assessment-details';
import { AssessmentDocument } from './assessment-document';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children || '—'}</dd>
    </div>
  );
}

/**
 * A printable summary, laid out as a document. The browser's print dialog saves it as
 * PDF too; the app's navigation is hidden when printing (see AppShell).
 */
function PrintDocument({ assessment: a }: { assessment: AssessmentDetail }) {
  const center = useCurrentCenter();
  const fmt = useCenterFormat();
  const instant = useInstant();
  const p = a.patient;
  const signed = a.status !== 'DRAFT';
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button variant="ghost" asChild>
          <Link href={assessmentLinks.detail(a.id)}>
            <ArrowLeft /> Back to assessment
          </Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>
      <article className="mx-auto grid max-w-3xl gap-6 rounded-xl border border-border bg-surface p-6 sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <p className="text-lg font-semibold">{center.data?.name}</p>
            <p className="text-xs text-muted-foreground">
              {[center.data?.address, center.data?.phone && formatPhone(center.data.phone)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="text-right">
            <h1 className="text-base font-semibold">{ASSESSMENT_KINDS[a.type]}</h1>
            <p className="text-sm">{a.therapyType.name}</p>
            <p className="text-xs text-muted-foreground">{fmt.date(a.assessmentDate)}</p>
          </div>
        </header>
        {!signed && (
          <p className="rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-sm font-medium text-warning-foreground">
            Draft: not yet completed or signed.
          </p>
        )}
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Fact label="Patient">{p.fullName}</Fact>
          <Fact label="Patient ID">{p.code}</Fact>
          <Fact label="Age at assessment">{formatPatientAge(p.ageAtAssessment)}</Fact>
          <Fact label="Gender">{p.gender && PATIENT_GENDERS[p.gender]}</Fact>
          <Fact label="Therapist">
            {a.therapist.fullName}
            {a.therapist.designation && `, ${a.therapist.designation}`}
          </Fact>
          <Fact label="Registration no.">{a.therapist.registrationNumber}</Fact>
        </dl>
        <AssessmentDocument form={a.form} content={a.content} print />
        <footer className="grid gap-1 border-t border-border pt-4 text-xs text-muted-foreground break-inside-avoid-page">
          <p>
            Status: {ASSESSMENT_STATUSES[a.status].label}
            {a.completedAt &&
              ` · completed by ${a.completedBy?.fullName} on ${instant(a.completedAt)}`}
          </p>
          {a.amendments.length > 0 && (
            <p>
              Amended {a.amendments.length} time{a.amendments.length === 1 ? '' : 's'}, last by{' '}
              {a.amendments.at(-1)!.amendedBy.fullName} on {instant(a.amendments.at(-1)!.amendedAt)}
              . Earlier versions are kept in the record.
            </p>
          )}
          <p>
            Form: {a.template.name}, version {a.template.version}. Questions not answered are listed
            as not recorded; they weren’t assessed or weren’t documented.
          </p>
        </footer>
      </article>
    </>
  );
}

function PrintPage() {
  const { assessment: a, fallback } = useAssessmentPage();
  if (!a) return fallback;
  if (!a.clinicalAccess) {
    return (
      <Card>
        <EmptyState
          title="You can’t print this assessment"
          description="Its clinical content is private."
        />
      </Card>
    );
  }
  return <PrintDocument assessment={a} />;
}

export function AssessmentPrintScreen() {
  return (
    <RequirePermission permission="assessments.read_own">
      <PrintPage />
    </RequirePermission>
  );
}
