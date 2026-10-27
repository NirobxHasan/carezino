'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CalendarSearch, ListChecks, Pencil } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { useBreadcrumbLabel } from '@/components/layout/breadcrumbs';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isApiError } from '@/lib/api/client';
import { useSessionDetail } from '@/lib/api/sessions';
import { useSession } from '@/lib/session';
import { formatMinutes } from '@/lib/settings-limits';
import type { SessionDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { HistoryTimeline } from '../appointments/appointment-details';
import {
  APPOINTMENT_TYPES,
  AppointmentStatusBadge,
  TherapyTypeChip,
  appointmentLinks,
  useCenterFormat,
} from '../appointments/appointment-display';
import {
  CHARGE_REASONS,
  COVERAGE,
  RELEASE_REASONS,
  packageLinks,
  useInstant,
} from '../packages/package-display';
import { PlanStatusBadge, planLinks } from '../therapy-plans/plan-display';
import { availableSessionActions, noteLink, useSessionDialogs } from './session-actions';
import {
  AttendanceBadge,
  NoteStatusBadge,
  SessionStatusBadge,
  sessionLinks,
} from './session-display';

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

/**
 * One session: when and who, attendance, the session's own lifecycle, its note, plan
 * and package, and the appointment's history, with the actions it allows now.
 */
function SessionView({ session: s }: { session: SessionDetail }) {
  const { can } = useSession();
  const fmt = useCenterFormat();
  const instant = useInstant();
  const { open, dialogs, busyId } = useSessionDialogs();
  const actions = availableSessionActions(s);
  const note = noteLink(s);
  const by = (who: { fullName: string } | null, at: string | null) =>
    at ? `${who?.fullName ?? 'Someone'} · ${instant(at)}` : null;
  const closed = s.status === 'CANCELLED' || s.status === 'NO_SHOW';
  const attended = s.attendance.status === 'PRESENT' || s.attendance.status === 'LATE';
  // Times and the note while the appointment is open; afterwards it's a correction.
  const editAttendance =
    !closed && s.status !== 'COMPLETED' && attended && can('attendance.record');

  return (
    <>
      <PageHeader
        back={{
          href: can('sessions.read') ? sessionLinks.today : sessionLinks.mine,
          label: can('sessions.read') ? 'Today’s sessions' : 'My sessions',
        }}
        title={s.patient.fullName}
        description={`${APPOINTMENT_TYPES[s.type]} · ${s.therapyType.name} · ${fmt.shortDate(s.date)}, ${fmt.range(s)} · ${s.therapist.fullName}`}
        meta={
          <>
            <AttendanceBadge status={s.attendance.status} />
            {closed ? (
              <AppointmentStatusBadge status={s.status} />
            ) : (
              <SessionStatusBadge status={s.sessionStatus} />
            )}
            {s.type === 'THERAPY_SESSION' && (
              <NoteStatusBadge state={s.noteStatus} pending={s.notePending} />
            )}
          </>
        }
        actions={
          <>
            {note && (
              <Button asChild>
                <Link href={sessionLinks.note(s.id)}>
                  <note.icon /> {note.label}
                </Link>
              </Button>
            )}
            {actions.map(({ action, label, icon: Icon, danger }) => (
              <Button
                key={action}
                variant={
                  danger
                    ? 'danger-ghost'
                    : action === 'checkIn' || (action === 'complete' && !note)
                      ? 'primary'
                      : 'secondary'
                }
                loading={
                  busyId === s.id &&
                  ['checkIn', 'markPresent', 'markLate', 'start'].includes(action)
                }
                onClick={() => open(action, s)}
              >
                <Icon /> {label}
              </Button>
            ))}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>Attendance</CardTitle>
              {editAttendance && (
                <Button variant="ghost" size="sm" onClick={() => open('editAttendance', s)}>
                  <Pencil /> Times and note
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-3">
                <Detail label="Attendance">
                  <AttendanceBadge status={s.attendance.status} />
                </Detail>
                <Detail label="Arrived">
                  {s.attendance.checkInTime && fmt.clock(s.attendance.checkInTime)}
                </Detail>
                <Detail label="Actual session">
                  {s.attendance.actualStartTime &&
                    `${fmt.clock(s.attendance.actualStartTime)}${s.attendance.actualEndTime ? ` – ${fmt.clock(s.attendance.actualEndTime)}` : ''}`}
                </Detail>
                <Detail label="Note" className="sm:col-span-2">
                  {s.attendance.note}
                </Detail>
                <Detail label="Recorded">
                  {by(s.attendance.recordedBy, s.attendance.recordedAt)}
                </Detail>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Session</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-3">
                <Detail label="Booked">
                  <span className="tabular">
                    {fmt.range(s)} · {formatMinutes(s.durationMinutes)}
                  </span>
                </Detail>
                <Detail label="Service">
                  <TherapyTypeChip therapyType={s.therapyType} full />
                </Detail>
                <Detail label="Therapist">
                  {s.therapist.fullName}
                  {s.therapist.isYou && <span className="text-muted-foreground"> (you)</span>}
                </Detail>
                <Detail label="Started">{by(s.session.startedBy, s.session.startedAt)}</Detail>
                <Detail label="Completed">
                  {by(s.session.completedBy, s.session.completedAt)}
                </Detail>
                {s.session.voidedAt && (
                  <Detail label="Voided">
                    {by(s.session.voidedBy, s.session.voidedAt)}
                    {s.session.voidReason && (
                      <span className="block text-muted-foreground">“{s.session.voidReason}”</span>
                    )}
                  </Detail>
                )}
              </dl>
            </CardContent>
          </Card>

          {s.type === 'THERAPY_SESSION' && (
            <Card>
              <CardHeader>
                <CardTitle>Session note</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {s.note ? (
                  <dl className="grid gap-4 sm:grid-cols-3">
                    <Detail label="Status">
                      <NoteStatusBadge state={s.note.status} pending={s.notePending} />
                    </Detail>
                    <Detail label="Therapist">{s.note.therapist.fullName}</Detail>
                    <Detail label="Signed">
                      {s.note.completedAt
                        ? by(s.note.completedBy, s.note.completedAt)
                        : 'Not signed yet'}
                    </Detail>
                  </dl>
                ) : (
                  <p className="text-[13px] text-muted-foreground">
                    {closed
                      ? 'No note: the session didn’t take place.'
                      : 'No note has been started yet.'}
                  </p>
                )}
                {note ? (
                  <Button variant="secondary" size="sm" className="w-fit" asChild>
                    <Link href={sessionLinks.note(s.id)}>
                      <note.icon /> {note.label}
                    </Link>
                  </Button>
                ) : (
                  s.note && (
                    <p className="text-xs text-muted-foreground">
                      Note content is visible to the treating therapists and administrators.
                    </p>
                  )
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="grid content-start gap-4">
          {(s.plan || s.package) && (
            <Card>
              <CardHeader>
                <CardTitle>Plan and package</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4">
                  {s.plan && (
                    <Detail label="Therapy plan">
                      <span className="flex flex-col items-start gap-1">
                        <Link
                          href={planLinks.detail(s.plan.id)}
                          className="inline-flex items-center gap-1.5 rounded font-medium hover:underline focus-ring"
                        >
                          <ListChecks className="size-3.5" aria-hidden />
                          {s.plan.code} · {s.plan.title}
                        </Link>
                        <PlanStatusBadge status={s.plan.status} />
                      </span>
                    </Detail>
                  )}
                  {s.package && (
                    <Detail label="Package">
                      <span className="flex flex-col items-start gap-1">
                        {can('package_enrollments.read') ? (
                          <Link
                            href={packageLinks.enrollment(s.package.enrollmentId)}
                            className="rounded font-medium hover:underline focus-ring"
                          >
                            {s.package.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{s.package.name}</span>
                        )}
                        <span className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                          <Badge tone={COVERAGE[s.package.coverage].tone}>
                            {COVERAGE[s.package.coverage].label}
                          </Badge>
                          {s.package.chargeReason && CHARGE_REASONS[s.package.chargeReason]}
                          {s.package.releaseReason && RELEASE_REASONS[s.package.releaseReason]}
                        </span>
                      </span>
                    </Detail>
                  )}
                </dl>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>History</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link href={appointmentLinks.detail(s.id)}>
                  <CalendarSearch /> Appointment
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              <HistoryTimeline history={s.history} />
            </CardContent>
          </Card>
        </div>
      </div>
      {dialogs}
    </>
  );
}

function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const query = useSessionDetail(id);
  useBreadcrumbLabel(id, query.data?.patient.fullName);
  if (query.isPending) return <PageSkeleton />;
  if (query.error) {
    return (
      <Card>
        {isApiError(query.error, 404) || isApiError(query.error, 400) ? (
          <EmptyState
            icon={CalendarSearch}
            title="Session not found"
            description="It may belong to another center or another therapist, or the link is wrong."
            action={
              <Button variant="secondary" size="sm" asChild>
                <Link href={sessionLinks.list}>Back to sessions</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </Card>
    );
  }
  return (
    <div className="animate-in">
      <SessionView session={query.data} />
    </div>
  );
}

export function SessionDetailsScreen() {
  return (
    <RequirePermission permission="sessions.read_own">
      <SessionPage />
    </RequirePermission>
  );
}
