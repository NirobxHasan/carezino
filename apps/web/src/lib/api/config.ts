'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Center, FormTemplate, TherapyType, User } from '../types';
import { backend, clone, latency, uid } from './client';
import { keys } from './keys';

export interface AppConfig {
  center: Center;
  therapyTypes: TherapyType[];
  templates: FormTemplate[];
  users: User[];
}

export async function getConfig(): Promise<AppConfig> {
  await latency(120);
  const db = backend();
  return clone({
    center: db.center,
    therapyTypes: db.therapyTypes,
    templates: db.templates,
    users: db.users,
  });
}

export async function updateCenter(input: Partial<Center>) {
  await latency();
  const db = backend();
  Object.assign(db.center, input);
  return clone(db.center);
}

export async function saveTherapyType(input: Omit<TherapyType, 'id'> & { id?: string }) {
  await latency();
  const db = backend();
  if (input.id) {
    const existing = db.therapyTypes.find((t) => t.id === input.id);
    if (existing) Object.assign(existing, input);
    return clone(existing!);
  }
  const created: TherapyType = { ...input, id: uid('tt') };
  db.therapyTypes.push(created);
  return clone(created);
}

export async function publishTemplate(templateId: string) {
  await latency();
  const db = backend();
  const tpl = db.templates.find((t) => t.id === templateId);
  if (!tpl) throw new Error('Template not found');
  tpl.version += 1;
  tpl.status = 'published';
  tpl.updatedAt = new Date().toISOString();
  return clone(tpl);
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function useConfig() {
  return useQuery({ queryKey: keys.config, queryFn: getConfig, staleTime: Infinity });
}

/** Therapy types by id, plus active ones in display order. */
export function useTherapyTypes() {
  const { data, isLoading } = useConfig();
  const derived = useMemo(() => {
    const all = data?.therapyTypes ?? [];
    return {
      all,
      active: all.filter((t) => t.active),
      byId: new Map(all.map((t) => [t.id, t])),
    };
  }, [data]);
  return { ...derived, isLoading };
}

export function useUpdateCenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateCenter,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.config }),
  });
}

export function useSaveTherapyType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveTherapyType,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.config }),
  });
}

export function usePublishTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: publishTemplate,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.config }),
  });
}
