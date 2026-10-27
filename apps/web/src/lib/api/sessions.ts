'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  Answers,
  AppointmentRecordStatus,
  AppointmentType,
  AttendanceStatus,
  ClockTime,
  ISODate,
  MySessions,
  NoteAmendmentSnapshot,
  NoteGoalEntry,
  NoteState,
  NoteTemplateDetail,
  NoteTemplateItem,
  NoteTemplateVersionItem,
  Paginated,
  PatientSessions,
  SessionCorrectionOutcome,
  SessionDetail,
  SessionItem,
  SessionNoteDetail,
  SessionNoteTemplateStatus,
  SessionStatus,
  TemplateDefinition,
  TemplateVersionDetail,
  TodaySessions,
} from '../types';
import { request } from './client';
import { keys } from './keys';

export interface SessionFilters {
  search?: string;
  therapistId?: string;
  therapyTypeId?: string;
  patientId?: string;
  type?: AppointmentType;
  status?: AppointmentRecordStatus[];
  attendance?: AttendanceStatus[];
  sessionStatus?: SessionStatus[];
  /** PENDING: completed sessions whose note isn't signed off */
  noteStatus?: (NoteState | 'PENDING')[];
  page?: number;
  pageSize?: number;
}

export interface TodayParams extends SessionFilters {
  /** Center-local; today when left out */
  date?: ISODate;
}

export interface SessionListParams extends SessionFilters {
  from?: ISODate;
  to?: ISODate;
  sortOrder?: 'asc' | 'desc';
}

export interface AttendanceInput {
  status: AttendanceStatus;
  /** Center-local "HH:mm" on the appointment's date; null clears, left out keeps */
  checkInTime?: ClockTime | null;
  actualStartTime?: ClockTime | null;
  actualEndTime?: ClockTime | null;
  /** Empty clears it */
  note?: string;
  /** Required for corrections after the appointment closed */
  reason?: string;
  revision?: number;
}

export interface NoteContentInput {
  revision: number;
  answers?: Answers;
  goals?: Omit<NoteGoalEntry, 'progressId'>[];
}

export interface NoteTemplateInput {
  name: string;
  /** Null: a general template */
  therapyTypeId?: string | null;
  description?: string;
  definition?: TemplateDefinition;
  isDefault?: boolean;
}

export type NoteTemplateAction =
  'startVersion' | 'discardDraft' | 'publish' | 'archive' | 'restore';

function query(params: object) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length) q.set(key, value.join(','));
    } else {
      q.set(key, String(value));
    }
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

const path = (id: string) => `/sessions/${encodeURIComponent(id)}`;
const appointment = (id: string) => `/appointments/${encodeURIComponent(id)}`;
const templatePath = (id: string) => `/session-note-templates/${encodeURIComponent(id)}`;

export const sessionsApi = {
  today: (params: TodayParams) => request<TodaySessions>(`/sessions/today${query(params)}`),
  list: (params: SessionListParams) =>
    request<Paginated<SessionItem>>(
      `/sessions${query({ ...params, page: params.page ?? 1, pageSize: params.pageSize ?? 20 })}`,
    ),
  get: (id: string) => request<SessionDetail>(path(id)),
  mine: () => request<MySessions>('/my-sessions'),
  patient: (patientId: string, params: { page?: number; pageSize?: number }) =>
    request<PatientSessions>(`/patients/${encodeURIComponent(patientId)}/sessions${query(params)}`),
  checkIn: (id: string, late = false) =>
    request<SessionDetail>(`${appointment(id)}/check-in`, {
      method: 'POST',
      body: late ? { late } : {},
    }),
  recordAttendance: (id: string, input: AttendanceInput) =>
    request<SessionDetail>(`${appointment(id)}/attendance`, { method: 'PUT', body: input }),
  start: (id: string) => request<SessionDetail>(`${appointment(id)}/session`, { method: 'POST' }),
  complete: (id: string, attendance?: 'PRESENT' | 'LATE') =>
    request<SessionDetail>(`${path(id)}/complete`, {
      method: 'POST',
      body: attendance ? { attendance } : {},
    }),
  correct: (id: string, input: { outcome: SessionCorrectionOutcome; reason: string }) =>
    request<SessionDetail>(`${path(id)}/correct`, { method: 'POST', body: input }),
  note: (id: string) => request<SessionNoteDetail>(`${path(id)}/note`),
  createNote: (id: string, templateId?: string) =>
    request<SessionNoteDetail>(`${path(id)}/note`, {
      method: 'POST',
      body: templateId ? { templateId } : {},
    }),
  saveNote: (id: string, input: NoteContentInput) =>
    request<SessionNoteDetail>(`${path(id)}/note`, { method: 'PATCH', body: input }),
  completeNote: (id: string, input: NoteContentInput) =>
    request<SessionNoteDetail>(`${path(id)}/note/complete`, { method: 'POST', body: input }),
  amendNote: (id: string, input: NoteContentInput & { reason: string }) =>
    request<SessionNoteDetail>(`${path(id)}/note/amend`, { method: 'POST', body: input }),
  discardNote: (id: string) => request<void>(`${path(id)}/note`, { method: 'DELETE' }),
  amendment: (id: string, number: number) =>
    request<NoteAmendmentSnapshot>(`${path(id)}/note/amendments/${number}`),
};

