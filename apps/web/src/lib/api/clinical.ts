'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, subDays } from 'date-fns';

import type {
  Assessment,
  AssessmentStatus,
  FormValues,
  Goal,
  GoalStatus,
  ID,
  SessionNote,
  TherapyPlan,
} from '../types';
import { backend, clone, latency, uid } from './client';
import { keys } from './keys';
import { patientRef, therapistRef, type PatientRef, type TherapistRef } from './refs';
import type { AppointmentWithRefs } from './appointments';

// ── Assessments ─────────────────────────────────────────────────────────────

export type AssessmentWithRefs = Assessment & { patient: PatientRef; therapist: TherapistRef };

export async function listAssessments(params: {
  patientId?: ID;
  status?: AssessmentStatus | 'all';
  therapistId?: ID;
}): Promise<AssessmentWithRefs[]> {
  await latency();
  const db = backend();
  return clone(
    db.assessments
      .filter(
        (a) =>
          (!params.patientId || a.patientId === params.patientId) &&
          (!params.therapistId || a.therapistId === params.therapistId) &&
          (!params.status || params.status === 'all' || a.status === params.status),
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((a) => ({
        ...a,
        patient: patientRef(db, a.patientId),
        therapist: therapistRef(db, a.therapistId),
      })),
  );
}

export async function getAssessment(id: ID): Promise<AssessmentWithRefs> {
  await latency(200);
  const db = backend();
  const a = db.assessments.find((x) => x.id === id);
  if (!a) throw new Error('Assessment not found');
  return clone({
    ...a,
    patient: patientRef(db, a.patientId),
    therapist: therapistRef(db, a.therapistId),
  });
}

export interface AssessmentInput {
  id?: ID;
  patientId: ID;
  therapistId: ID;
  therapyTypeId: ID;
  templateId: ID;
  date: string;
  values: FormValues;
  status: Exclude<AssessmentStatus, 'scheduled'>;
}

export async function saveAssessment(input: AssessmentInput): Promise<Assessment> {
  await latency(450);
  const db = backend();
  const template = db.templates.find((t) => t.id === input.templateId);
  if (!template) throw new Error('Template not found');
  const now = new Date().toISOString();
  const existing = input.id ? db.assessments.find((a) => a.id === input.id) : undefined;
  if (existing) {
    if (existing.status === 'completed') throw new Error('Completed assessments are read-only.');
    Object.assign(existing, input, { templateVersion: template.version, updatedAt: now });
    return clone(existing);
  }
  const created: Assessment = {
    ...input,
    id: uid('as'),
    templateVersion: template.version,
    updatedAt: now,
  };
  db.assessments.push(created);

  // Turn "initial goals" (one per line) into trackable goals once the assessment is completed.
  if (input.status === 'completed' && typeof input.values.initial_goals === 'string') {
    for (const line of input.values.initial_goals.split('\n').map((l) => l.trim())) {
      if (!line) continue;
      db.goals.push({
        id: uid('gl'),
        patientId: input.patientId,
        therapyTypeId: input.therapyTypeId,
        title: line,
        status: 'active',
        createdAt: format(new Date(), 'yyyy-MM-dd'),
      });
    }
  }
  return clone(created);
}

// ── Goals & plans ───────────────────────────────────────────────────────────

export async function listGoals(patientId: ID): Promise<Goal[]> {
  await latency(200);
  return clone(backend().goals.filter((g) => g.patientId === patientId));
}

export async function addGoal(input: Omit<Goal, 'id' | 'createdAt' | 'status'>): Promise<Goal> {
  await latency(300);
  const goal: Goal = {
    ...input,
    id: uid('gl'),
    status: 'active',
    createdAt: format(new Date(), 'yyyy-MM-dd'),
  };
  backend().goals.push(goal);
  return clone(goal);
}

export async function setGoalStatus({ id, status }: { id: ID; status: GoalStatus }) {
  await latency(250);
  const goal = backend().goals.find((g) => g.id === id);
  if (!goal) throw new Error('Goal not found');
  goal.status = status;
  return clone(goal);
}

export async function listPlans(
  patientId: ID,
): Promise<(TherapyPlan & { therapist: TherapistRef })[]> {
  await latency(200);
  const db = backend();
  return clone(
    db.therapyPlans
      .filter((p) => p.patientId === patientId)
      .map((p) => ({ ...p, therapist: therapistRef(db, p.therapistId) })),
  );
}

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

export function useAssessments(params: Parameters<typeof listAssessments>[0]) {
  return useQuery({ queryKey: keys.assessments(params), queryFn: () => listAssessments(params) });
}

export function useAssessment(id: ID | undefined) {
  return useQuery({
    queryKey: keys.assessment(id ?? ''),
    queryFn: () => getAssessment(id!),
    enabled: Boolean(id),
  });
}

export function useSaveAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveAssessment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assessments'] });
      qc.invalidateQueries({ queryKey: ['goals'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useGoals(patientId: ID | undefined) {
  return useQuery({
    queryKey: keys.goals(patientId ?? ''),
    queryFn: () => listGoals(patientId!),
    enabled: Boolean(patientId),
  });
}

export function useAddGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addGoal,
    onSuccess: (goal) => qc.invalidateQueries({ queryKey: keys.goals(goal.patientId) }),
  });
}

export function useSetGoalStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setGoalStatus,
    onSuccess: (goal) => qc.invalidateQueries({ queryKey: keys.goals(goal.patientId) }),
  });
}

export function usePlans(patientId: ID) {
  return useQuery({ queryKey: keys.plans(patientId), queryFn: () => listPlans(patientId) });
}

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
