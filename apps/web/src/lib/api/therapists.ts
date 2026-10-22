'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  EmploymentType,
  Paginated,
  PersonGender,
  TherapistDetail,
  TherapistListItem,
  TherapistProfileStatus,
  TherapistSchedule,
  TherapistSpecialization,
  TherapistTimeOff,
  TherapistWeek,
  TimeInterval,
  TimeOffReason,
  TimeOffResult,
} from '../types';
import { request } from './client';
import { keys } from './keys';

export type TherapistSortField = 'fullName' | 'code' | 'joiningDate' | 'createdAt';

export interface TherapistListParams {
  search?: string;
  status?: TherapistProfileStatus | 'all';
  therapyTypeId?: string | 'all';
  employmentType?: EmploymentType | 'all';
  joinedFrom?: string;
  joinedTo?: string;
  sortBy?: TherapistSortField;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface SpecializationsInput {
  therapyTypeIds: string[];
  primaryTherapyTypeId?: string;
}

export interface AvailabilityDayInput {
  dayOfWeek: number;
  isAvailable: boolean;
  intervals: TimeInterval[];
}

/** Optional fields: an empty string or null clears them on update. */
export interface TherapistInput {
  fullName: string;
  mobile: string;
  email?: string;
  gender?: PersonGender | '';
  photoUrl?: string;
  designation?: string;
  qualifications?: string;
  registrationNumber?: string;
  yearsOfExperience?: number | null;
  joiningDate?: string | null;
  employmentType?: EmploymentType | '';
  notes?: string;
  membershipId?: string | null;
}

export interface CreateTherapistInput extends TherapistInput {
  status?: TherapistProfileStatus;
  specializations?: SpecializationsInput;
  availability?: { days: AvailabilityDayInput[] };
}

export interface TimeOffInput {
  startDate: string;
  endDate: string;
  isAllDay: boolean;
  startTime?: string | null;
  endTime?: string | null;
  reason?: TimeOffReason | null;
  note?: string;
}

function query(params: TherapistListParams) {
  const q = new URLSearchParams();
  if (params.search?.trim()) q.set('search', params.search.trim());
  for (const key of ['status', 'therapyTypeId', 'employmentType'] as const) {
    const value = params[key];
    if (value && value !== 'all') q.set(key, value);
  }
  if (params.joinedFrom) q.set('joinedFrom', params.joinedFrom);
  if (params.joinedTo) q.set('joinedTo', params.joinedTo);
  if (params.sortBy) q.set('sortBy', params.sortBy);
  if (params.sortOrder) q.set('sortOrder', params.sortOrder);
  q.set('page', String(params.page ?? 1));
  q.set('pageSize', String(params.pageSize ?? 10));
  return q.toString();
}

const path = (id: string) => `/therapists/${encodeURIComponent(id)}`;

export const therapistsApi = {
  list: (params: TherapistListParams) =>
    request<Paginated<TherapistListItem>>(`/therapists?${query(params)}`),
  get: (id: string) => request<TherapistDetail>(path(id)),
  create: (input: CreateTherapistInput) =>
    request<TherapistDetail>('/therapists', { method: 'POST', body: input }),
  update: (id: string, input: Partial<TherapistInput>) =>
    request<TherapistDetail>(path(id), { method: 'PATCH', body: input }),
  setStatus: (id: string, status: TherapistProfileStatus) =>
    request<TherapistDetail>(`${path(id)}/status`, { method: 'PATCH', body: { status } }),
  remove: (id: string) => request<void>(path(id), { method: 'DELETE' }),
  setSpecializations: (id: string, input: SpecializationsInput) =>
    request<TherapistSpecialization[]>(`${path(id)}/specializations`, {
      method: 'PUT',
      body: input,
    }),
  availability: (id: string) => request<TherapistWeek>(`${path(id)}/availability`),
  saveAvailability: (id: string, days: AvailabilityDayInput[]) =>
    request<TherapistWeek>(`${path(id)}/availability`, { method: 'PUT', body: { days } }),
  timeOff: (id: string, period: 'upcoming' | 'past') =>
    request<TherapistTimeOff[]>(`${path(id)}/time-off?period=${period}`),
  addTimeOff: (id: string, input: TimeOffInput) =>
    request<TimeOffResult>(`${path(id)}/time-off`, { method: 'POST', body: input }),
  updateTimeOff: (id: string, timeOffId: string, input: Partial<TimeOffInput>) =>
    request<TimeOffResult>(`${path(id)}/time-off/${encodeURIComponent(timeOffId)}`, {
      method: 'PATCH',
      body: input,
    }),
  removeTimeOff: (id: string, timeOffId: string) =>
    request<void>(`${path(id)}/time-off/${encodeURIComponent(timeOffId)}`, {
      method: 'DELETE',
    }),
  schedule: (id: string, range: { startDate: string; endDate: string }) =>
    request<TherapistSchedule>(
      `${path(id)}/schedule?startDate=${range.startDate}&endDate=${range.endDate}`,
    ),
};

// ── Hooks ───────────────────────────────────────────────────────────────────
// Every write invalidates the whole ['therapists'] prefix: a change to hours or time off
// also changes list summaries, readiness and schedules.

export function useTherapistList(params: TherapistListParams, enabled = true) {
  return useQuery({
    queryKey: keys.therapistList(params),
    queryFn: () => therapistsApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useTherapist(id: string | undefined) {
  return useQuery({
    queryKey: keys.therapist(id ?? ''),
    queryFn: () => therapistsApi.get(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useTherapistAvailability(id: string) {
  return useQuery({
    queryKey: keys.therapistAvailability(id),
    queryFn: () => therapistsApi.availability(id),
  });
}

export function useTherapistTimeOff(id: string, period: 'upcoming' | 'past') {
  return useQuery({
    queryKey: keys.therapistTimeOff(id, period),
    queryFn: () => therapistsApi.timeOff(id, period),
  });
}

export function useTherapistSchedule(
  id: string,
  range: { startDate: string; endDate: string },
  enabled = true,
) {
  return useQuery({
    queryKey: keys.therapistSchedule(id, range),
    queryFn: () => therapistsApi.schedule(id, range),
    placeholderData: keepPreviousData,
    enabled,
  });
}

function useTherapistMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['therapists'] }),
  });
}

export function useCreateTherapist() {
  return useTherapistMutation(therapistsApi.create);
}

export function useUpdateTherapist() {
  return useTherapistMutation((v: { id: string; input: Partial<TherapistInput> }) =>
    therapistsApi.update(v.id, v.input),
  );
}

export function useSetTherapistStatus() {
  return useTherapistMutation((v: { id: string; status: TherapistProfileStatus }) =>
    therapistsApi.setStatus(v.id, v.status),
  );
}

export function useDeleteTherapist() {
  return useTherapistMutation(therapistsApi.remove);
}

export function useSetSpecializations() {
  return useTherapistMutation((v: { id: string; input: SpecializationsInput }) =>
    therapistsApi.setSpecializations(v.id, v.input),
  );
}

export function useSaveTherapistAvailability() {
  return useTherapistMutation((v: { id: string; days: AvailabilityDayInput[] }) =>
    therapistsApi.saveAvailability(v.id, v.days),
  );
}

export function useAddTimeOff() {
  return useTherapistMutation((v: { id: string; input: TimeOffInput }) =>
    therapistsApi.addTimeOff(v.id, v.input),
  );
}

export function useUpdateTimeOff() {
  return useTherapistMutation(
    (v: { id: string; timeOffId: string; input: Partial<TimeOffInput> }) =>
      therapistsApi.updateTimeOff(v.id, v.timeOffId, v.input),
  );
}

export function useRemoveTimeOff() {
  return useTherapistMutation((v: { id: string; timeOffId: string }) =>
    therapistsApi.removeTimeOff(v.id, v.timeOffId),
  );
}
