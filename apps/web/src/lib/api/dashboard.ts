'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfDay,
  isSameDay,
  parseISO,
  startOfDay,
  startOfMonth,
  subMonths,
  format,
} from 'date-fns';

import type { AppNotification, ID, TherapistStatus } from '../types';
import { backend, clone, latency } from './client';
import { keys } from './keys';
import { patientRef, therapistRef } from './refs';
import type { AppointmentWithRefs } from './prototype-appointments';
import type { PaymentWithRefs } from './finance';
import { capacityFor, workingWindow } from './prototype-therapists';

export interface TherapistAvailability {
  id: ID;
  name: string;
  status: TherapistStatus | 'off_today';
  booked: number;
  capacity: number;
  nextFree?: string;
  /** Past the end of today's working hours */
  dayOver: boolean;
  current?: { patientName: string; until: string };
}

export interface DashboardAlert {
  id: string;
  tone: 'warning' | 'danger' | 'info';
  title: string;
  description: string;
  href: string;
}

export interface DashboardData {
  kpis: {
    todayAppointments: number;
    completedToday: number;
    activePatients: number;
    newPatientsThisMonth: number;
    todayCollection: number;
    todayPaymentsCount: number;
    pendingAmount: number;
    pendingInvoices: number;
    upcomingAppointments: number;
  };
  todaySessions: AppointmentWithRefs[];
  availability: TherapistAvailability[];
  upcomingAssessments: AppointmentWithRefs[];
  recentPayments: PaymentWithRefs[];
  alerts: DashboardAlert[];
}

