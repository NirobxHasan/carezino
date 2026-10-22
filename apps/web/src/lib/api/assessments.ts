'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  Answers,
  AssessmentAmendmentSnapshot,
  AssessmentDetail,
  AssessmentItem,
  AssessmentKind,
  AssessmentPatientOption,
  AssessmentRecordStatus,
  AssessmentStatusDetail,
  AssessmentTemplateDetail,
  AssessmentTemplateItem,
  AssessmentTemplateStatus,
  ClinicalSummary,
  GoalPriority,
  ISODate,
  Paginated,
  TemplateDefinition,
  TemplateVersionDetail,
  TemplateVersionItem,
} from '../types';
import { request } from './client';
import { keys } from './keys';

// ── Templates ───────────────────────────────────────────────────────────────

export interface TemplateListParams {
  therapyTypeId?: string;
  status?: AssessmentTemplateStatus[];
  /** Templates meant for this assessment type, or for any */
  purpose?: AssessmentKind;
  search?: string;
}

export interface TemplateInput {
  name: string;
  therapyTypeId: string;
  /** Empty string clears it */
  description?: string;
  /** Null: any assessment type */
  purpose?: AssessmentKind | null;
  definition?: TemplateDefinition;
}

// ── Assessments ─────────────────────────────────────────────────────────────