export const noteTemplatesApi = {
  list: (params: { status?: SessionNoteTemplateStatus[]; usableFor?: string } = {}) =>
    request<NoteTemplateItem[]>(`/session-note-templates${query(params)}`),
  get: (id: string) => request<NoteTemplateDetail>(templatePath(id)),
  create: (input: NoteTemplateInput & { starter?: boolean }) =>
    request<NoteTemplateDetail>('/session-note-templates', { method: 'POST', body: input }),
  update: (id: string, input: Partial<NoteTemplateInput>) =>
    request<NoteTemplateDetail>(templatePath(id), { method: 'PATCH', body: input }),
  startVersion: (id: string) =>
    request<NoteTemplateDetail>(`${templatePath(id)}/versions`, { method: 'POST' }),
  discardDraft: (id: string) =>
    request<NoteTemplateDetail | { deleted: true }>(`${templatePath(id)}/draft`, {
      method: 'DELETE',
    }),
  publish: (id: string) =>
    request<NoteTemplateDetail>(`${templatePath(id)}/publish`, { method: 'POST' }),
  archive: (id: string) =>
    request<NoteTemplateDetail>(`${templatePath(id)}/archive`, { method: 'POST' }),
  restore: (id: string) =>
    request<NoteTemplateDetail>(`${templatePath(id)}/restore`, { method: 'POST' }),
  versions: (id: string) => request<NoteTemplateVersionItem[]>(`${templatePath(id)}/versions`),
  version: (id: string, versionId: string) =>
    request<TemplateVersionDetail>(`${templatePath(id)}/versions/${encodeURIComponent(versionId)}`),
};

// ── Hooks ───────────────────────────────────────────────────────────────────

