'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  Clock,
  ListChecks,
  Pencil,
  Trash2,
  UserCheck,
  UserSearch,
  UserX,
} from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { useBreadcrumbLabel } from '@/components/layout/breadcrumbs';
import { PageHeader } from '@/components/layout/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isApiError } from '@/lib/api/client';
import { useGeneralSettings } from '@/lib/api/settings';
import { useTherapist, useTherapistList } from '@/lib/api/therapists';
import { formatCenterDate, formatPhone } from '@/lib/format';
import { roleLabels } from '@/lib/permissions';
import { useSession } from '@/lib/session';
import type { TherapistDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AppointmentsPanel } from '../appointments/appointments-panel';
import { AvailabilityPanel } from './availability-panel';
import { ScheduleCalendar } from './schedule-calendar';
import { therapistLinks, useTherapistDialogs } from './therapist-actions';
import {
  AvailabilitySummary,
  BOOKING_ISSUES,
  EMPLOYMENT_TYPES,
  GENDERS,
  SpecializationTags,
  TherapistStatusBadge,
} from './therapist-display';
import { TherapistForm } from './therapist-form';
import { TimeOffPanel } from './time-off';

const back = { href: '/therapists', label: 'Therapists' };
const TABS = ['overview', 'availability', 'schedule', 'sessions'] as const;
type Tab = (typeof TABS)[number];

/** Photo if the profile has one, else initials. */
export function TherapistAvatar({
  therapist,
  size = 'lg',
}: {
  therapist: Pick<TherapistDetail, 'fullName' | 'photoUrl'>;
  size?: 'md' | 'lg';
}) {
  if (!therapist.photoUrl) return <Avatar name={therapist.fullName} size={size} />;
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0 rounded-full bg-muted bg-cover bg-center',
        size === 'lg' ? 'size-14' : 'size-9',
      )}
      style={{ backgroundImage: `url(${JSON.stringify(therapist.photoUrl)})` }}
    />
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="grid gap-0.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className={cn('text-sm whitespace-pre-line', empty && 'text-subtle-foreground')}>
        {empty ? '—' : children}
      </dd>
    </div>
  );
}

