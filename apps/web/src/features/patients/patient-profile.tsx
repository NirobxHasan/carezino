'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  ListChecks,
  Pencil,
  Ticket,
  Trash2,
  UserCheck,
  UserPlus,
  UserSearch,
  UserX,
  X,
} from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { useBreadcrumbLabel } from '@/components/layout/breadcrumbs';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isApiError } from '@/lib/api/client';
import { usePatient } from '@/lib/api/patients';
import { useGeneralSettings } from '@/lib/api/settings';
import { formatCenterDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { PatientDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { appointmentLinks } from '../appointments/appointment-display';
import { AppointmentsPanel } from '../appointments/appointments-panel';
import { PatientAssessmentsPanel } from '../assessments/patient-assessments';
import { packageLinks } from '../packages/package-display';
import { PatientPackagesPanel } from '../packages/patient-packages';
import { PatientPlansPanel } from '../therapy-plans/patient-plans';
import { patientLinks, statusActions, usePatientDialogs } from './patient-actions';
import { ConsentCard, ContactsCard } from './patient-contacts';
import {
  PATIENT_GENDERS,
  REFERRAL_SOURCES,
  PatientAvatar,
  PatientStatusBadge,
  TherapyInterestTags,
  formatPatientAge,
} from './patient-display';
import { PatientForm } from './patient-form';

const back = { href: patientLinks.list, label: 'Patients' };

function Detail({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className={cn('grid gap-0.5', className)}>
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className={cn('text-sm whitespace-pre-line', empty && 'text-subtle-foreground')}>
        {empty ? '—' : children}
      </dd>
    </div>
  );
}

/** Loads a patient for a page, with not-found and error states. */
function usePatientPage() {
  const { id } = useParams<{ id: string }>();
  const query = usePatient(id);
  useBreadcrumbLabel(id, query.data?.fullName);
  let fallback: React.ReactNode = null;
  if (query.isPending) fallback = <PageSkeleton />;
  else if (query.error) {
    // 404 covers missing, deleted and other centers' patients alike.
    fallback =
      isApiError(query.error, 404) || isApiError(query.error, 400) ? (
        <Card>
          <EmptyState
            icon={UserSearch}
            title="Patient not found"
            description="They may have been removed, or the link is wrong."
            action={
              <Button variant="secondary" size="sm" asChild>
                <Link href={back.href}>Back to patients</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      );
  }
  return { id, patient: query.data, fallback };
}

function ageDetail(p: PatientDetail, date: (v: string) => string) {
  const age = formatPatientAge(p.age);
  if (p.dateOfBirth) return `${date(p.dateOfBirth)}${age ? ` (${age})` : ''}`;
  if (p.age && p.approximateAgeRecordedOn)
    return `About ${age?.replace('~', '')}, as given on ${date(p.approximateAgeRecordedOn)}`;
  return null;
}

function Overview({ patient }: { patient: PatientDetail }) {
  const general = useGeneralSettings();
  const date = (v: string) => formatCenterDate(v, general.data?.dateFormat);
  const referral =
    patient.referralSource === 'OTHER'
      ? patient.referralOther
      : patient.referralSource && REFERRAL_SOURCES[patient.referralSource];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Patient information</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Patient ID">{patient.code}</Detail>
            <Detail label={patient.dateOfBirth ? 'Date of birth' : 'Age'}>
              {ageDetail(patient, date)}
            </Detail>
            <Detail label="Gender">{patient.gender && PATIENT_GENDERS[patient.gender]}</Detail>
            <Detail label="Email">{patient.email}</Detail>
            <Detail label="Primary concern" className="sm:col-span-2">
              {patient.primaryConcern}
            </Detail>
            <Detail label="Interested in" className="sm:col-span-2">
              <TherapyInterestTags interests={patient.therapyInterests} full />
            </Detail>
            {patient.address && (
              <Detail label="Address" className="sm:col-span-2">
                {patient.address}
              </Detail>
            )}
          </dl>
        </CardContent>
      </Card>
      <ContactsCard patient={patient} />
      <Card>
        <CardHeader>
          <CardTitle>Registration</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Registered">{date(patient.registeredAt)}</Detail>
            <Detail label="Registered by">{patient.registeredBy.fullName}</Detail>
            <Detail label="Status">
              <PatientStatusBadge status={patient.status} />
            </Detail>
            <Detail label="Referral source">{referral}</Detail>
            <Detail label="Internal notes" className="sm:col-span-2">
              {patient.internalNotes}
            </Detail>
          </dl>
        </CardContent>
      </Card>
      <ConsentCard patient={patient} />
    </div>
  );
}

/** Shown once after registration: the new ID, and where to go next. */
function RegisteredBanner({ patient }: { patient: PatientDetail }) {
  const router = useRouter();
  const pathname = usePathname();
  const { can } = useSession();
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-success/30 bg-success-subtle p-4 text-sm text-success-foreground"
    >
      <CheckCircle2 className="size-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{patient.fullName} is registered.</span> Their patient ID is{' '}
        <span className="font-semibold tabular">{patient.code}</span>.
      </p>
      <div className="flex flex-wrap gap-2">
        {can('patients.create') && (
          <Button variant="secondary" size="sm" asChild>
            <Link href={patientLinks.new}>
              <UserPlus /> Register another
            </Link>
          </Button>
        )}
        <Button variant="secondary" size="sm" asChild>
          <Link href={patientLinks.list}>Back to patients</Link>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss"
          onClick={() => router.replace(pathname, { scroll: false })}
        >
          <X />
        </Button>
      </div>
    </div>
  );
}

type Tab = 'overview' | 'appointments' | 'assessments' | 'plans' | 'packages';
const TABS: Exclude<Tab, 'overview'>[] = ['appointments', 'assessments', 'plans', 'packages'];

function PatientProfile() {
  const { id, patient, fallback } = usePatientPage();
  const { can } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabs = {
    appointments: can('appointments.read_own'),
    assessments: can('assessments.read_own'),
    plans: can('therapy_plans.read_own'),
    packages: can('package_enrollments.read'),
  };
  const requested = TABS.find((t) => t === searchParams.get('tab'));
  const tab: Tab = requested && tabs[requested] ? requested : 'overview';
  const general = useGeneralSettings();
  const { changeStatus, remove, dialogs } = usePatientDialogs({
    afterDelete: () => router.push(patientLinks.list),
  });

  if (!patient) return fallback;
  const { canActivate, canDeactivate } = statusActions(patient.status);
  const canStatus = can('patients.change_status');
  const age = formatPatientAge(patient.age);

  return (
    <div className="animate-in">
      {searchParams.get('registered') && <RegisteredBanner patient={patient} />}
      <PageHeader
        back={back}
        title={
          <span className="flex items-center gap-3">
            <PatientAvatar patient={patient} size="lg" />
            <span className="min-w-0">
              {patient.fullName}
              <span className="block text-sm font-normal text-muted-foreground">
                {[patient.code, age, patient.gender && PATIENT_GENDERS[patient.gender]]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </span>
        }
        meta={
          <>
            <PatientStatusBadge status={patient.status} />
            <span className="text-[13px] text-muted-foreground">
              Registered {formatCenterDate(patient.registeredAt, general.data?.dateFormat)}
            </span>
          </>
        }
        actions={
          <>
            {can('appointments.create') && patient.status !== 'INACTIVE' && (
              <Button asChild>
                <Link href={appointmentLinks.book({ patientId: id })}>
                  <CalendarPlus /> Book appointment
                </Link>
              </Button>
            )}
            {can('package_enrollments.create') && patient.status !== 'INACTIVE' && (
              <Button variant="secondary" asChild>
                <Link href={packageLinks.enroll({ patientId: id })}>
                  <Ticket /> Enroll in package
                </Link>
              </Button>
            )}
            {can('patients.update') && (
              <Button variant="secondary" asChild>
                <Link href={patientLinks.edit(id)}>
                  <Pencil /> Edit
                </Link>
              </Button>
            )}
            {canStatus && canActivate && (
              <Button variant="secondary" onClick={() => changeStatus(patient, 'ACTIVE')}>
                <UserCheck /> Activate
              </Button>
            )}
            {canStatus && canDeactivate && (
              <Button variant="danger-ghost" onClick={() => changeStatus(patient, 'INACTIVE')}>
                <UserX /> Deactivate
              </Button>
            )}
            {can('patients.delete') && (
              <Button
                variant="danger-ghost"
                size="icon"
                aria-label="Delete patient"
                onClick={() => remove(patient)}
              >
                <Trash2 />
              </Button>
            )}
          </>
        }
      />
      {/* Notes and billing get their own tabs here once those modules exist; until then
          there's nothing real to show. */}
      {tabs.appointments || tabs.assessments || tabs.plans || tabs.packages ? (
        <Tabs
          value={tab}
          onValueChange={(next) => {
            const params = new URLSearchParams(searchParams.toString());
            params.delete('registered');
            if (next === 'overview') params.delete('tab');
            else params.set('tab', next);
            const q = params.toString();
            router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
          }}
        >
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            {tabs.appointments && (
              <TabsTrigger value="appointments">
                <CalendarDays /> Appointments
              </TabsTrigger>
            )}
            {tabs.assessments && (
              <TabsTrigger value="assessments">
                <ClipboardList /> Assessments
              </TabsTrigger>
            )}
            {tabs.plans && (
              <TabsTrigger value="plans">
                <ListChecks /> Therapy plans
              </TabsTrigger>
            )}
            {tabs.packages && (
              <TabsTrigger value="packages">
                <Ticket /> Packages
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="overview">
            <Overview patient={patient} />
          </TabsContent>
          <TabsContent value="appointments">
            {/* The header already offers booking for this patient. */}
            <AppointmentsPanel patientId={id} />
          </TabsContent>
          <TabsContent value="assessments">
            <PatientAssessmentsPanel patientId={id} />
          </TabsContent>
          <TabsContent value="plans">
            <PatientPlansPanel patientId={id} />
          </TabsContent>
          <TabsContent value="packages">
            <PatientPackagesPanel patientId={id} canEnroll={patient.status !== 'INACTIVE'} />
          </TabsContent>
        </Tabs>
      ) : (
        <Overview patient={patient} />
      )}
      {dialogs}
    </div>
  );
}

export function PatientProfileScreen() {
  return (
    <RequirePermission permission="patients.read">
      <PatientProfile />
    </RequirePermission>
  );
}

function EditPatient() {
  const { patient, fallback } = usePatientPage();
  if (!patient) return fallback;
  return (
    <div className="animate-in">
      <PageHeader
        back={{ href: patientLinks.profile(patient.id), label: patient.fullName }}
        title={`Edit ${patient.fullName}`}
        description="Patient details and registration. Guardians, status and consent are managed on the profile."
      />
      <PatientForm key={patient.updatedAt} patient={patient} />
    </div>
  );
}

export function EditPatientScreen() {
  return (
    <RequirePermission permission="patients.update">
      <EditPatient />
    </RequirePermission>
  );
}

export function NewPatientScreen() {
  return (
    <RequirePermission permission="patients.create">
      <div className="animate-in">
        <PageHeader
          back={back}
          title="Register patient"
          description="Basic details and one contact. Assessment, therapy plans and payments come later."
        />
        <PatientForm />
      </div>
    </RequirePermission>
  );
}