export async function getDashboard(params: { therapistId?: ID }): Promise<DashboardData> {
  await latency(350);
  const db = backend();
  const now = new Date();
  const today = startOfDay(now);
  const mine = (therapistId: ID) => !params.therapistId || therapistId === params.therapistId;
  const withRefs = (a: (typeof db.appointments)[number]) => ({
    ...a,
    patient: patientRef(db, a.patientId),
    therapist: therapistRef(db, a.therapistId),
  });

  const todays = db.appointments.filter(
    (a) => isSameDay(parseISO(a.start), today) && mine(a.therapistId),
  );
  const live = todays.filter((a) => a.status !== 'cancelled');
  const paymentsToday = db.payments.filter((p) => isSameDay(parseISO(p.receivedAt), today));
  const outstanding = db.invoices.filter((i) => i.status !== 'void' && i.total > i.paid);
  const nextWeek = addDays(today, 8);

  const availability: TherapistAvailability[] = db.therapists
    .filter((t) => t.status !== 'inactive' && mine(t.id))
    .map((t) => {
      const window = workingWindow(t, now);
      const theirs = db.appointments
        .filter(
          (a) =>
            a.therapistId === t.id && a.status !== 'cancelled' && isSameDay(parseISO(a.start), now),
        )
        .sort((a, b) => a.start.localeCompare(b.start));
      const current = theirs.find((a) => parseISO(a.start) <= now && parseISO(a.end) > now);
      let nextFree: string | undefined;
      if (window) {
        for (
          let h = Math.max(now.getHours() + 1, window.start.getHours());
          h < window.end.getHours();
          h++
        ) {
          if (h === 13) continue;
          const slot = new Date(today);
          slot.setHours(h);
          if (!theirs.some((a) => parseISO(a.start).getHours() === h)) {
            nextFree = slot.toISOString();
            break;
          }
        }
      }
      return {
        id: t.id,
        name: t.name,
        status: t.status === 'on_leave' ? 'on_leave' : window ? 'active' : 'off_today',
        booked: theirs.length,
        capacity: capacityFor(t, now),
        nextFree,
        dayOver: Boolean(window && now >= window.end),
        current: current
          ? { patientName: patientRef(db, current.patientId).fullName, until: current.end }
          : undefined,
      };
    });

  const alerts: DashboardAlert[] = [];
  const pendingNotes = db.appointments.filter(
    (a) =>
      a.status === 'completed' &&
      a.noteStatus !== 'submitted' &&
      differenceInCalendarDays(now, parseISO(a.start)) <= 14 &&
      mine(a.therapistId),
  ).length;
  if (pendingNotes) {
    alerts.push({
      id: 'notes',
      tone: 'warning',
      title: `${pendingNotes} session note${pendingNotes === 1 ? '' : 's'} pending`,
      description: 'Completed sessions from the last 14 days without a submitted note.',
      href: '/sessions?note=PENDING',
    });
  }
  if (!params.therapistId) {
    const expiring = db.patientPackages.filter((p) => {
      const days = differenceInCalendarDays(parseISO(p.expiresAt), now);
      return p.status === 'active' && days >= 0 && days <= 7;
    }).length;
    const lowBalance = db.patientPackages.filter(
      (p) => p.status === 'active' && p.totalSessions - p.usedSessions <= 2,
    ).length;
    const overdue = outstanding.filter((i) => i.status === 'overdue');
    if (overdue.length) {
      alerts.push({
        id: 'overdue',
        tone: 'danger',
        title: `${overdue.length} overdue invoice${overdue.length === 1 ? '' : 's'}`,
        description: `৳${overdue.reduce((s, i) => s + i.total - i.paid, 0).toLocaleString('en-IN')} past the due date.`,
        href: '/finance?tab=dues',
      });
    }
    if (expiring) {
      alerts.push({
        id: 'expiring',
        tone: 'warning',
        title: `${expiring} package${expiring === 1 ? '' : 's'} expiring this week`,
        description: 'Renew with the family before the last session.',
        href: '/packages?tab=patients',
      });
    }
    if (lowBalance) {
      alerts.push({
        id: 'low',
        tone: 'info',
        title: `${lowBalance} package${lowBalance === 1 ? '' : 's'} with 2 or fewer sessions left`,
        description: 'Good time to discuss renewal.',
        href: '/packages?tab=patients',
      });
    }
    const onLeave = db.therapists.filter((t) => t.status === 'on_leave');
    for (const t of onLeave) {
      alerts.push({
        id: `leave_${t.id}`,
        tone: 'info',
        title: `${t.name} is on leave`,
        description: 'Not available for new bookings until marked active.',
        href: `/therapists/${t.id}`,
      });
    }
  }

  return clone({
    kpis: {
      todayAppointments: live.length,
      completedToday: live.filter((a) => a.status === 'completed').length,
      activePatients: db.patients.filter((p) => p.status === 'active').length,
      newPatientsThisMonth: db.patients.filter((p) => parseISO(p.registeredAt) >= startOfMonth(now))
        .length,
      todayCollection: paymentsToday.reduce((s, p) => s + p.amount, 0),
      todayPaymentsCount: paymentsToday.length,
      pendingAmount: outstanding.reduce((s, i) => s + i.total - i.paid, 0),
      pendingInvoices: outstanding.length,
      upcomingAppointments: db.appointments.filter((a) => {
        const s = parseISO(a.start);
        return a.status === 'scheduled' && s > endOfDay(now) && s < nextWeek && mine(a.therapistId);
      }).length,
    },
    todaySessions: todays.sort((a, b) => a.start.localeCompare(b.start)).map(withRefs),
    availability,
    upcomingAssessments: db.appointments
      .filter(
        (a) =>
          a.kind === 'assessment' &&
          a.status === 'scheduled' &&
          parseISO(a.start) >= today &&
          parseISO(a.start) < addDays(today, 15) &&
          mine(a.therapistId),
      )
      .sort((a, b) => a.start.localeCompare(b.start))
      .map(withRefs),
    recentPayments: [...db.payments]
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, 6)
      .map((p) => ({ ...p, patient: patientRef(db, p.patientId) })),
    alerts,
  });
}

// ── Reports ─────────────────────────────────────────────────────────────────

