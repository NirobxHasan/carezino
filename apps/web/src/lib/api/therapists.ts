'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isSameDay, startOfDay, endOfDay } from 'date-fns';

import type { Therapist, WorkingHours } from '../types';
import { backend, clone, latency } from './client';
import { keys } from './keys';

export interface TherapistWithLoad extends Therapist {
  /** Today's booked sessions, excluding cancellations */
  todayBooked: number;
  /** Today's bookable hourly capacity */
  todayCapacity: number;
  activePatients: number;
}

function hoursFor(t: Therapist, day: Date): WorkingHours | undefined {
  return t.workingHours.find((h) => h.day === day.getDay());
}

export function capacityFor(t: Therapist, day: Date) {
  const hours = hoursFor(t, day);
  if (!hours || t.status !== 'active') return 0;
  const start = Number(hours.start.slice(0, 2));
  const end = Number(hours.end.slice(0, 2));
  // One hour reserved for lunch on long days
  return Math.max(0, end - start - (end - start >= 6 ? 1 : 0));
}

export async function listTherapists(): Promise<TherapistWithLoad[]> {
  await latency();
  const db = backend();
  const today = new Date();
  return clone(
    db.therapists.map((t) => {
      const booked = db.appointments.filter(
        (a) =>
          a.therapistId === t.id && a.status !== 'cancelled' && isSameDay(new Date(a.start), today),
      ).length;
      const activePatients = new Set(
        db.appointments
          .filter((a) => a.therapistId === t.id && a.status === 'scheduled')
          .map((a) => a.patientId),
      ).size;
      return { ...t, todayBooked: booked, todayCapacity: capacityFor(t, today), activePatients };
    }),
  );
}

export async function getTherapist(id: string): Promise<TherapistWithLoad> {
  const all = await listTherapists();
  const t = all.find((x) => x.id === id);
  if (!t) throw new Error('Therapist not found');
  return t;
}

export async function updateTherapist(id: string, input: Partial<Therapist>) {
  await latency(400);
  const db = backend();
  const t = db.therapists.find((x) => x.id === id);
  if (!t) throw new Error('Therapist not found');
  Object.assign(t, input);
  return clone(t);
}

/** Working-hours window for a therapist on a given day, or null when off. */
export function workingWindow(t: Therapist, day: Date) {
  const hours = hoursFor(t, day);
  if (!hours || t.status !== 'active') return null;
  const [sh, sm] = hours.start.split(':').map(Number);
  const [eh, em] = hours.end.split(':').map(Number);
  const start = startOfDay(day);
  start.setHours(sh, sm);
  const end = endOfDay(day);
  end.setHours(eh, em, 0, 0);
  return { start, end };
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function useTherapists() {
  return useQuery({ queryKey: keys.therapists, queryFn: listTherapists });
}

export function useTherapist(id: string) {
  return useQuery({ queryKey: keys.therapist(id), queryFn: () => getTherapist(id) });
}

export function useUpdateTherapist(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Therapist>) => updateTherapist(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['therapists'] }),
  });
}
