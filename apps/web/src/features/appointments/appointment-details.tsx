'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CalendarSearch, ClipboardCheck, ClipboardPlus, ExternalLink, Pencil } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { Field } from '@/components/forms/field';
import { useBreadcrumbLabel } from '@/components/layout/breadcrumbs';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import {
  useAppointment,
  useSetAppointmentPackage,
  useUpdateAppointment,
} from '@/lib/api/appointments';
import { isApiError } from '@/lib/api/client';
import { formatPhone } from '@/lib/format';
import { useSession } from '@/lib/session';
import { formatMinutes } from '@/lib/settings-limits';
import type {
  AppointmentDetail,
  AppointmentHistoryEntry,
  AppointmentSnapshot,
  AppointmentType,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { ASSESSMENT_STATUSES, assessmentLinks } from '../assessments/assessment-display';
import {
  CHARGE_REASONS,
  COVERAGE,
  RELEASE_REASONS,
  packageLinks,
} from '../packages/package-display';
import { PackagePicker } from '../packages/package-picker';
import { relationshipLabel } from '../patients/patient-display';
import { therapistLinks } from '../therapists/therapist-actions';
import { availableActions, useAppointmentDialogs } from './appointment-actions';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  AppointmentStatusBadge,
  AppointmentTypeLabel,
  CANCELLATION_REASONS,
  TherapyTypeChip,
  appointmentLinks,
  describeRule,
  useCenterFormat,
} from './appointment-display';

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

