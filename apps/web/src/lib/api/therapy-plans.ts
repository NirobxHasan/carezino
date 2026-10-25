'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  AssessmentPatientOption,
  GoalCategory,
  GoalMeasurementType,
  GoalPriority,
  GoalProgressEntry,
  ISODate,
  MeasurementConfig,
  Paginated,
  PlanAssessmentOption,
  PlanGoal,
  PlanPeriodUnit,
  PlanReviewDetail,
  PlanReviewItem,
  ReviewOverallProgress,
  ReviewRecommendation,
  TherapyGoalStatus,
  TherapyPlanDetail,
  TherapyPlanItem,
  TherapyPlanStatus,
  TherapyPlanStatusDetail,
} from '../types';
import { request } from './client';
import { keys } from './keys';

export type ReviewDueFilter = 'OVERDUE' | 'NEXT_7_DAYS' | 'NEXT_30_DAYS';
export type PlanSort = 'createdAt' | 'updatedAt' | 'nextReviewDate' | 'patientName';

export interface PlanListParams {
  search?: string;
  patientId?: string;
  therapyTypeId?: string;
  therapistId?: string;
  status?: TherapyPlanStatus[];
  reviewDue?: ReviewDueFilter;
  /** Start dates, both included */
  startFrom?: ISODate;
  startTo?: ISODate;
  sortBy?: PlanSort;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/** A goal's definition. Empty strings clear optional text; null clears numbers. */
export interface GoalInput {
  /** An existing goal, when sending a draft's whole goal list */
  id?: string;
  sourceAssessmentGoalId?: string | null;
  title: string;
  description?: string | null;
  categoryId?: string | null;
  priority?: GoalPriority | null;
  measurementType?: GoalMeasurementType;
  measurementConfig?: MeasurementConfig | null;
  baselineText?: string | null;
  baselineValue?: number | null;
  targetText?: string | null;
  targetValue?: number | null;
  targetDate?: ISODate | null;
  notes?: string | null;
}

export interface PlanDetailsInput {
  title?: string;
  treatmentFocus?: string | null;
  clinicalNotes?: string | null;
  sessionsPerPeriod?: number | null;
  frequencyUnit?: PlanPeriodUnit | null;
  durationMinutes?: number | null;
  reviewIntervalValue?: number | null;
  reviewIntervalUnit?: PlanPeriodUnit | null;
  additionalInstructions?: string | null;
  startDate?: ISODate;
  targetEndDate?: ISODate | null;
  nextReviewDate?: ISODate | null;
}

export interface CreatePlanInput extends PlanDetailsInput {
  patientId: string;
  therapyTypeId: string;
  therapistId: string;
  sourceAssessmentId?: string | null;
  title: string;
  startDate: ISODate;
  goals?: GoalInput[];
}

export interface UpdateDraftInput extends PlanDetailsInput {
  revision: number;
  therapyTypeId?: string;
  therapistId?: string;
  sourceAssessmentId?: string | null;
  goals?: GoalInput[];
}

export type PlanTransition =
  | { action: 'activate'; revision: number }
  | { action: 'pause'; revision: number; reason: string; reviewId?: string }
  | { action: 'resume'; revision: number; note?: string; reviewId?: string }
  | { action: 'complete'; revision: number; completionSummary: string; reviewId?: string }
  | { action: 'discontinue'; revision: number; reason: string; reviewId?: string };

export interface ProgressInput {
  observationDate: ISODate;
  goalStatus?: TherapyGoalStatus | null;
  measuredValue?: number | null;
  observation?: string | null;
  correctsId?: string;
  correctionReason?: string;
}

export interface ReviewInput {
  reviewDate: ISODate;
  overallProgress: ReviewOverallProgress;
  recommendation: ReviewRecommendation;
  observations?: string | null;
  goalSummary?: string | null;
  notes?: string | null;
  nextReviewDate?: ISODate | null;
}

export interface CategoryInput {
  name: string;
  description?: string | null;
  therapyTypeId?: string | null;
}

export type AnyPlanDetail = TherapyPlanDetail | TherapyPlanStatusDetail;

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

const path = (id: string) => `/therapy-plans/${encodeURIComponent(id)}`;
const goalPath = (id: string, goalId: string) => `${path(id)}/goals/${encodeURIComponent(goalId)}`;

export const therapyPlansApi = {
  list: (params: PlanListParams) =>
    request<Paginated<TherapyPlanItem>>(
      `/therapy-plans${query({ ...params, page: params.page ?? 1, pageSize: params.pageSize ?? 20 })}`,
    ),
  get: (id: string) => request<AnyPlanDetail>(path(id)),
  patientPlans: (patientId: string) =>
    request<{ patient: { id: string; code: string; fullName: string }; items: TherapyPlanItem[] }>(
      `/patients/${encodeURIComponent(patientId)}/therapy-plans`,
    ),
  patientOptions: (search: string) =>
    request<{ items: AssessmentPatientOption[] }>(
      `/therapy-plans/patient-options${query({ search })}`,
    ),
  assessmentOptions: (patientId: string) =>
    request<{ items: PlanAssessmentOption[] }>(
      `/therapy-plans/assessment-options${query({ patientId })}`,
    ),
  create: (input: CreatePlanInput) =>
    request<TherapyPlanDetail>('/therapy-plans', { method: 'POST', body: input }),
  update: (id: string, input: UpdateDraftInput) =>
    request<TherapyPlanDetail>(path(id), { method: 'PATCH', body: input }),
  discard: (id: string) => request<void>(path(id), { method: 'DELETE' }),
  transition: (id: string, { action, ...body }: PlanTransition) =>
    request<TherapyPlanDetail>(`${path(id)}/${action}`, { method: 'POST', body }),
  revise: (
    id: string,
    input: PlanDetailsInput & { revision: number; reason: string; reviewId?: string },
  ) => request<TherapyPlanDetail>(`${path(id)}/revise`, { method: 'POST', body: input }),
  reassign: (id: string, input: { revision: number; therapistId: string; reason: string }) =>
    request<AnyPlanDetail>(`${path(id)}/reassign`, { method: 'POST', body: input }),
  addGoal: (id: string, input: GoalInput & { reason?: string }) =>
    request<PlanGoal>(`${path(id)}/goals`, { method: 'POST', body: input }),
  updateGoal: (
    id: string,
    goalId: string,
    input: Partial<GoalInput> & { status?: TherapyGoalStatus; reason?: string },
  ) => request<PlanGoal>(goalPath(id, goalId), { method: 'PATCH', body: input }),
  recordProgress: (id: string, goalId: string, input: ProgressInput) =>
    request<{ entry: GoalProgressEntry; goal: PlanGoal }>(`${goalPath(id, goalId)}/progress`, {
      method: 'POST',
      body: input,
    }),
  goalProgress: (id: string, goalId: string) =>
    request<{ goal: PlanGoal; items: GoalProgressEntry[] }>(`${goalPath(id, goalId)}/progress`),
  planProgress: (id: string) => request<{ items: GoalProgressEntry[] }>(`${path(id)}/progress`),
  reviews: (id: string) => request<PlanReviewItem[]>(`${path(id)}/reviews`),
  review: (id: string, reviewId: string) =>
    request<PlanReviewDetail>(`${path(id)}/reviews/${encodeURIComponent(reviewId)}`),
  createReview: (id: string, input: ReviewInput) =>
    request<PlanReviewDetail>(`${path(id)}/reviews`, { method: 'POST', body: input }),
  amendReview: (id: string, reviewId: string, input: Partial<ReviewInput> & { reason: string }) =>
    request<PlanReviewDetail>(`${path(id)}/reviews/${encodeURIComponent(reviewId)}/amend`, {
      method: 'POST',
      body: input,
    }),
};

export const goalCategoriesApi = {
  list: (params: { therapyTypeId?: string; status?: 'ACTIVE' | 'INACTIVE' | 'all' } = {}) =>
    request<GoalCategory[]>(`/therapy-goal-categories${query(params)}`),
  create: (input: CategoryInput) =>
    request<GoalCategory>('/therapy-goal-categories', { method: 'POST', body: input }),
  update: (id: string, input: Partial<CategoryInput>) =>
    request<GoalCategory>(`/therapy-goal-categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    }),
  setStatus: (id: string, isActive: boolean) =>
    request<GoalCategory>(`/therapy-goal-categories/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: { isActive },
    }),
};