export interface AssessmentListParams {
  search?: string;
  patientId?: string;
  therapyTypeId?: string;
  therapistId?: string;
  type?: AssessmentKind;
  status?: AssessmentRecordStatus[];
  /** Assessment dates, both included */
  from?: ISODate;
  to?: ISODate;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface CreateAssessmentInput {
  patientId: string;
  therapyTypeId: string;
  type: AssessmentKind;
  templateId: string;
  therapistId: string;
  assessmentDate: ISODate;
  appointmentId?: string;
}

export interface RecommendationInput {
  therapyTypeId: string;
  sessionsPerWeek: number | null;
  durationMinutes: number | null;
  reviewAfterWeeks: number | null;
  note: string;
}

export interface GoalInput {
  title: string;
  description: string;
  priority: GoalPriority | null;
  targetReviewDate: ISODate | null;
}

/** The whole clinical content; each part sent replaces what's stored. */
export interface AssessmentContentInput {
  revision: number;
  type?: AssessmentKind;
  assessmentDate?: ISODate;
  answers?: Answers;
  clinicalSummary?: { [K in keyof ClinicalSummary]?: string | null };
  recommendations?: RecommendationInput[];
  goals?: GoalInput[];
}

export type AnyAssessmentDetail = AssessmentDetail | AssessmentStatusDetail;

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

const templatePath = (id: string) => `/assessment-templates/${encodeURIComponent(id)}`;
const path = (id: string) => `/assessments/${encodeURIComponent(id)}`;

export const templatesApi = {
  list: (params: TemplateListParams = {}) =>
    request<AssessmentTemplateItem[]>(`/assessment-templates${query(params)}`),
  get: (id: string) => request<AssessmentTemplateDetail>(templatePath(id)),
  create: (input: TemplateInput & { starter?: boolean }) =>
    request<AssessmentTemplateDetail>('/assessment-templates', { method: 'POST', body: input }),
  update: (id: string, input: Partial<TemplateInput>) =>
    request<AssessmentTemplateDetail>(templatePath(id), { method: 'PATCH', body: input }),
  startVersion: (id: string) =>
    request<AssessmentTemplateDetail>(`${templatePath(id)}/versions`, { method: 'POST' }),
  discardDraft: (id: string) =>
    request<AssessmentTemplateDetail | { deleted: true }>(`${templatePath(id)}/draft`, {
      method: 'DELETE',
    }),
  publish: (id: string) =>
    request<AssessmentTemplateDetail>(`${templatePath(id)}/publish`, { method: 'POST' }),
  archive: (id: string) =>
    request<AssessmentTemplateDetail>(`${templatePath(id)}/archive`, { method: 'POST' }),
  restore: (id: string) =>
    request<AssessmentTemplateDetail>(`${templatePath(id)}/restore`, { method: 'POST' }),
  versions: (id: string) => request<TemplateVersionItem[]>(`${templatePath(id)}/versions`),
  version: (id: string, versionId: string) =>
    request<TemplateVersionDetail>(`${templatePath(id)}/versions/${encodeURIComponent(versionId)}`),
};

export const assessmentsApi = {
  list: (params: AssessmentListParams) =>
    request<Paginated<AssessmentItem>>(
      `/assessments${query({ ...params, page: params.page ?? 1, pageSize: params.pageSize ?? 20 })}`,
    ),
  get: (id: string) => request<AnyAssessmentDetail>(path(id)),
  amendment: (id: string, number: number) =>
    request<AssessmentAmendmentSnapshot>(`${path(id)}/amendments/${number}`),
  patientHistory: (patientId: string) =>
    request<{ patient: { id: string; code: string; fullName: string }; items: AssessmentItem[] }>(
      `/patients/${encodeURIComponent(patientId)}/assessments`,
    ),
  patientOptions: (search: string) =>
    request<{ items: AssessmentPatientOption[] }>(
      `/assessments/patient-options${query({ search })}`,
    ),
  create: (input: CreateAssessmentInput) =>
    request<AssessmentDetail>('/assessments', { method: 'POST', body: input }),
  update: (id: string, input: AssessmentContentInput & { appointmentId?: string | null }) =>
    request<AssessmentDetail>(path(id), { method: 'PATCH', body: input }),
  complete: (id: string, input: AssessmentContentInput) =>
    request<AssessmentDetail>(`${path(id)}/complete`, { method: 'POST', body: input }),
  amend: (id: string, input: AssessmentContentInput & { reason: string }) =>
    request<AssessmentDetail>(`${path(id)}/amend`, { method: 'POST', body: input }),
  discard: (id: string) => request<void>(path(id), { method: 'DELETE' }),
};

// ── Hooks ───────────────────────────────────────────────────────────────────

export function useTemplateList(params: TemplateListParams = {}, enabled = true) {
  return useQuery({
    queryKey: keys.templateList(params),
    queryFn: () => templatesApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useTemplate(id: string | undefined) {
  return useQuery({
    queryKey: keys.template(id ?? ''),
    queryFn: () => templatesApi.get(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useTemplateVersions(id: string) {
  return useQuery({
    queryKey: keys.templateVersions(id),
    queryFn: () => templatesApi.versions(id),
  });
}

export function useTemplateVersion(id: string, versionId: string | null) {
  return useQuery({
    queryKey: keys.templateVersion(id, versionId ?? ''),
    queryFn: () => templatesApi.version(id, versionId!),
    enabled: Boolean(versionId),
  });
}

function useTemplateMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assessment-templates'] }),
  });
}

export function useCreateTemplate() {
  return useTemplateMutation(templatesApi.create);
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: Partial<TemplateInput> }) =>
      templatesApi.update(v.id, v.input),
    onSuccess: (template) => {
      // The builder keeps editing the same draft; put the saved copy straight in.
      qc.setQueryData(keys.template(template.id), template);
      void qc.invalidateQueries({ queryKey: ['assessment-templates', 'list'] });
    },
  });
}

export function useTemplateAction() {
  return useTemplateMutation(
    (v: {
      id: string;
      action: 'startVersion' | 'discardDraft' | 'publish' | 'archive' | 'restore';
    }) => templatesApi[v.action](v.id),
  );
}

export function useAssessmentList(params: AssessmentListParams, enabled = true) {
  return useQuery({
    queryKey: keys.assessmentList(params),
    queryFn: () => assessmentsApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAssessment(id: string | undefined) {
  return useQuery({
    queryKey: keys.assessment(id ?? ''),
    queryFn: () => assessmentsApi.get(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useAmendmentSnapshot(id: string, number: number | null) {
  return useQuery({
    queryKey: keys.assessmentAmendment(id, number ?? 0),
    queryFn: () => assessmentsApi.amendment(id, number!),
    enabled: number !== null,
  });
}

export function usePatientAssessments(patientId: string) {
  return useQuery({
    queryKey: keys.patientAssessments(patientId),
    queryFn: () => assessmentsApi.patientHistory(patientId),
  });
}

export function useAssessmentPatientOptions(search: string, enabled = true) {
  return useQuery({
    queryKey: keys.assessmentPatientOptions(search),
    queryFn: () => assessmentsApi.patientOptions(search),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * Every write refreshes assessment lists and the appointment it may be linked to. The
 * saved assessment is put in the cache as returned, so its new revision is used next.
 */
function useAssessmentMutation<TArgs, TResult extends AssessmentDetail | void>(
  fn: (args: TArgs) => Promise<TResult>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (saved) => {
      if (saved) qc.setQueryData(keys.assessment(saved.id), saved);
      void qc.invalidateQueries({
        queryKey: ['assessments'],
        predicate: (q) => !saved || q.queryKey[2] !== saved.id,
      });
      void qc.invalidateQueries({ queryKey: ['appointments', 'detail'] });
    },
  });
}

export function useCreateAssessment() {
  return useAssessmentMutation(assessmentsApi.create);
}

export function useSaveAssessment() {
  return useAssessmentMutation(
    (v: { id: string; input: AssessmentContentInput & { appointmentId?: string | null } }) =>
      assessmentsApi.update(v.id, v.input),
  );
}

export function useCompleteAssessment() {
  return useAssessmentMutation((v: { id: string; input: AssessmentContentInput }) =>
    assessmentsApi.complete(v.id, v.input),
  );
}

export function useAmendAssessment() {
  return useAssessmentMutation(
    (v: { id: string; input: AssessmentContentInput & { reason: string } }) =>
      assessmentsApi.amend(v.id, v.input),
  );
}

export function useDiscardAssessment() {
  return useAssessmentMutation((id: string) => assessmentsApi.discard(id));
}