/** Loads a therapist for a page, with not-found and error states. */
function useTherapistPage() {
  const { id } = useParams<{ id: string }>();
  const query = useTherapist(id);
  useBreadcrumbLabel(id, query.data?.fullName);
  let fallback: React.ReactNode = null;
  if (query.isPending) fallback = <PageSkeleton />;
  else if (query.error) {
    // 404 covers missing, deleted, another center's, and colleagues' private profiles.
    fallback =
      isApiError(query.error, 404) || isApiError(query.error, 400) ? (
        <Card>
          <EmptyState
            icon={UserSearch}
            title="Therapist not found"
            description="They may have been removed, or the link is wrong."
            action={
              <Button variant="secondary" size="sm" asChild>
                <Link href={back.href}>Back to therapists</Link>
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
  return { id, therapist: query.data, fallback };
}

function Overview({ therapist }: { therapist: TherapistDetail }) {
  const { can } = useSession();
  const general = useGeneralSettings();
  const date = (v: string) => formatCenterDate(v, general.data?.dateFormat);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {therapist.bookingIssues.length > 0 && (
        <div
          role="status"
          className="flex gap-3 rounded-xl border border-warning/30 bg-warning-subtle p-4 text-[13px] text-warning-foreground lg:col-span-2"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="grid gap-1">
            <p className="font-medium">Not available for booking yet</p>
            <ul className="list-disc pl-4">
              {therapist.bookingIssues.map((issue) => (
                <li key={issue}>{BOOKING_ISSUES[issue]}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Personal information</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Therapist ID">{therapist.code}</Detail>
            <Detail label="Mobile">{formatPhone(therapist.mobile)}</Detail>
            <Detail label="Email">{therapist.email}</Detail>
            <Detail label="Gender">{therapist.gender && GENDERS[therapist.gender]}</Detail>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Employment</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Designation">{therapist.designation}</Detail>
            <Detail label="Employment type">
              {therapist.employmentType && EMPLOYMENT_TYPES[therapist.employmentType]}
            </Detail>
            <Detail label="Joined">{therapist.joiningDate && date(therapist.joiningDate)}</Detail>
            <Detail label="Experience">
              {therapist.yearsOfExperience !== null &&
                `${therapist.yearsOfExperience} ${therapist.yearsOfExperience === 1 ? 'year' : 'years'}`}
            </Detail>
            <Detail label="Registration number">{therapist.registrationNumber}</Detail>
            <Detail label="Status">
              <TherapistStatusBadge status={therapist.status} />
            </Detail>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Specializations</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <SpecializationTags specializations={therapist.specializations} full />
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Weekly availability">
              <AvailabilitySummary
                summary={therapist.availabilitySummary}
                weekStartsOn={general.data?.weekStartsOn}
              />
            </Detail>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Qualifications & notes</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4">
            <Detail label="Qualifications">{therapist.qualifications}</Detail>
            <Detail label="Notes">{therapist.notes}</Detail>
          </dl>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Sign-in access</CardTitle>
        </CardHeader>
        <CardContent>
          {therapist.account ? (
            <dl className="grid gap-4 sm:grid-cols-3">
              <Detail label="Staff account">{therapist.account.fullName}</Detail>
              <Detail label="Email">{therapist.account.email}</Detail>
              <Detail label="Role">
                {roleLabels[therapist.account.role]}
                {therapist.account.status === 'INACTIVE' && ' (inactive)'}
              </Detail>
            </dl>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              Not linked to a staff account. The profile works without one; link an account if this
              therapist should sign in to see their own schedule.
              {can('therapists.update') && can('staff.read') && (
                <>
                  {' '}
                  <Link
                    href={therapistLinks.edit(therapist.id)}
                    className="underline underline-offset-2"
                  >
                    Link an account
                  </Link>
                </>
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function TherapistProfile() {
  const { id, therapist, fallback } = useTherapistPage();
  const { can } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get('tab') as Tab | null;
  const tab: Tab =
    requested &&
    TABS.includes(requested) &&
    (requested !== 'sessions' || can('appointments.read_own'))
      ? requested
      : 'overview';
  const openTimeOff = searchParams.get('timeOff') === 'new';
  const { changeStatus, remove, dialogs } = useTherapistDialogs({
    afterDelete: () => router.push('/therapists'),
  });

  if (!therapist) return fallback;
  const active = therapist.status === 'ACTIVE';
  const canStatus = can(active ? 'therapists.deactivate' : 'therapists.update');

  return (
    <div className="animate-in">
      <PageHeader
        back={can('therapists.read') ? back : undefined}
        title={
          <span className="flex items-center gap-3">
            <TherapistAvatar therapist={therapist} />
            <span className="min-w-0">
              {therapist.fullName}
              <span className="block text-sm font-normal text-muted-foreground">
                {[therapist.code, therapist.designation].filter(Boolean).join(' · ')}
              </span>
            </span>
          </span>
        }
        meta={
          <>
            <TherapistStatusBadge status={therapist.status} />
            {therapist.isYou && <Badge tone="primary">You</Badge>}
            <SpecializationTags specializations={therapist.specializations} />
          </>
        }
        actions={
          <>
            {can('therapists.update') && (
              <Button variant="secondary" asChild>
                <Link href={therapistLinks.edit(id)}>
                  <Pencil /> Edit
                </Link>
              </Button>
            )}
            {canStatus &&
              (active ? (
                <Button variant="danger-ghost" onClick={() => changeStatus(therapist)}>
                  <UserX /> Deactivate
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => changeStatus(therapist)}>
                  <UserCheck /> Activate
                </Button>
              ))}
            {can('therapists.delete') && (
              <Button
                variant="danger-ghost"
                size="icon"
                aria-label="Delete therapist"
                onClick={() => remove(therapist)}
              >
                <Trash2 />
              </Button>
            )}
          </>
        }
      />
      <Tabs
        value={tab}
        onValueChange={(next) => {
          const params = new URLSearchParams(searchParams.toString());
          params.delete('timeOff');
          if (next === 'overview') params.delete('tab');
          else params.set('tab', next);
          const q = params.toString();
          router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
        }}
      >
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="availability">
            <Clock /> Availability
          </TabsTrigger>
          <TabsTrigger value="schedule">
            <CalendarDays /> Schedule
          </TabsTrigger>
          {can('appointments.read_own') && (
            <TabsTrigger value="sessions">
              <ListChecks /> Sessions
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="overview">
          <Overview therapist={therapist} />
        </TabsContent>
        <TabsContent value="availability" className="grid gap-4">
          <AvailabilityPanel therapistId={id} />
          <TimeOffPanel therapistId={id} openNew={openTimeOff} />
        </TabsContent>
        <TabsContent value="schedule">
          <ScheduleCalendar
            therapistId={id}
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link href={therapistLinks.schedule(id)}>Open full page</Link>
              </Button>
            }
          />
        </TabsContent>
        <TabsContent value="sessions">
          <AppointmentsPanel therapistId={id} bookPrefill={{ therapistId: id }} />
        </TabsContent>
      </Tabs>
      {dialogs}
    </div>
  );
}

export function TherapistProfileScreen() {
  return (
    <RequirePermission permission="therapists.read_own">
      <TherapistProfile />
    </RequirePermission>
  );
}

function EditTherapist() {
  const { therapist, fallback } = useTherapistPage();
  if (!therapist) return fallback;
  return (
    <div className="animate-in">
      <PageHeader
        back={{ href: therapistLinks.profile(therapist.id), label: therapist.fullName }}
        title={`Edit ${therapist.fullName}`}
        description="Profile details and specializations. Weekly hours and time off are on the Availability tab."
      />
      <TherapistForm key={therapist.updatedAt} therapist={therapist} />
    </div>
  );
}

export function EditTherapistScreen() {
  return (
    <RequirePermission permission="therapists.update">
      <EditTherapist />
    </RequirePermission>
  );
}

export function NewTherapistScreen() {
  return (
    <RequirePermission permission="therapists.create">
      <div className="animate-in">
        <PageHeader
          back={back}
          title="Add therapist"
          description="A professional profile for booking and records. It doesn’t create a login."
        />
        <TherapistForm />
      </div>
    </RequirePermission>
  );
}

/** Jump to another therapist's schedule, for staff who see the whole team. */
function TherapistSwitcher({ currentId }: { currentId: string }) {
  const router = useRouter();
  const list = useTherapistList({ pageSize: 100, sortBy: 'fullName' });
  const options = (list.data?.items ?? []).map((t) => ({
    value: t.id,
    label: t.fullName,
    description: [t.code, t.status === 'INACTIVE' ? 'Inactive' : null].filter(Boolean).join(' · '),
    keywords: [t.code],
  }));
  return (
    <SearchableSelect
      options={options}
      value={currentId}
      onChange={(v) => v && v !== currentId && router.push(therapistLinks.schedule(v))}
      loading={list.isPending}
      searchPlaceholder="Search therapists"
      aria-label="Show schedule for"
      className="h-10 w-full sm:w-60"
    />
  );
}

function TherapistSchedule() {
  const { id, therapist, fallback } = useTherapistPage();
  const { can } = useSession();
  if (!therapist) return fallback;
  return (
    <div className="animate-in">
      <PageHeader
        back={{ href: therapistLinks.profile(id), label: therapist.fullName }}
        title={`${therapist.fullName}’s schedule`}
        description="Regular hours, time off and center closures. Use it to see when they can be booked."
        meta={<TherapistStatusBadge status={therapist.status} />}
        actions={
          <>
            {can('therapists.read') && <TherapistSwitcher currentId={id} />}
            {can('therapists.manage_availability') && (
              <Button variant="secondary" asChild>
                <Link href={therapistLinks.availability(id)}>
                  <Clock /> Edit availability
                </Link>
              </Button>
            )}
            {can('therapists.manage_time_off') && (
              <Button asChild>
                <Link href={therapistLinks.addTimeOff(id)}>
                  <CalendarPlus /> Add time off
                </Link>
              </Button>
            )}
          </>
        }
      />
      <ScheduleCalendar therapistId={id} />
    </div>
  );
}

export function TherapistScheduleScreen() {
  return (
    <RequirePermission permission="therapists.read_own">
      <TherapistSchedule />
    </RequirePermission>
  );
}
