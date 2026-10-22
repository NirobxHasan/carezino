'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  ConsentPurpose,
  ContactType,
  GuardianProfile,
  GuardianContactType,
  GuardianMatch,
  GuardianRelationship,
  Paginated,
  PatientDetail,
  PatientGender,
  PatientRecordStatus,
  PatientSummary,
  ReferralSource,
} from '../types';
import { request } from './client';
import { keys } from './keys';

export type PatientSortField = 'registeredAt' | 'fullName' | 'code';

export interface PatientListParams {
  search?: string;
  status?: PatientRecordStatus | 'all';
  therapyTypeId?: string | 'all';
  gender?: PatientGender | 'all';
  /** Center-local dates, both included */
  registeredFrom?: string;
  registeredTo?: string;
  sortBy?: PatientSortField;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/** Without a date of birth: stored as of the day it's saved */
export interface ApproximateAgeInput {
  years: number;
  months?: number;
}

/** A guardian's own details; on links to an existing guardian (guardianId) they're ignored. */
export interface GuardianDetailsInput {
  fullName?: string;
  mobile?: string;
  secondaryMobile?: string;
  email?: string;
  address?: string;
}

export interface RelationshipInput {
  relationship?: GuardianRelationship;
  customRelationship?: string;
  isEmergencyContact?: boolean;
}

export interface RegistrationContactInput extends GuardianDetailsInput, RelationshipInput {
  contactType: ContactType;
  guardianId?: string;
}

/** Optional fields: an empty string or null clears them on update. */
export interface PatientInput {
  fullName: string;
  dateOfBirth?: string | null;
  approximateAge?: ApproximateAgeInput | null;
  gender?: PatientGender | '';
  primaryConcern?: string;
  therapyTypeIds?: string[];
  photoUrl?: string;
  /** Only when the center types its own codes */
  code?: string;
  emergencyPhone?: string;
  referralSource?: ReferralSource | '';
  referralOther?: string;
  internalNotes?: string;
}

export interface CreatePatientInput extends PatientInput {
  status?: PatientRecordStatus;
  contact: RegistrationContactInput;
  consents?: { purpose: ConsentPurpose; version?: string }[];
}

export interface UpdatePatientInput extends Partial<PatientInput> {
  /** The patient's own contact details */
  mobile?: string;
  secondaryMobile?: string;
  email?: string;
  address?: string;
}

export interface LinkGuardianInput extends GuardianDetailsInput, RelationshipInput {
  contactType: GuardianContactType;
  guardianId?: string;
  isPrimary?: boolean;
}

export interface UpdateLinkInput {
  contactType?: GuardianContactType;
  relationship?: GuardianRelationship;
  customRelationship?: string | null;
  isEmergencyContact?: boolean;
}

export interface ConsentInput {
  purpose: ConsentPurpose;
  granted: boolean;
  givenBy: 'SELF' | 'GUARDIAN';
  guardianId?: string;
  version?: string;
  note?: string;
}

function query(params: PatientListParams) {
  const q = new URLSearchParams();
  if (params.search?.trim()) q.set('search', params.search.trim());
  for (const key of ['status', 'therapyTypeId', 'gender'] as const) {
    const value = params[key];
    if (value && value !== 'all') q.set(key, value);
  }
  if (params.registeredFrom) q.set('registeredFrom', params.registeredFrom);
  if (params.registeredTo) q.set('registeredTo', params.registeredTo);
  if (params.sortBy) q.set('sortBy', params.sortBy);
  if (params.sortOrder) q.set('sortOrder', params.sortOrder);
  q.set('page', String(params.page ?? 1));
  q.set('pageSize', String(params.pageSize ?? 20));
  return q.toString();
}

const path = (id: string) => `/patients/${encodeURIComponent(id)}`;

export const patientsApi = {
  list: (params: PatientListParams) =>
    request<Paginated<PatientSummary>>(`/patients?${query(params)}`),
  get: (id: string) => request<PatientDetail>(path(id)),
  create: (input: CreatePatientInput) =>
    request<PatientDetail>('/patients', { method: 'POST', body: input }),
  update: (id: string, input: UpdatePatientInput) =>
    request<PatientDetail>(path(id), { method: 'PATCH', body: input }),
  setStatus: (id: string, status: Exclude<PatientRecordStatus, 'NEW'>) =>
    request<PatientDetail>(`${path(id)}/status`, { method: 'PATCH', body: { status } }),
  remove: (id: string) => request<void>(path(id), { method: 'DELETE' }),
  link: (id: string, input: LinkGuardianInput) =>
    request<PatientDetail>(`${path(id)}/guardians`, { method: 'POST', body: input }),
  updateLink: (id: string, relationId: string, input: UpdateLinkInput) =>
    request<PatientDetail>(`${path(id)}/guardians/${encodeURIComponent(relationId)}`, {
      method: 'PATCH',
      body: input,
    }),
  unlink: (id: string, relationId: string) =>
    request<PatientDetail>(`${path(id)}/guardians/${encodeURIComponent(relationId)}`, {
      method: 'DELETE',
    }),
  setPrimary: (id: string, target: { relationId: string } | { self: true }) =>
    request<PatientDetail>(`${path(id)}/primary-contact`, { method: 'PUT', body: target }),
  recordConsent: (id: string, input: ConsentInput) =>
    request<PatientDetail>(`${path(id)}/consents`, { method: 'POST', body: input }),
  searchGuardians: (q: string) =>
    request<GuardianMatch[]>(`/guardians/search?q=${encodeURIComponent(q)}`),
  updateGuardian: (guardianId: string, input: GuardianDetailsInput) =>
    request<GuardianProfile>(`/guardians/${encodeURIComponent(guardianId)}`, {
      method: 'PATCH',
      body: input,
    }),
};

// ── Hooks ───────────────────────────────────────────────────────────────────
// Every write invalidates the whole ['patients'] prefix: a contact change shows in the
// list's primary contact, and a guardian edit in every patient they're linked to.

export function usePatientList(params: PatientListParams, enabled = true) {
  return useQuery({
    queryKey: keys.patientList(params),
    queryFn: () => patientsApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePatient(id: string | undefined) {
  return useQuery({
    queryKey: keys.patient(id ?? ''),
    queryFn: () => patientsApi.get(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

/** Guardians matching a mobile (4+ digits) or name (2+ letters); off below that. */
export function useGuardianSearch(q: string, enabled = true) {
  const term = q.trim();
  const digits = term.replace(/[\s\-().+]/g, '');
  const long = /^\d+$/.test(digits) ? digits.length >= 4 : term.length >= 2;
  return useQuery({
    queryKey: keys.guardianSearch(term),
    queryFn: () => patientsApi.searchGuardians(term),
    enabled: enabled && long,
    placeholderData: keepPreviousData,
  });
}

function usePatientMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patients'] }),
  });
}

export function useCreatePatient() {
  return usePatientMutation(patientsApi.create);
}

export function useUpdatePatient() {
  return usePatientMutation((v: { id: string; input: UpdatePatientInput }) =>
    patientsApi.update(v.id, v.input),
  );
}

export function useSetPatientStatus() {
  return usePatientMutation((v: { id: string; status: Exclude<PatientRecordStatus, 'NEW'> }) =>
    patientsApi.setStatus(v.id, v.status),
  );
}

export function useDeletePatient() {
  return usePatientMutation(patientsApi.remove);
}

export function useLinkGuardian() {
  return usePatientMutation((v: { id: string; input: LinkGuardianInput }) =>
    patientsApi.link(v.id, v.input),
  );
}

export function useUpdateLink() {
  return usePatientMutation((v: { id: string; relationId: string; input: UpdateLinkInput }) =>
    patientsApi.updateLink(v.id, v.relationId, v.input),
  );
}

export function useUnlinkGuardian() {
  return usePatientMutation((v: { id: string; relationId: string }) =>
    patientsApi.unlink(v.id, v.relationId),
  );
}

export function useSetPrimaryContact() {
  return usePatientMutation((v: { id: string; target: { relationId: string } | { self: true } }) =>
    patientsApi.setPrimary(v.id, v.target),
  );
}

export function useRecordConsent() {
  return usePatientMutation((v: { id: string; input: ConsentInput }) =>
    patientsApi.recordConsent(v.id, v.input),
  );
}

export function useUpdateGuardian() {
  return usePatientMutation((v: { guardianId: string; input: GuardianDetailsInput }) =>
    patientsApi.updateGuardian(v.guardianId, v.input),
  );
}
