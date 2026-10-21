'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CenterTherapyType, TherapyDurationOption } from '../types';
import { request } from './client';
import { keys } from './keys';

export interface TherapyTypeListParams {
  search?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'all';
}

export interface TherapyTypeInput {
  name: string;
  code: string;
  /** Empty string clears it */
  description?: string;
  defaultDurationMinutes: number;
  /** Hex colour; empty string clears it */
  color?: string;
  isActive?: boolean;
}

export interface DurationOptionInput {
  durationMinutes: number;
  label?: string;
  isActive?: boolean;
  isDefault?: boolean;
}

export type DurationOptionUpdate = Partial<
  Pick<TherapyDurationOption, 'durationMinutes' | 'isActive'> & {
    label: string | null;
    isDefault: true;
  }
>;

const path = (id: string) => `/therapy-types/${encodeURIComponent(id)}`;

function query(params: TherapyTypeListParams) {
  const q = new URLSearchParams();
  if (params.search?.trim()) q.set('search', params.search.trim());
  if (params.status && params.status !== 'all') q.set('status', params.status);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const therapyTypesApi = {
  list: (params: TherapyTypeListParams = {}) =>
    request<CenterTherapyType[]>(`/therapy-types${query(params)}`),
  create: (input: TherapyTypeInput) =>
    request<CenterTherapyType>('/therapy-types', { method: 'POST', body: input }),
  update: (id: string, input: Partial<TherapyTypeInput>) =>
    request<CenterTherapyType>(path(id), { method: 'PATCH', body: input }),
  setStatus: (id: string, isActive: boolean) =>
    request<CenterTherapyType>(`${path(id)}/status`, { method: 'PATCH', body: { isActive } }),
  remove: (id: string) => request<void>(path(id), { method: 'DELETE' }),
  reorder: (ids: string[]) =>
    request<CenterTherapyType[]>('/therapy-types/order', { method: 'PUT', body: { ids } }),
  addDefaults: () =>
    request<{ created: number; items: CenterTherapyType[] }>('/therapy-types/defaults', {
      method: 'POST',
    }),
  addDuration: (id: string, input: DurationOptionInput) =>
    request<CenterTherapyType>(`${path(id)}/durations`, { method: 'POST', body: input }),
  updateDuration: (id: string, durationId: string, input: DurationOptionUpdate) =>
    request<CenterTherapyType>(`${path(id)}/durations/${encodeURIComponent(durationId)}`, {
      method: 'PATCH',
      body: input,
    }),
  removeDuration: (id: string, durationId: string) =>
    request<CenterTherapyType>(`${path(id)}/durations/${encodeURIComponent(durationId)}`, {
      method: 'DELETE',
    }),
};

// ── Hooks ───────────────────────────────────────────────────────────────────
// The prototype screens still read mock therapy types from lib/api/config.ts; move
// them to these hooks when patients and appointments are served by the API.

export function useTherapyTypeList(params: TherapyTypeListParams = {}) {
  return useQuery({
    queryKey: keys.therapyTypeList(params),
    queryFn: () => therapyTypesApi.list(params),
    placeholderData: keepPreviousData,
  });
}

function useTherapyTypeMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['therapy-types'] }),
  });
}

export function useCreateTherapyType() {
  return useTherapyTypeMutation(therapyTypesApi.create);
}

export function useUpdateTherapyType() {
  return useTherapyTypeMutation((v: { id: string; input: Partial<TherapyTypeInput> }) =>
    therapyTypesApi.update(v.id, v.input),
  );
}

export function useSetTherapyTypeStatus() {
  return useTherapyTypeMutation((v: { id: string; isActive: boolean }) =>
    therapyTypesApi.setStatus(v.id, v.isActive),
  );
}

export function useDeleteTherapyType() {
  return useTherapyTypeMutation(therapyTypesApi.remove);
}

export function useReorderTherapyTypes() {
  const qc = useQueryClient();
  const lists = { queryKey: ['therapy-types', 'list'] };
  return useMutation({
    mutationFn: therapyTypesApi.reorder,
    // Show the new order straight away; the refetch afterwards confirms or reverts it.
    onMutate: async (ids) => {
      await qc.cancelQueries(lists);
      const rank = new Map(ids.map((id, i) => [id, i]));
      qc.setQueriesData<CenterTherapyType[]>(lists, (old) =>
        old
          ? [...old].sort((a, b) => (rank.get(a.id) ?? ids.length) - (rank.get(b.id) ?? ids.length))
          : old,
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['therapy-types'] }),
  });
}

export function useAddDefaultTherapyTypes() {
  return useTherapyTypeMutation(therapyTypesApi.addDefaults);
}

export function useAddDuration() {
  return useTherapyTypeMutation((v: { id: string; input: DurationOptionInput }) =>
    therapyTypesApi.addDuration(v.id, v.input),
  );
}

export function useUpdateDuration() {
  return useTherapyTypeMutation(
    (v: { id: string; durationId: string; input: DurationOptionUpdate }) =>
      therapyTypesApi.updateDuration(v.id, v.durationId, v.input),
  );
}

export function useRemoveDuration() {
  return useTherapyTypeMutation((v: { id: string; durationId: string }) =>
    therapyTypesApi.removeDuration(v.id, v.durationId),
  );
}