/** The front desk's day refreshes on its own, so arrivals from other desks show up. */
export function useTodaySessions(params: TodayParams) {
  return useQuery({
    queryKey: keys.todaySessions(params),
    queryFn: () => sessionsApi.today(params),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

export function useSessionList(params: SessionListParams) {
  return useQuery({
    queryKey: keys.sessionList(params),
    queryFn: () => sessionsApi.list(params),
    placeholderData: keepPreviousData,
  });
}

/** One therapy session (not the signed-in user's session: that's lib/session.ts). */
export function useSessionDetail(id: string | undefined) {
  return useQuery({
    queryKey: keys.session(id ?? ''),
    queryFn: () => sessionsApi.get(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useMySessions() {
  return useQuery({
    queryKey: keys.mySessions,
    queryFn: sessionsApi.mine,
    refetchInterval: 60_000,
  });
}

export function usePatientSessions(
  patientId: string,
  params: { page?: number; pageSize?: number },
) {
  return useQuery({
    queryKey: keys.patientSessions(patientId, params),
    queryFn: () => sessionsApi.patient(patientId, params),
    placeholderData: keepPreviousData,
  });
}

export function useSessionNote(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.sessionNote(id ?? ''),
    queryFn: () => sessionsApi.note(id!),
    enabled: Boolean(id) && enabled,
    retry: false,
  });
}

export function useNoteAmendment(id: string, number: number | null) {
  return useQuery({
    queryKey: keys.sessionNoteAmendment(id, number ?? 0),
    queryFn: () => sessionsApi.amendment(id, number!),
    enabled: number !== null,
  });
}

/**
 * Attendance and session changes move appointments, package balances and schedules
 * too, so every write refreshes those as well. Refreshed after failures as well: a 409
 * means someone else changed the session.
 */
function useSessionMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      void qc.invalidateQueries({ queryKey: ['therapists'] });
      void qc.invalidateQueries({ queryKey: ['package-enrollments'] });
    },
  });
}

export function useCheckIn() {
  return useSessionMutation((v: { id: string; late?: boolean }) =>
    sessionsApi.checkIn(v.id, v.late),
  );
}

export function useRecordAttendance() {
  return useSessionMutation((v: { id: string; input: AttendanceInput }) =>
    sessionsApi.recordAttendance(v.id, v.input),
  );
}

export function useStartSession() {
  return useSessionMutation((id: string) => sessionsApi.start(id));
}

export function useCompleteSession() {
  return useSessionMutation((v: { id: string; attendance?: 'PRESENT' | 'LATE' }) =>
    sessionsApi.complete(v.id, v.attendance),
  );
}

export function useCorrectSession() {
  return useSessionMutation(
    (v: { id: string; outcome: SessionCorrectionOutcome; reason: string }) =>
      sessionsApi.correct(v.id, { outcome: v.outcome, reason: v.reason }),
  );
}

/**
 * Note writes put the saved note in the cache as returned (its new revision is used
 * next) and refresh session lists and the plan, whose goal progress a completed note
 * records.
 */
function useNoteMutation<TArgs, TResult extends SessionNoteDetail | void>(
  id: string,
  fn: (args: TArgs) => Promise<TResult>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (saved) => {
      if (saved) qc.setQueryData(keys.sessionNote(id), saved);
      else qc.removeQueries({ queryKey: keys.sessionNote(id) });
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      void qc.invalidateQueries({ queryKey: ['appointments', 'detail', id] });
      void qc.invalidateQueries({ queryKey: ['therapy-plans'] });
    },
  });
}

export function useCreateNote(id: string) {
  return useNoteMutation(id, (templateId?: string) => sessionsApi.createNote(id, templateId));
}

export function useSaveNote(id: string) {
  return useNoteMutation(id, (input: NoteContentInput) => sessionsApi.saveNote(id, input));
}

export function useCompleteNote(id: string) {
  return useNoteMutation(id, (input: NoteContentInput) => sessionsApi.completeNote(id, input));
}

export function useAmendNote(id: string) {
  return useNoteMutation(id, (input: NoteContentInput & { reason: string }) =>
    sessionsApi.amendNote(id, input),
  );
}

export function useDiscardNote(id: string) {
  return useNoteMutation(id, () => sessionsApi.discardNote(id));
}

// ── Templates ───────────────────────────────────────────────────────────────

export function useNoteTemplateList(
  params: { status?: SessionNoteTemplateStatus[]; usableFor?: string } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: keys.noteTemplateList(params),
    queryFn: () => noteTemplatesApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useNoteTemplate(id: string | undefined) {
  return useQuery({
    queryKey: keys.noteTemplate(id ?? ''),
    queryFn: () => noteTemplatesApi.get(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useNoteTemplateVersions(id: string) {
  return useQuery({
    queryKey: keys.noteTemplateVersions(id),
    queryFn: () => noteTemplatesApi.versions(id),
  });
}

export function useNoteTemplateVersion(id: string, versionId: string | null) {
  return useQuery({
    queryKey: keys.noteTemplateVersion(id, versionId ?? ''),
    queryFn: () => noteTemplatesApi.version(id, versionId!),
    enabled: Boolean(versionId),
  });
}

function useNoteTemplateMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session-note-templates'] }),
  });
}

export function useCreateNoteTemplate() {
  return useNoteTemplateMutation(noteTemplatesApi.create);
}

export function useUpdateNoteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: Partial<NoteTemplateInput> }) =>
      noteTemplatesApi.update(v.id, v.input),
    onSuccess: (template) => {
      // The builder keeps editing the same draft; put the saved copy straight in.
      qc.setQueryData(keys.noteTemplate(template.id), template);
      void qc.invalidateQueries({ queryKey: ['session-note-templates', 'list'] });
    },
  });
}

export function useNoteTemplateAction() {
  return useNoteTemplateMutation((v: { id: string; action: NoteTemplateAction }) =>
    noteTemplatesApi[v.action](v.id),
  );
}