export interface ReportData {
  sessions: { therapyTypeId: ID; completed: number; cancelled: number; noShow: number }[];
  attendanceRate: number;
  totalCompleted: number;
  newPatients: number;
  utilisation: { therapistId: ID; name: string; completed: number; capacity: number }[];
  monthly: { month: string; collected: number; expenses: number }[];
  revenueByType: { therapyTypeId: ID; amount: number }[];
}

export async function getReport(params: { from: string; to: string }): Promise<ReportData> {
  await latency(400);
  const db = backend();
  const from = parseISO(params.from);
  const to = parseISO(params.to);
  const inRange = (iso: string) => {
    const d = parseISO(iso);
    return d >= from && d < to;
  };
  const appts = db.appointments.filter((a) => inRange(a.start) && parseISO(a.end) < new Date());
  const sessions = db.therapyTypes
    .filter((t) => t.active)
    .map((t) => {
      const mine = appts.filter((a) => a.therapyTypeId === t.id);
      return {
        therapyTypeId: t.id,
        completed: mine.filter((a) => a.status === 'completed').length,
        cancelled: mine.filter((a) => a.status === 'cancelled').length,
        noShow: mine.filter((a) => a.status === 'no_show').length,
      };
    });
  const totalCompleted = sessions.reduce((s, x) => s + x.completed, 0);
  const totalBooked = sessions.reduce((s, x) => s + x.completed + x.cancelled + x.noShow, 0);
  const days = eachDayOfInterval({ start: from, end: addDays(to, -1) }).filter(
    (d) => d < new Date(),
  );
  const utilisation = db.therapists
    .filter((t) => t.status !== 'inactive')
    .map((t) => ({
      therapistId: t.id,
      name: t.name,
      completed: appts.filter((a) => a.therapistId === t.id && a.status === 'completed').length,
      capacity: days.reduce((s, d) => s + capacityFor(t, d), 0),
    }));
  const monthly = Array.from({ length: 6 }, (_, i) => {
    const start = startOfMonth(subMonths(new Date(), 5 - i));
    const end = startOfMonth(subMonths(new Date(), 4 - i));
    const within = (iso: string) => {
      const d = parseISO(iso);
      return d >= start && d < end;
    };
    return {
      month: format(start, 'MMM'),
      collected: db.payments.filter((p) => within(p.receivedAt)).reduce((s, p) => s + p.amount, 0),
      expenses: db.expenses.filter((e) => within(e.date)).reduce((s, e) => s + e.amount, 0),
    };
  });
  const revenueByType = db.therapyTypes
    .filter((t) => t.active)
    .map((t) => ({
      therapyTypeId: t.id,
      amount: db.payments
        .filter((p) => inRange(p.receivedAt))
        .filter((p) => {
          const inv = db.invoices.find((i) => i.id === p.invoiceId);
          const pkg = inv && db.patientPackages.find((pp) => pp.id === inv.patientPackageId);
          return pkg?.therapyTypeId === t.id;
        })
        .reduce((s, p) => s + p.amount, 0),
    }));

  return clone({
    sessions,
    attendanceRate: totalBooked ? totalCompleted / totalBooked : 0,
    totalCompleted,
    newPatients: db.patients.filter((p) => inRange(`${p.registeredAt}T00:00:00`)).length,
    utilisation,
    monthly,
    revenueByType,
  });
}

// ── Notifications ───────────────────────────────────────────────────────────

export async function listNotifications(): Promise<AppNotification[]> {
  await latency(150);
  return clone(backend().notifications);
}

export async function markNotificationsRead() {
  await latency(150);
  for (const n of backend().notifications) n.read = true;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function useDashboard(params: { therapistId?: ID }) {
  return useQuery({
    queryKey: keys.dashboard(params),
    queryFn: () => getDashboard(params),
    refetchInterval: 60_000,
  });
}

export function useReport(params: { from: string; to: string }) {
  return useQuery({ queryKey: keys.reports(params), queryFn: () => getReport(params) });
}

export function useNotifications() {
  return useQuery({ queryKey: keys.notifications, queryFn: listNotifications });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
}
