'use client';

/**
 * Prototype appointments on the in-memory mock store, kept for the dashboard prototype
 * until it moves to the API. Real appointments live in ./appointments.ts.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, addMinutes, areIntervalsOverlapping, parseISO } from 'date-fns';

import type {
  Appointment,
  AppointmentStatus,
  BookingRequest,
  ID,
  ISODate,
  TimeSlot,
} from '../types';
import type { MockDb } from '../mock/seed';
import { backend, clone, latency, uid } from './client';
import { keys } from './keys';
import { patientRef, therapistRef, type PatientRef, type TherapistRef } from './refs';
import { workingWindow } from './prototype-therapists';

export type AppointmentWithRefs = Appointment & { patient: PatientRef; therapist: TherapistRef };

export interface AppointmentListParams {
  from?: string;
  to?: string;
  therapistIds?: ID[];
  therapyTypeIds?: ID[];
  patientId?: ID;
  statuses?: AppointmentStatus[];
  kind?: Appointment['kind'];
}

function withRefs(db: MockDb, a: Appointment): AppointmentWithRefs {
  return { ...a, patient: patientRef(db, a.patientId), therapist: therapistRef(db, a.therapistId) };
}

export async function listAppointments(
  params: AppointmentListParams = {},
): Promise<AppointmentWithRefs[]> {
  await latency();
  const db = backend();
  const from = params.from ? parseISO(params.from) : undefined;
  const to = params.to ? parseISO(params.to) : undefined;
  return clone(
    db.appointments
      .filter((a) => {
        const start = parseISO(a.start);
        if (from && start < from) return false;
        if (to && start >= to) return false;
        if (params.therapistIds?.length && !params.therapistIds.includes(a.therapistId))
          return false;
        if (params.therapyTypeIds?.length && !params.therapyTypeIds.includes(a.therapyTypeId))
          return false;
        if (params.patientId && a.patientId !== params.patientId) return false;
        if (params.statuses?.length && !params.statuses.includes(a.status)) return false;
        if (params.kind && a.kind !== params.kind) return false;
        return true;
      })
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((a) => withRefs(db, a)),
  );
}

export async function getAppointment(id: string): Promise<AppointmentWithRefs> {
  await latency(150);
  const db = backend();
  const a = db.appointments.find((x) => x.id === id);
  if (!a) throw new Error('Appointment not found');
  return clone(withRefs(db, a));
}

// ── Availability & conflicts ────────────────────────────────────────────────

const LUNCH = { start: 13, end: 14 };

function findConflict(
  db: MockDb,
  {
    therapistId,
    patientId,
    start,
    end,
    ignoreId,
  }: {
    therapistId: ID;
    patientId?: ID;
    start: Date;
    end: Date;
    ignoreId?: ID;
  },
): string | undefined {
  const therapist = db.therapists.find((t) => t.id === therapistId);
  if (!therapist) return 'Therapist not found';
  const window = workingWindow(therapist, start);
  if (!window) {
    return therapist.status === 'on_leave'
      ? `${therapist.name} is on leave`
      : `${therapist.name} doesn't work on this day`;
  }
  if (start < window.start || end > window.end) return `Outside ${therapist.name}'s working hours`;
  const lunchStart = new Date(start);
  lunchStart.setHours(LUNCH.start, 0, 0, 0);
  const lunchEnd = new Date(start);
  lunchEnd.setHours(LUNCH.end, 0, 0, 0);
  if (areIntervalsOverlapping({ start, end }, { start: lunchStart, end: lunchEnd })) {
    return 'Lunch break';
  }
  for (const a of db.appointments) {
    if (a.id === ignoreId || a.status === 'cancelled') continue;
    const range = { start: parseISO(a.start), end: parseISO(a.end) };
    if (!areIntervalsOverlapping({ start, end }, range)) continue;
    if (a.therapistId === therapistId) {
      return `${therapist.name.split(' ')[0]} is booked with ${patientRef(db, a.patientId).fullName}`;
    }
    if (patientId && a.patientId === patientId) {
      return `Patient already has a ${therapistRef(db, a.therapistId).name.split(' ')[0]} session`;
    }
  }
  return undefined;
}

export interface SlotParams {
  therapistId: ID;
  date: ISODate;
  durationMinutes: number;
  patientId?: ID;
  ignoreAppointmentId?: ID;
}

export async function getAvailableSlots(params: SlotParams): Promise<TimeSlot[]> {
  await latency(200);
  const db = backend();
  const therapist = db.therapists.find((t) => t.id === params.therapistId);
  if (!therapist) return [];
  const day = parseISO(params.date);
  const window = workingWindow(therapist, day);
  if (!window) return [];
  const now = new Date();
  const slots: TimeSlot[] = [];
  for (
    let start = window.start;
    addMinutes(start, params.durationMinutes) <= window.end;
    start = addMinutes(start, 30)
  ) {
    const end = addMinutes(start, params.durationMinutes);
    const reason =
      start < now
        ? 'In the past'
        : findConflict(db, {
            therapistId: params.therapistId,
            patientId: params.patientId,
            start,
            end,
            ignoreId: params.ignoreAppointmentId,
          });
    slots.push({
      start: start.toISOString(),
      end: end.toISOString(),
      available: !reason,
      reason,
    });
  }
  return slots;
}

export interface Occurrence {
  start: string;
  end: string;
  conflict?: string;
}

function expandOccurrences(req: BookingRequest): { start: Date; end: Date }[] {
  const first = parseISO(req.start);
  const make = (d: Date) => ({ start: d, end: addMinutes(d, req.durationMinutes) });
  if (req.recurrence.frequency === 'none') return [make(first)];
  const weekdays = req.recurrence.weekdays.length ? req.recurrence.weekdays : [first.getDay()];
  const out: { start: Date; end: Date }[] = [];
  for (let i = 0; out.length < req.recurrence.occurrences && i < 7 * 52; i++) {
    const d = addDays(first, i);
    if (weekdays.includes(d.getDay())) out.push(make(d));
  }
  return out;
}

export async function previewBooking(req: BookingRequest): Promise<Occurrence[]> {
  await latency(200);
  const db = backend();
  return expandOccurrences(req).map(({ start, end }) => ({
    start: start.toISOString(),
    end: end.toISOString(),
    conflict: findConflict(db, {
      therapistId: req.therapistId,
      patientId: req.patientId,
      start,
      end,
    }),
  }));
}

export async function bookAppointments(
  req: BookingRequest,
): Promise<{ created: Appointment[]; skipped: Occurrence[] }> {
  await latency(600);
  const db = backend();
  const occurrences = expandOccurrences(req);
  const seriesId = occurrences.length > 1 ? uid('ser') : undefined;
  const pkg = req.patientPackageId
    ? db.patientPackages.find((p) => p.id === req.patientPackageId)
    : undefined;
  const created: Appointment[] = [];
  const skipped: Occurrence[] = [];

  for (const { start, end } of occurrences) {
    const conflict = findConflict(db, {
      therapistId: req.therapistId,
      patientId: req.patientId,
      start,
      end,
    });
    if (conflict) {
      skipped.push({ start: start.toISOString(), end: end.toISOString(), conflict });
      continue;
    }
    const remaining = pkg ? pkg.totalSessions - pkg.usedSessions - pkg.scheduledSessions : 0;
    const appointment: Appointment = {
      id: uid('ap'),
      patientId: req.patientId,
      therapistId: req.therapistId,
      therapyTypeId: req.therapyTypeId,
      kind: req.kind,
      start: start.toISOString(),
      end: end.toISOString(),
      status: 'scheduled',
      patientPackageId: pkg && remaining > 0 ? pkg.id : undefined,
      seriesId,
      noteStatus: 'none',
      notes: req.notes,
    };
    if (appointment.patientPackageId && pkg) pkg.scheduledSessions++;
    db.appointments.push(appointment);
    created.push(appointment);
  }
  if (!created.length) {
    throw new Error('None of the selected times are available. Pick another time.');
  }
  return clone({ created, skipped });
}

function adjustPackage(db: MockDb, a: Appointment, from: AppointmentStatus, to: AppointmentStatus) {
  const pkg = a.patientPackageId && db.patientPackages.find((p) => p.id === a.patientPackageId);
  if (!pkg) return;
  const counts = (s: AppointmentStatus) =>
    s === 'completed' || s === 'no_show' ? 'used' : s === 'cancelled' ? 'none' : 'scheduled';
  const before = counts(from);
  const after = counts(to);
  if (before === after) return;
  if (before === 'used') pkg.usedSessions--;
  if (before === 'scheduled') pkg.scheduledSessions--;
  if (after === 'used') pkg.usedSessions++;
  if (after === 'scheduled') pkg.scheduledSessions++;
  if (pkg.usedSessions >= pkg.totalSessions && pkg.status === 'active') pkg.status = 'completed';
}

export async function updateAppointmentStatus({
  id,
  status,
  reason,
}: {
  id: ID;
  status: AppointmentStatus;
  reason?: string;
}) {
  await latency(350);
  const db = backend();
  const a = db.appointments.find((x) => x.id === id);
  if (!a) throw new Error('Appointment not found');
  adjustPackage(db, a, a.status, status);
  a.status = status;
  if (status === 'cancelled') a.cancelReason = reason;
  return clone(a);
}

export async function rescheduleAppointment({
  id,
  start,
  therapistId,
}: {
  id: ID;
  start: string;
  therapistId?: ID;
}) {
  await latency(450);
  const db = backend();
  const a = db.appointments.find((x) => x.id === id);
  if (!a) throw new Error('Appointment not found');
  const duration = (parseISO(a.end).getTime() - parseISO(a.start).getTime()) / 60000;
  const newStart = parseISO(start);
  const newEnd = addMinutes(newStart, duration);
  const conflict = findConflict(db, {
    therapistId: therapistId ?? a.therapistId,
    patientId: a.patientId,
    start: newStart,
    end: newEnd,
    ignoreId: a.id,
  });
  if (conflict) throw new Error(conflict);
  a.start = newStart.toISOString();
  a.end = newEnd.toISOString();
  if (therapistId) a.therapistId = therapistId;
  return clone(a);
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function useAppointments(params: AppointmentListParams, enabled = true) {
  return useQuery({
    queryKey: keys.prototypeAppointments(params),
    queryFn: () => listAppointments(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAppointment(id: string | undefined) {
  return useQuery({
    queryKey: keys.prototypeAppointment(id ?? ''),
    queryFn: () => getAppointment(id!),
    enabled: Boolean(id),
  });
}

export function useAvailableSlots(params: SlotParams | null) {
  return useQuery({
    queryKey: keys.prototypeSlots(params ?? {}),
    queryFn: () => getAvailableSlots(params!),
    enabled: Boolean(params),
  });
}

export function useBookingPreview(req: BookingRequest | null) {
  return useQuery({
    queryKey: ['prototype', 'appointments', 'preview', req],
    queryFn: () => previewBooking(req!),
    enabled: Boolean(req),
  });
}

function invalidateScheduling(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['prototype', 'patient-packages', 'dashboard', 'notes']) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

export function useBookAppointments() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: bookAppointments, onSuccess: () => invalidateScheduling(qc) });
}

export function useUpdateAppointmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateAppointmentStatus,
    onSuccess: () => invalidateScheduling(qc),
  });
}

export function useRescheduleAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rescheduleAppointment,
    onSuccess: () => invalidateScheduling(qc),
  });
}
