'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseISO, subDays } from 'date-fns';

import type { ID, SessionNote } from '../types';
import { backend, clone, latency, uid } from './client';
import { keys } from './keys';
import { patientRef, therapistRef, type PatientRef, type TherapistRef } from './refs';
import type { AppointmentWithRefs } from './prototype-appointments';

// ── Session notes ───────────────────────────────────────────────────────────

export type SessionNoteWithRefs = SessionNote & { patient: PatientRef; therapist: TherapistRef };

export async function listNotes(params: {
  patientId?: ID;
  therapistId?: ID;
  status?: SessionNote['status'] | 'all';
}): Promise<SessionNoteWithRefs[]> {
  await latency();
  const db = backend();
  return clone(
    db.sessionNotes
      .filter(
        (n) =>
          (!params.patientId || n.patientId === params.patientId) &&
          (!params.therapistId || n.therapistId === params.therapistId) &&
          (!params.status || params.status === 'all' || n.status === params.status),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((n) => ({
        ...n,
        patient: patientRef(db, n.patientId),
        therapist: therapistRef(db, n.therapistId),
      })),
  );
}

/** Completed sessions in the last 14 days that still need a submitted note. */
export async function listPendingNotes(therapistId?: ID): Promise<AppointmentWithRefs[]> {
  await latency();
  const db = backend();
  const since = subDays(new Date(), 14);
  return clone(
    db.appointments
      .filter(
        (a) =>
          a.status === 'completed' &&
          a.noteStatus !== 'submitted' &&
          parseISO(a.start) >= since &&
          (!therapistId || a.therapistId === therapistId),
      )
      .sort((a, b) => b.start.localeCompare(a.start))
      .map((a) => ({
        ...a,
        patient: patientRef(db, a.patientId),
        therapist: therapistRef(db, a.therapistId),
      })),
  );
}

export async function getNoteForAppointment(appointmentId: ID): Promise<SessionNote | null> {
  await latency(200);
  const note = backend().sessionNotes.find((n) => n.appointmentId === appointmentId);
  return note ? clone(note) : null;
}

export type SessionNoteInput = Omit<SessionNote, 'id' | 'updatedAt' | 'submittedAt'>;

export async function saveNote(input: SessionNoteInput): Promise<SessionNote> {
  await latency(input.status === 'draft' ? 250 : 450);
  const db = backend();
  const appointment = db.appointments.find((a) => a.id === input.appointmentId);
  if (!appointment) throw new Error('Appointment not found');
  const now = new Date().toISOString();
  let note = db.sessionNotes.find((n) => n.appointmentId === input.appointmentId);
  if (note?.status === 'submitted') throw new Error('This note was already submitted.');
  if (note) {
    Object.assign(note, input, { updatedAt: now });
  } else {
    note = { ...input, id: uid('sn'), updatedAt: now };
    db.sessionNotes.push(note);
  }
  if (input.status === 'submitted') {
    note.submittedAt = now;
    // Submitting a note for a checked-in or scheduled session marks it completed.
    if (appointment.status === 'scheduled' || appointment.status === 'checked_in') {
      const pkg = db.patientPackages.find((p) => p.id === appointment.patientPackageId);
      if (pkg) {
        pkg.scheduledSessions = Math.max(0, pkg.scheduledSessions - 1);
        pkg.usedSessions++;
      }
      appointment.status = 'completed';
    }
  }
  appointment.noteStatus = input.status;
  return clone(note);
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function useNotes(params: Parameters<typeof listNotes>[0]) {
  return useQuery({ queryKey: keys.notes(params), queryFn: () => listNotes(params) });
}

export function usePendingNotes(therapistId?: ID) {
  return useQuery({
    queryKey: ['notes', 'pending', therapistId ?? 'all'],
    queryFn: () => listPendingNotes(therapistId),
  });
}

export function useNoteForAppointment(appointmentId: ID) {
  return useQuery({
    queryKey: keys.note(appointmentId),
    queryFn: () => getNoteForAppointment(appointmentId),
  });
}

export function useSaveNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveNote,
    onSuccess: (note) => {
      qc.setQueryData(keys.note(note.appointmentId), note);
      for (const key of ['notes', 'appointments', 'dashboard', 'patient-packages']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
