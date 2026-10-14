import type { ID, Patient, Therapist } from '../types';
import type { MockDb } from '../mock/seed';

/** Compact references the API embeds in list responses, so screens don't need N lookups. */
export interface PatientRef {
  id: ID;
  code: string;
  fullName: string;
  guardianName: string;
  guardianPhone: string;
}

export interface TherapistRef {
  id: ID;
  name: string;
}

export function toPatientRef(p: Patient): PatientRef {
  return {
    id: p.id,
    code: p.code,
    fullName: p.fullName,
    guardianName: p.guardian.name,
    guardianPhone: p.guardian.phone,
  };
}

export function toTherapistRef(t: Therapist): TherapistRef {
  return { id: t.id, name: t.name };
}

export function patientRef(db: MockDb, id: ID): PatientRef {
  const p = db.patients.find((x) => x.id === id);
  return p
    ? toPatientRef(p)
    : { id, code: '—', fullName: 'Unknown patient', guardianName: '', guardianPhone: '' };
}

export function therapistRef(db: MockDb, id: ID): TherapistRef {
  const t = db.therapists.find((x) => x.id === id);
  return t ? toTherapistRef(t) : { id, name: 'Unassigned' };
}
