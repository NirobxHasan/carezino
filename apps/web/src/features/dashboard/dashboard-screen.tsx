'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  ClipboardCheck,
  CircleAlert,
  Info,
  Receipt,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';

import { KpiCard } from '@/components/domain/kpi-card';
import { TherapistStatusBadge } from '@/components/domain/status-badges';
import { TherapyTypeTag } from '@/components/domain/therapy-type';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { SegmentedList, SegmentedTrigger, Tabs } from '@/components/ui/tabs';
import { AppointmentCard } from './prototype/appointment-card';
import { paymentMethodLabels } from '@/lib/api/finance';
import { useDashboard, type DashboardAlert } from '@/lib/api/dashboard';
import { formatAgo, formatRelativeDay, formatTaka, formatTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

function greeting(date: Date) {
  const h = date.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function DashboardScreen() {
  const { user, role, can, activeCenter } = useSession();
  const therapistId = role === 'THERAPIST' ? user.therapistId : undefined;
  const { data, isLoading, error, refetch } = useDashboard({ therapistId });
  const [filterChoice, setFilter] = React.useState<'remaining' | 'all' | 'done' | null>(null);
  const now = new Date();
  const finance = can('finance.view');

  const sessions = data?.todaySessions ?? [];
  const live = sessions.filter((a) => a.status !== 'cancelled');
  const remaining = sessions.filter((a) => ['scheduled', 'checked_in'].includes(a.status));
  // Default to what's left today; after hours, show the whole day instead of an empty list.
  const filter = filterChoice ?? (remaining.length || isLoading ? 'remaining' : 'all');
  const visibleSessions = sessions.filter((a) =>
    filter === 'all'
      ? true
      : filter === 'done'
        ? ['completed', 'no_show', 'cancelled'].includes(a.status)
        : ['scheduled', 'checked_in'].includes(a.status),
  );

  return (
    <div className="animate-in">
      <PageHeader
        title={`${greeting(now)}, ${user.name.split(' ')[0]}`}
        description={`${format(now, 'EEEE, d MMMM')} · ${activeCenter.name}`}
        actions={
          <>
            {can('patients.create') && (
              <Button variant="secondary" asChild>
                <Link href="/patients/new">
                  <UserPlus /> Register patient
                </Link>
              </Button>
            )}
            {can('appointments.create') ? (
              <Button asChild>
                <Link href="/appointments/new">
                  <CalendarPlus /> Book appointment
                </Link>
              </Button>
            ) : (
              <Button variant="secondary" asChild>
                <Link href="/appointments">
                  <CalendarDays /> My schedule
                </Link>
              </Button>
            )}
          </>
        }
      />

      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          <section
            aria-label="Key figures"
            className={cn(
              'grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3',
              finance ? '2xl:grid-cols-6' : 'xl:grid-cols-4',
            )}
          >
            <KpiCard
              label={therapistId ? 'My sessions today' : 'Today’s appointments'}
              value={data?.kpis.todayAppointments ?? 0}
              hint={`${remaining.length} still to come`}
              icon={CalendarDays}
              tone="primary"
              href="/appointments"
              loading={isLoading}
            />
            <KpiCard
              label="Completed sessions"
              value={data?.kpis.completedToday ?? 0}
              hint="Today so far"
              icon={CalendarCheck2}
              tone="success"
              loading={isLoading}
            />
            <KpiCard
              label="Active patients"
              value={data?.kpis.activePatients ?? 0}
              hint={`${data?.kpis.newPatientsThisMonth ?? 0} new this month`}
              icon={Users}
              href="/patients"
              loading={isLoading}
            />
            {finance && (
              <KpiCard
                label="Today’s collection"
                value={formatTaka(data?.kpis.todayCollection ?? 0)}
                hint={`${data?.kpis.todayPaymentsCount ?? 0} payments received`}
                icon={Wallet}
                tone="success"
                href="/finance?tab=payments"
                loading={isLoading}
              />
            )}
            {finance && (
              <KpiCard
                label="Pending payments"
                value={formatTaka(data?.kpis.pendingAmount ?? 0)}
                hint={`${data?.kpis.pendingInvoices ?? 0} unpaid invoices`}
                icon={Receipt}
                tone="warning"
                href="/finance?tab=dues"
                loading={isLoading}
              />
            )}
            <KpiCard
              label="Upcoming appointments"
              value={data?.kpis.upcomingAppointments ?? 0}
              hint="Next 7 days"
              icon={CalendarClock}
              href="/appointments/calendar"
              loading={isLoading}
            />
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex-wrap border-b border-border pb-4">
                <div>
                  <CardTitle>{therapistId ? 'My sessions today' : 'Today’s sessions'}</CardTitle>
                  <CardDescription>
                    {live.length} booked · {live.filter((s) => s.status === 'completed').length}{' '}
                    completed · {remaining.length} remaining
                  </CardDescription>
                </div>
                <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                  <SegmentedList aria-label="Filter sessions">
                    <SegmentedTrigger value="remaining">Remaining</SegmentedTrigger>
                    <SegmentedTrigger value="done">Done</SegmentedTrigger>
                    <SegmentedTrigger value="all">All</SegmentedTrigger>
                  </SegmentedList>
                </Tabs>
              </CardHeader>
              {isLoading ? (
                <CardContent className="pt-4">
                  <ListSkeleton rows={5} />
                </CardContent>
              ) : visibleSessions.length === 0 ? (
                <EmptyState
                  icon={CalendarCheck2}
                  title={filter === 'remaining' ? 'No more sessions today' : 'Nothing to show'}
                  description={
                    filter === 'remaining'
                      ? 'Every session today is done or cancelled.'
                      : 'No sessions match this filter.'
                  }
                />
              ) : (
                <div className="max-h-[560px] divide-y divide-border overflow-y-auto">
                  {visibleSessions.map((a) => (
                    <AppointmentCard key={a.id} appointment={a} showTherapist={!therapistId} />
                  ))}
                </div>
              )}
            </Card>

            <div className="space-y-6">
              <AlertsCard alerts={data?.alerts} loading={isLoading} />
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>{therapistId ? 'My day' : 'Therapist availability'}</CardTitle>
                    <CardDescription>Booked hours today</CardDescription>
                  </div>
                  {!therapistId && (
                    <Button variant="link" size="sm" asChild>
                      <Link href="/therapists">All</Link>
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <ListSkeleton rows={4} />
                  ) : (
                    <ul className="space-y-4">
                      {data?.availability.map((t) => (
                        <li key={t.id} className="flex items-start gap-3">
                          <Avatar name={t.name} size="sm" className="mt-0.5" />
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <Link
                                href={`/therapists/${t.id}`}
                                className="truncate rounded text-sm font-medium hover:underline focus-ring"
                              >
                                {t.name}
                              </Link>
                              {t.status === 'active' ? (
                                <span className="text-xs text-muted-foreground tabular">
                                  {t.booked}/{t.capacity}
                                </span>
                              ) : (
                                <TherapistStatusBadge status={t.status} />
                              )}
                            </div>
                            {t.status === 'active' && (
                              <>
                                <Progress
                                  value={t.booked}
                                  max={Math.max(t.capacity, 1)}
                                  label={`${t.name}: ${t.booked} of ${t.capacity} hours booked`}
                                  tone={t.booked >= t.capacity ? 'warning' : 'primary'}
                                />
                                <p className="truncate text-xs text-muted-foreground">
                                  {t.current
                                    ? `In session with ${t.current.patientName} until ${formatTime(t.current.until)}`
                                    : t.dayOver
                                      ? 'Finished for today'
                                      : t.nextFree
                                        ? `Next free at ${formatTime(t.nextFree)}`
                                        : 'Fully booked for the rest of today'}
                                </p>
                              </>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <div className={cn('grid gap-6', finance && 'lg:grid-cols-2')}>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Upcoming assessments</CardTitle>
                  <CardDescription>Next 14 days</CardDescription>
                </div>
              </CardHeader>
              {isLoading ? (
                <CardContent>
                  <ListSkeleton rows={3} />
                </CardContent>
              ) : !data?.upcomingAssessments.length ? (
                <EmptyState compact icon={ClipboardCheck} title="No assessments scheduled" />
              ) : (
                <ul className="divide-y divide-border border-t border-border">
                  {data.upcomingAssessments.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                      <Avatar name={a.patient.fullName} size="sm" />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/patients/${a.patientId}`}
                          className="truncate rounded text-sm font-medium hover:underline focus-ring"
                        >
                          {a.patient.fullName}
                        </Link>
                        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <TherapyTypeTag id={a.therapyTypeId} className="text-xs" />
                          <span>with {a.therapist.name}</span>
                        </p>
                      </div>
                      <div className="text-right text-xs tabular">
                        <p className="font-medium">{formatRelativeDay(a.start)}</p>
                        <p className="text-muted-foreground">{formatTime(a.start)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {finance && (
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Recent payments</CardTitle>
                    <CardDescription>Latest money received</CardDescription>
                  </div>
                  <Button variant="link" size="sm" asChild>
                    <Link href="/finance?tab=payments">View all</Link>
                  </Button>
                </CardHeader>
                {isLoading ? (
                  <CardContent>
                    <ListSkeleton rows={3} />
                  </CardContent>
                ) : (
                  <ul className="divide-y divide-border border-t border-border">
                    {data?.recentPayments.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{p.patient.fullName}</p>
                          <p className="text-xs text-muted-foreground">
                            {paymentMethodLabels[p.method]} · {formatAgo(p.receivedAt)} ·{' '}
                            {p.receivedBy}
                          </p>
                        </div>
                        <p className="text-sm font-medium tabular">{formatTaka(p.amount)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const alertIcon = { warning: AlertTriangle, danger: CircleAlert, info: Info };

function AlertsCard({ alerts, loading }: { alerts?: DashboardAlert[]; loading: boolean }) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Needs attention</CardTitle>
        </CardHeader>
        <CardContent>
          <ListSkeleton rows={2} />
        </CardContent>
      </Card>
    );
  }
  if (!alerts?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
      </CardHeader>
      <ul className="space-y-1 px-2 pb-3">
        {alerts.map((alert) => {
          const Icon = alertIcon[alert.tone];
          return (
            <li key={alert.id}>
              <Link
                href={alert.href}
                className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/60 focus-ring"
              >
                <Icon
                  className={cn(
                    'mt-0.5 size-4 shrink-0',
                    alert.tone === 'warning' && 'text-warning',
                    alert.tone === 'danger' && 'text-danger',
                    alert.tone === 'info' && 'text-info',
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{alert.title}</span>
                  <span className="block text-xs text-muted-foreground">{alert.description}</span>
                </span>
                <ArrowRight
                  className="mt-0.5 size-4 shrink-0 text-subtle-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