/** An instant as the center's wall clock, e.g. "26 Oct 2026, 10:04". */
function useInstant() {
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

function HistoryTimeline({ history }: { history: AppointmentHistoryEntry[] }) {
  const fmt = useCenterFormat();
  const instant = useInstant();
  const when = (s: AppointmentSnapshot | null) =>
    s?.date && s.startTime
      ? `${fmt.shortDate(s.date)}, ${fmt.clock(s.startTime)}${s.therapist ? ` with ${s.therapist.fullName}` : ''}`
      : '';
  const describe = (h: AppointmentHistoryEntry) => {
    const prev = h.previousValues;
    const next = h.newValues;
    switch (h.action) {
      case 'CREATED':
        return `Booked for ${when(next)}`;
      case 'RESCHEDULED': {
        const changes = [
          prev?.durationMinutes !== next?.durationMinutes &&
            next?.durationMinutes &&
            `${formatMinutes(next.durationMinutes)} instead of ${formatMinutes(prev?.durationMinutes ?? 0)}`,
          prev?.therapyType?.id !== next?.therapyType?.id && next?.therapyType?.name,
        ].filter(Boolean);
        return `Moved from ${when(prev)} to ${when(next)}${changes.length ? ` (${changes.join(', ')})` : ''}`;
      }
      case 'STATUS_CHANGED':
        return `Marked ${next?.status ? APPOINTMENT_STATUSES[next.status].label.toLowerCase() : 'changed'}`;
      case 'CANCELLED':
        return [
          next?.series ? 'Cancelled with the rest of the series' : 'Cancelled',
          next?.cancellationReason && CANCELLATION_REASONS[next.cancellationReason],
          next?.lateCancellation && 'late cancellation',
        ]
          .filter(Boolean)
          .join(' · ');
      case 'UPDATED':
        return `Changed ${(next?.fields ?? [])
          .map((f) =>
            f === 'internalNotes' ? 'internal notes' : f === 'type' ? 'appointment type' : f,
          )
          .join(' and ')}${next?.type ? ` to ${APPOINTMENT_TYPES[next.type].toLowerCase()}` : ''}`;
    }
  };
  return (
    <ol className="relative grid gap-4 border-l border-border pl-5">
      {history.map((h) => (
        <li key={h.id} className="relative">
          <span
            className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-primary"
            aria-hidden
          />
          <p className="text-sm">{describe(h)}</p>
          {h.reason && <p className="text-[13px] text-muted-foreground">“{h.reason}”</p>}
          <p className="text-xs text-muted-foreground">
            {h.performedBy.fullName} · {instant(h.createdAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** Internal notes and the appointment type; nothing that changes the schedule. */
function EditDialog({
  appointment: a,
  open,
  onOpenChange,
}: {
  appointment: AppointmentDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateAppointment();
  const [type, setType] = React.useState<AppointmentType>(a.type);
  const [notes, setNotes] = React.useState(a.internalNotes ?? '');
  const error = isApiError(update.error) ? update.error.errors?.internalNotes : undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit appointment</DialogTitle>
          <DialogDescription>
            To change the time, therapist or length, reschedule instead.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={type}
          onValueChange={(v) => setType(v as AppointmentType)}
          className="sm:grid-cols-2"
          aria-label="Appointment type"
        >
          <RadioCard value="THERAPY_SESSION" title="Therapy session" />
          <RadioCard value="ASSESSMENT" title="Assessment" />
        </RadioGroup>
        <Field label="Internal notes" optional error={error} helper="Visible to staff only.">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            maxLength={2000}
          />
        </Field>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            Cancel
          </Button>
          <Button
            loading={update.isPending}
            onClick={() =>
              update.mutate(
                { id: a.id, input: { type, internalNotes: notes } },
                {
                  onSuccess: () => {
                    toast.success('Appointment updated');
                    onOpenChange(false);
                  },
                  onError: (e) => !isApiError(e, 400) && toast.error(e.message),
                },
              )
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Everything about one appointment: when, who, what, its series and history, with the
 * actions it allows now. Used by the details page and the calendar's side sheet.
 */
/**
 * Chooses, changes or removes the package paying for an open appointment. The old one's
 * held session is given back; the new one must cover it like a new booking.
 */
function PackageDialog({
  appointment: a,
  open,
  onOpenChange,
}: {
  appointment: AppointmentDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const current = a.package?.coverage === 'HELD' ? a.package.enrollmentId : null;
  const [value, setValue] = React.useState<string | null>(current);
  const mutation = useSetAppointmentPackage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Package for this appointment</DialogTitle>
          <DialogDescription>
            The package holds one session until the appointment is completed or cancelled.
          </DialogDescription>
        </DialogHeader>
        <PackagePicker
          params={{
            patientId: a.patient.id,
            therapyTypeId: a.therapyType.id,
            type: a.type,
            date: a.date,
            appointmentId: a.id,
          }}
          value={value}
          onChange={setValue}
        />
        {isApiError(mutation.error) && (
          <p className="text-sm text-danger-foreground">{mutation.error.message}</p>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={value === current}
            onClick={() =>
              mutation.mutate(
                { id: a.id, packageEnrollmentId: value },
                {
                  onSuccess: () => {
                    toast.success(value ? 'Package set' : 'Package removed');
                    onOpenChange(false);
                  },
                },
              )
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AppointmentDetails({
  appointment: a,
  variant = 'page',
}: {
  appointment: AppointmentDetail;
  variant?: 'page' | 'sheet';
}) {
  const { can } = useSession();
  const fmt = useCenterFormat();
  const instant = useInstant();
  const { open, dialogs } = useAppointmentDialogs();
  const [editing, setEditing] = React.useState(false);
  const [choosingPackage, setChoosingPackage] = React.useState(false);
  // Dialogs are transient: close them when the page is hidden by a navigation.
  React.useLayoutEffect(() => () => setChoosingPackage(false), []);
  const actions = availableActions(a);
  const contact = a.primaryContact;
  const sheet = variant === 'sheet';

  // Assessment bookings lead to their clinical record: open it, or start one.
  const assessmentLink =
    a.type !== 'ASSESSMENT' || !can('assessments.read_own')
      ? null
      : a.assessment
        ? {
            href: assessmentLinks.detail(a.assessment.id),
            label: 'Open assessment',
            icon: ClipboardCheck,
          }
        : can('assessments.create') && a.status !== 'CANCELLED' && a.status !== 'NO_SHOW'
          ? {
              href: assessmentLinks.create({ appointmentId: a.id }),
              label: 'Start assessment',
              icon: ClipboardPlus,
            }
          : null;
  const assessmentButton = assessmentLink && (
    <Button size={sheet ? 'sm' : 'md'} asChild>
      <Link href={assessmentLink.href}>
        <assessmentLink.icon /> {assessmentLink.label}
      </Link>
    </Button>
  );

  const actionBar = actions.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {actions.map(({ action, label, icon: Icon, danger }) => (
        <Button
          key={action}
          size={sheet ? 'sm' : 'md'}
          variant={danger ? 'danger-ghost' : action === 'confirm' ? 'primary' : 'secondary'}
          onClick={() => open(action, a)}
        >
          <Icon /> {label}
        </Button>
      ))}
    </div>
  );

  const facts = (
    <dl className={cn('grid gap-4', !sheet && 'sm:grid-cols-2')}>
      <Detail label="When">
        <span className="tabular">
          {fmt.longDate(a.date)}
          <br />
          {fmt.range(a)} · {formatMinutes(a.durationMinutes)}
        </span>
      </Detail>
      <Detail label="Service">
        <span className="flex flex-col gap-0.5">
          <TherapyTypeChip therapyType={a.therapyType} full />
          <AppointmentTypeLabel type={a.type} />
        </span>
      </Detail>
      <Detail label="Patient">
        {can('patients.read') ? (
          <Link
            href={`/patients/${a.patient.id}`}
            className="rounded font-medium hover:underline focus-ring"
          >
            {a.patient.fullName}
          </Link>
        ) : (
          <span className="font-medium">{a.patient.fullName}</span>
        )}
        <span className="block text-[13px] text-muted-foreground">
          {a.patient.code}
          {a.patient.isDeleted && ' · deleted'}
          {a.patient.status === 'INACTIVE' && ' · inactive'}
        </span>
      </Detail>
      <Detail label="Therapist">
        {can('therapists.read') ? (
          <Link
            href={therapistLinks.profile(a.therapist.id)}
            className="rounded font-medium hover:underline focus-ring"
          >
            {a.therapist.fullName}
          </Link>
        ) : (
          <span className="font-medium">{a.therapist.fullName}</span>
        )}
        {a.therapist.isYou && <span className="text-[13px] text-muted-foreground"> (you)</span>}
      </Detail>
      {contact && (
        <Detail label="Contact">
          {contact.type === 'SELF' ? 'Patient' : `${contact.name}, ${relationshipLabel(contact)}`}
          {contact.mobile && (
            <a
              href={`tel:${contact.mobile}`}
              className="block tabular text-primary hover:underline"
            >
              {formatPhone(contact.mobile)}
            </a>
          )}
        </Detail>
      )}
      {a.type === 'ASSESSMENT' && can('assessments.read_own') && (
        <Detail label="Assessment record">
          {a.assessment ? ASSESSMENT_STATUSES[a.assessment.status].label : 'Not started'}
        </Detail>
      )}
      {(a.package || a.actions.changePackage) && (
        <Detail label="Package">
          {a.package ? (
            <span className="flex flex-col items-start gap-1">
              {can('package_enrollments.read') ? (
                <Link
                  href={packageLinks.enrollment(a.package.enrollmentId)}
                  className="rounded font-medium hover:underline focus-ring"
                >
                  {a.package.name}
                </Link>
              ) : (
                <span className="font-medium">{a.package.name}</span>
              )}
              <span className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                <Badge tone={COVERAGE[a.package.coverage].tone}>
                  {COVERAGE[a.package.coverage].label}
                </Badge>
                {a.package.chargeReason && CHARGE_REASONS[a.package.chargeReason]}
                {a.package.releaseReason && RELEASE_REASONS[a.package.releaseReason]}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">None: paid per session</span>
          )}
          {a.actions.changePackage && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => setChoosingPackage(true)}
            >
              {a.package?.coverage === 'HELD' ? 'Change package' : 'Choose a package'}
            </Button>
          )}
        </Detail>
      )}
      {a.series && (
        <Detail label="Recurring">
          {a.series.position &&
            `Session ${a.series.position.index} of ${a.series.position.total} · `}
          {describeRule(a.series.rule, fmt.weekStartsOn, fmt.date)}
          {a.series.status === 'CANCELLED' && ' · remaining cancelled'}
        </Detail>
      )}
      {a.status === 'CANCELLED' && (
        <Detail label="Cancellation" className={cn(!sheet && 'sm:col-span-2')}>
          {[
            a.cancellationReason && CANCELLATION_REASONS[a.cancellationReason],
            a.lateCancellation && 'Late cancellation',
          ]
            .filter(Boolean)
            .join(' · ')}
          {a.cancellationNote && (
            <span className="block text-muted-foreground">“{a.cancellationNote}”</span>
          )}
          {a.cancelledBy && a.cancelledAt && (
            <span className="block text-xs text-muted-foreground">
              {a.cancelledBy.fullName} · {instant(a.cancelledAt)}
            </span>
          )}
        </Detail>
      )}
      <Detail label="Internal notes" className={cn(!sheet && 'sm:col-span-2')}>
        {a.internalNotes}
      </Detail>
      <Detail label="Booked">
        {a.createdBy.fullName} · {instant(a.createdAt)}
      </Detail>
      {a.allowOverlap && (
        <Detail label="Double booking">Booked over a clash with another appointment</Detail>
      )}
    </dl>
  );

  const editButton = a.actions.edit && (
    <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
      <Pencil /> Edit
    </Button>
  );

  if (sheet) {
    return (
      <>
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <AppointmentStatusBadge status={a.status} />
            {editButton}
            <Button variant="ghost" size="sm" asChild className="ml-auto">
              <Link href={appointmentLinks.detail(a.id)}>
                <ExternalLink /> Full page
              </Link>
            </Button>
          </div>
          {assessmentButton}
          {actionBar}
          {facts}
          <section className="grid gap-3">
            <h3 className="text-card-title">History</h3>
            <HistoryTimeline history={a.history} />
          </section>
        </div>
        {editing && <EditDialog appointment={a} open onOpenChange={setEditing} />}
        {choosingPackage && (
          <PackageDialog appointment={a} open onOpenChange={setChoosingPackage} />
        )}
        {dialogs}
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: appointmentLinks.list, label: 'Appointments' }}
        title={`${a.patient.fullName}`}
        description={`${APPOINTMENT_TYPES[a.type]} · ${a.therapyType.name} · ${fmt.shortDate(a.date)}, ${fmt.range(a)}`}
        meta={<AppointmentStatusBadge status={a.status} />}
        actions={
          <>
            {editButton}
            {assessmentButton}
            {actionBar}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <Card>
          <CardHeader>
            <CardTitle>Appointment</CardTitle>
          </CardHeader>
          <CardContent>{facts}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <HistoryTimeline history={a.history} />
          </CardContent>
        </Card>
      </div>
      {editing && <EditDialog appointment={a} open onOpenChange={setEditing} />}
      {choosingPackage && <PackageDialog appointment={a} open onOpenChange={setChoosingPackage} />}
      {dialogs}
    </>
  );
}

const notFound = (
  <Card>
    <EmptyState
      icon={CalendarSearch}
      title="Appointment not found"
      description="It may belong to another center, or the link is wrong."
      action={
        <Button variant="secondary" size="sm" asChild>
          <Link href={appointmentLinks.list}>Back to appointments</Link>
        </Button>
      }
    />
  </Card>
);

function AppointmentPage() {
  const { id } = useParams<{ id: string }>();
  const query = useAppointment(id);
  useBreadcrumbLabel(id, query.data?.patient.fullName);
  if (query.isPending) return <PageSkeleton />;
  if (query.error) {
    return isApiError(query.error, 404) || isApiError(query.error, 400) ? (
      notFound
    ) : (
      <Card>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Card>
    );
  }
  return (
    <div className="animate-in">
      <AppointmentDetails appointment={query.data} />
    </div>
  );
}

export function AppointmentDetailsScreen() {
  return (
    <RequirePermission permission="appointments.read_own">
      <AppointmentPage />
    </RequirePermission>
  );
}

/** Details in a side sheet, e.g. from the calendar, without leaving the page. */
export function AppointmentSheet({
  id,
  onOpenChange,
}: {
  id: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const query = useAppointment(id ?? undefined);
  const a = query.data;
  return (
    <Sheet open={Boolean(id)} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{a ? a.patient.fullName : 'Appointment'}</SheetTitle>
          <SheetDescription>
            {a ? `${APPOINTMENT_TYPES[a.type]} · ${a.therapyType.name}` : 'Loading…'}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {query.isPending ? (
            <div className="grid gap-3">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : query.error ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <AppointmentDetails appointment={a!} variant="sheet" />
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
