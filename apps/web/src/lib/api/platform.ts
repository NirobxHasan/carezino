'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  CenterProfile,
  Paginated,
  PlatformCenterDetail,
  PlatformCenterListItem,
} from '../types';
import type { RegisterCenterInput } from './auth';
import { request } from './client';
import { keys } from './keys';
import { useResetSessionCache } from './auth';

export interface PlatformCenterParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

export const platformApi = {
  login: (input: { username: string; password: string }) =>
    request<void>('/auth/admin/login', { method: 'POST', body: input }),
  centers: (params: PlatformCenterParams) => {
    const q = new URLSearchParams();
    if (params.search?.trim()) q.set('search', params.search.trim());
    q.set('page', String(params.page ?? 1));
    q.set('pageSize', String(params.pageSize ?? 10));
    return request<Paginated<PlatformCenterListItem>>(`/platform/centers?${q}`);
  },
  center: (id: string) =>
    request<PlatformCenterDetail>(`/platform/centers/${encodeURIComponent(id)}`),
  createCenter: (input: RegisterCenterInput) =>
    request<{ center: CenterProfile }>('/platform/centers', { method: 'POST', body: input }),
};

export function useAdminLogin() {
  const reset = useResetSessionCache();
  return useMutation({ mutationFn: platformApi.login, onSuccess: reset });
}

export function usePlatformCenters(params: PlatformCenterParams) {
  return useQuery({
    queryKey: keys.platformCenters(params),
    queryFn: () => platformApi.centers(params),
    placeholderData: keepPreviousData,
  });
}

export function usePlatformCenter(id: string | undefined) {
  return useQuery({
    queryKey: keys.platformCenter(id ?? ''),
    queryFn: () => platformApi.center(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useCreateCenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: platformApi.createCenter,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform'] }),
  });
}