// ── Hooks ───────────────────────────────────────────────────────────────────

export function usePlanList(params: PlanListParams, enabled = true) {
  return useQuery({
    queryKey: keys.therapyPlanList(params),
    queryFn: () => therapyPlansApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePlan(id: string | undefined) {
  return useQuery({
    queryKey: keys.therapyPlan(id ?? ''),
    queryFn: () => therapyPlansApi.get(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

export function usePatientPlans(patientId: string, enabled = true) {
  return useQuery({
    queryKey: keys.patientTherapyPlans(patientId),
    queryFn: () => therapyPlansApi.patientPlans(patientId),
    enabled,
  });
}

export function usePlanPatientOptions(search: string, enabled = true) {
  return useQuery({
    queryKey: keys.planPatientOptions(search),
    queryFn: () => therapyPlansApi.patientOptions(search),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePlanAssessmentOptions(patientId: string | undefined) {
  return useQuery({
    queryKey: keys.planAssessmentOptions(patientId ?? ''),
    queryFn: () => therapyPlansApi.assessmentOptions(patientId!),
    enabled: Boolean(patientId),
  });
}

export function usePlanProgress(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.planProgress(id),
    queryFn: () => therapyPlansApi.planProgress(id),
    enabled,
  });
}

export function useGoalProgress(id: string, goalId: string | null) {
  return useQuery({
    queryKey: keys.goalProgress(id, goalId ?? ''),
    queryFn: () => therapyPlansApi.goalProgress(id, goalId!),
    enabled: Boolean(goalId),
  });
}

export function usePlanReview(id: string, reviewId: string | null) {
  return useQuery({
    queryKey: keys.planReview(id, reviewId ?? ''),
    queryFn: () => therapyPlansApi.review(id, reviewId!),
    enabled: Boolean(reviewId),
  });
}

export function useGoalCategories(
  params: { therapyTypeId?: string; status?: 'ACTIVE' | 'INACTIVE' | 'all' } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: keys.goalCategories(params),
    queryFn: () => goalCategoriesApi.list(params),
    enabled,
  });
}

/**
 * Every plan write refreshes plan lists, progress and reviews. A saved plan is put in
 * the cache as returned, so its new revision is used for the next change.
 */
function usePlanMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  planId?: (args: TArgs, result: TResult) => string | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result, args) => {
      const saved = result as unknown as AnyPlanDetail | undefined;
      const isPlan = saved && typeof saved === 'object' && 'revision' in saved && 'goals' in saved;
      if (isPlan) qc.setQueryData(keys.therapyPlan(saved.id), saved);
      const id = isPlan ? saved.id : planId?.(args, result);
      void qc.invalidateQueries({
        queryKey: ['therapy-plans'],
        predicate: (q) => !(isPlan && q.queryKey[1] === 'detail' && q.queryKey[2] === saved.id),
      });
      if (id && !isPlan) void qc.invalidateQueries({ queryKey: keys.therapyPlan(id) });
    },
  });
}

export function useCreatePlan() {
  return usePlanMutation(therapyPlansApi.create);
}

export function useUpdateDraft() {
  return usePlanMutation((v: { id: string; input: UpdateDraftInput }) =>
    therapyPlansApi.update(v.id, v.input),
  );
}

export function useDiscardPlan() {
  return usePlanMutation((id: string) => therapyPlansApi.discard(id));
}

export function usePlanTransition() {
  return usePlanMutation((v: { id: string; change: PlanTransition }) =>
    therapyPlansApi.transition(v.id, v.change),
  );
}

export function useRevisePlan() {
  return usePlanMutation(
    (v: {
      id: string;
      input: PlanDetailsInput & { revision: number; reason: string; reviewId?: string };
    }) => therapyPlansApi.revise(v.id, v.input),
  );
}

export function useReassignPlan() {
  return usePlanMutation(
    (v: { id: string; input: { revision: number; therapistId: string; reason: string } }) =>
      therapyPlansApi.reassign(v.id, v.input),
  );
}

export function useAddGoal() {
  return usePlanMutation(
    (v: { id: string; input: GoalInput & { reason?: string } }) =>
      therapyPlansApi.addGoal(v.id, v.input),
    (v) => v.id,
  );
}

export function useUpdateGoal() {
  return usePlanMutation(
    (v: {
      id: string;
      goalId: string;
      input: Partial<GoalInput> & { status?: TherapyGoalStatus; reason?: string };
    }) => therapyPlansApi.updateGoal(v.id, v.goalId, v.input),
    (v) => v.id,
  );
}

export function useRecordProgress() {
  return usePlanMutation(
    (v: { id: string; goalId: string; input: ProgressInput }) =>
      therapyPlansApi.recordProgress(v.id, v.goalId, v.input),
    (v) => v.id,
  );
}

export function useCreateReview() {
  return usePlanMutation(
    (v: { id: string; input: ReviewInput }) => therapyPlansApi.createReview(v.id, v.input),
    (v) => v.id,
  );
}

export function useAmendReview() {
  return usePlanMutation(
    (v: { id: string; reviewId: string; input: Partial<ReviewInput> & { reason: string } }) =>
      therapyPlansApi.amendReview(v.id, v.reviewId, v.input),
    (v) => v.id,
  );
}

function useCategoryMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goal-categories'] }),
  });
}

export function useCreateCategory() {
  return useCategoryMutation(goalCategoriesApi.create);
}

export function useUpdateCategory() {
  return useCategoryMutation((v: { id: string; input: Partial<CategoryInput> }) =>
    goalCategoriesApi.update(v.id, v.input),
  );
}

export function useSetCategoryStatus() {
  return useCategoryMutation((v: { id: string; isActive: boolean }) =>
    goalCategoriesApi.setStatus(v.id, v.isActive),
  );
}
