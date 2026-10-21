'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  CenterClosure,
  GeneralSettings,
  SchedulingSettings,
  TimeInterval,
  WorkingWeek,
} from '../types';
import { request } from './client';
import { keys } from './keys';

export interface ClosureInput {
  title: string;
  startDate: string;
  endDate: string;
  /** Empty string clears it */
  reason?: string;
  allDay: boolean;
  startTime?: string | null;
  endTime?: string | null;
  isActive?: boolean;
}

export type ClosurePeriod = 'upcoming' | 'past';

export type SchedulingSettingsUpdate = Partial<Omit<SchedulingSettings, 'updatedAt'>>;
export type GeneralSettingsUpdate = Partial<Omit<GeneralSettings, 'updatedAt'>>;

const closurePath = (id: string) => `/settings/closures/${encodeURIComponent(id)}`;

export const settingsApi = {
  workingHours: () => request<WorkingWeek>('/settings/working-hours'),
  saveWorkingHours: (days: { dayOfWeek: number; intervals: TimeInterval[] }[]) =>
    request<WorkingWeek>('/settings/working-hours', { method: 'PUT', body: { days } }),
  closures: (period: ClosurePeriod) =>
    request<CenterClosure[]>(`/settings/closures?period=${period}`),
  createClosure: (input: ClosureInput) =>
    request<CenterClosure>('/settings/closures', { method: 'POST', body: input }),
  updateClosure: (id: string, input: Partial<ClosureInput>) =>
    request<CenterClosure>(closurePath(id), { method: 'PATCH', body: input }),
  removeClosure: (id: string) => request<void>(closurePath(id), { method: 'DELETE' }),
  scheduling: () => request<SchedulingSettings>('/settings/scheduling'),
  updateScheduling: (input: SchedulingSettingsUpdate) =>
    request<SchedulingSettings>('/settings/scheduling', { method: 'PATCH', body: input }),
  general: () => request<GeneralSettings>('/settings/general'),
  updateGeneral: (input: GeneralSettingsUpdate) =>
    request<GeneralSettings>('/settings/general', { method: 'PATCH', body: input }),
};

// ── Hooks ───────────────────────────────────────────────────────────────────

export function useWorkingHours() {
  return useQuery({ queryKey: keys.workingHours, queryFn: settingsApi.workingHours });
}

export function useSaveWorkingHours() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: settingsApi.saveWorkingHours,
    onSuccess: (week) => qc.setQueryData(keys.workingHours, week),
  });
}

export function useClosures(period: ClosurePeriod) {
  return useQuery({
    queryKey: keys.closures({ period }),
    queryFn: () => settingsApi.closures(period),
  });
}

function useClosureMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // A change can move a closure between the upcoming and past lists.
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.closures() }),
  });
}

export function useCreateClosure() {
  return useClosureMutation(settingsApi.createClosure);
}

export function useUpdateClosure() {
  return useClosureMutation((v: { id: string; input: Partial<ClosureInput> }) =>
    settingsApi.updateClosure(v.id, v.input),
  );
}

export function useRemoveClosure() {
  return useClosureMutation(settingsApi.removeClosure);
}

export function useSchedulingSettings() {
  return useQuery({ queryKey: keys.schedulingSettings, queryFn: settingsApi.scheduling });
}

export function useUpdateSchedulingSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: settingsApi.updateScheduling,
    onSuccess: (settings) => qc.setQueryData(keys.schedulingSettings, settings),
  });
}

export function useGeneralSettings() {
  return useQuery({ queryKey: keys.generalSettings, queryFn: settingsApi.general });
}

export function useUpdateGeneralSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: settingsApi.updateGeneral,
    onSuccess: (settings) => qc.setQueryData(keys.generalSettings, settings),
  });
}
