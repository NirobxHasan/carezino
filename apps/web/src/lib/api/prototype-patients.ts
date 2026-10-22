'use client';

// Mock patients for the prototype modules (appointments, clinical, packages, finance),
// whose seed data refers to these IDs. The real patient screens use lib/api/patients.ts.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';

import type { Paginated, Patient, PatientStatus } from '../types';
import { backend, clone, latency, uid } from './client';
import { keys } from './keys';
import { therapistRef, type TherapistRef } from './refs';

export interface PatientListParams {
  search?: string;
  status?: PatientStatus | 'all';
  therapyTypeId?: string | 'all';
  sort?: { id: 'fullName' | 'code' | 'registeredAt'; desc: boolean };
  page?: number;
  pageSize?: number;
}

export type PatientListItem = Patient & { primaryTherapist?: TherapistRef };

export async function listPatients(
  params: PatientListParams = {},
): Promise<Paginated<PatientListItem>> {
  await latency();
  const db = backend();
  const { search, status = 'all', therapyTypeId = 'all', page = 1, pageSize = 10, sort } = params;
  const q = search?.trim().toLowerCase();
  let rows = db.patients.filter((p) => {
    if (status !== 'all' && p.status !== status) return false;
    if (therapyTypeId !== 'all' && !p.therapyTypeIds.includes(therapyTypeId)) return false;
    if (!q) return true;
    return (
      p.fullName.toLowerCase().includes(q) ||
      p.code.toLowerCase().includes(q) ||
      p.guardian.name.toLowerCase().includes(q) ||
      p.guardian.phone.includes(q.replace(/\D/g, '') || q) ||
      (p.nameBn?.includes(search!.trim()) ?? false)
    );
  });
  const by = sort?.id ?? 'registeredAt';
  const dir = sort ? (sort.desc ? -1 : 1) : -1;
  rows = [...rows].sort((a, b) => (a[by] < b[by] ? -dir : a[by] > b[by] ? dir : 0));
  const total = rows.length;
  const items = rows.slice((page - 1) * pageSize, page * pageSize).map((p) => ({
    ...p,
    primaryTherapist: p.primaryTherapistId ? therapistRef(db, p.primaryTherapistId) : undefined,
  }));
  return clone({ items, total, page, pageSize });
}

/** Lightweight search used by PatientSelector. */
export async function searchPatients(query: string) {
  const result = await listPatients({ search: query, pageSize: 20 });
  return result.items.filter((p) => p.status !== 'discharged');
}

export async function getPatient(id: string): Promise<PatientListItem> {
  await latency();
  const db = backend();
  const p = db.patients.find((x) => x.id === id);
  if (!p) throw new Error('Patient not found');
  return clone({
    ...p,
    primaryTherapist: p.primaryTherapistId ? therapistRef(db, p.primaryTherapistId) : undefined,
  });
}

export type PatientInput = Omit<Patient, 'id' | 'code' | 'registeredAt'>;

export async function createPatient(input: PatientInput): Promise<Patient> {
  await latency(500);
  const db = backend();
  const duplicate = db.patients.find(
    (p) =>
      p.fullName.toLowerCase() === input.fullName.toLowerCase() &&
      p.dateOfBirth === input.dateOfBirth,
  );
  if (duplicate) {
    throw new Error(
      `A patient with this name and date of birth already exists (${duplicate.code}).`,
    );
  }
  const next = Math.max(...db.patients.map((p) => Number(p.code.slice(3)))) + 1;
  const patient: Patient = {
    ...input,
    id: uid('pt'),
    code: `CZ-${String(next).padStart(4, '0')}`,
    registeredAt: format(new Date(), 'yyyy-MM-dd'),
  };
  db.patients.push(patient);
  return clone(patient);
}

export async function updatePatient(id: string, input: Partial<PatientInput>): Promise<Patient> {
  await latency(400);
  const db = backend();
  const p = db.patients.find((x) => x.id === id);
  if (!p) throw new Error('Patient not found');
  Object.assign(p, input);
  return clone(p);
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function usePatients(params: PatientListParams) {
  return useQuery({
    queryKey: keys.prototypePatients(params),
    queryFn: () => listPatients(params),
    placeholderData: keepPreviousData,
  });
}

export function usePatientSearch(query: string, enabled = true) {
  return useQuery({
    queryKey: keys.prototypePatientSearch(query),
    queryFn: () => searchPatients(query),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function usePatient(id: string | undefined) {
  return useQuery({
    queryKey: keys.prototypePatient(id ?? ''),
    queryFn: () => getPatient(id!),
    enabled: Boolean(id),
  });
}

export function useCreatePatient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPatient,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prototype', 'patients'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdatePatient(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<PatientInput>) => updatePatient(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prototype', 'patients'] }),
  });
}
