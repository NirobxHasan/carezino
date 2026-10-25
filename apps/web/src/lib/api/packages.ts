'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  AdjustmentType,
  AppointmentType,
  EnrollmentDetail,
  EnrollmentItem,
  EnrollmentMovement,
  EnrollmentOption,
  EnrollmentStatus,
  ISODate,
  Money,
  Paginated,
  PackageActivationPolicy,
  PackageDiscountType,
  PackagePeriodUnit,
  TherapyPackageItem,
} from '../types';
import { request } from './client';
import { keys } from './keys';

export type PackageSort = 'displayOrder' | 'name' | 'price' | 'createdAt';
export type EnrollmentSort = 'createdAt' | 'endDate' | 'patientName';

export interface PackageListParams {
  search?: string;
  therapyTypeId?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'all';
  sortBy?: PackageSort;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/** A package's fields. Money is sent as a decimal string, never a float. */
export interface PackageInput {
  name: string;
  code?: string;
  description?: string | null;
  therapyTypeIds: string[];
  sessionCount: number;
  defaultDurationMinutes?: number | null;
  price: Money;
  validityValue: number;
  validityUnit: PackagePeriodUnit;
  activationPolicy?: PackageActivationPolicy;
  usageLimitCount?: number | null;
  usageLimitPeriod?: PackagePeriodUnit | null;
  coversAssessments?: boolean;
  chargeNoShow?: boolean;
  chargeLateCancellation?: boolean;
  isActive?: boolean;
  displayOrder?: number;
}

export interface EnrollmentListParams {
  search?: string;
  patientId?: string;
  packageId?: string;
  therapyTypeId?: string;
  status?: EnrollmentStatus[];
  expiringSoon?: boolean;
  startFrom?: ISODate;
  startTo?: ISODate;
  endFrom?: ISODate;
  endTo?: ISODate;
  sortBy?: EnrollmentSort;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/** The terms of a purchase; anything other than the package's needs override_terms. */
export interface EnrollmentTermsInput {
  /** The same purchase sent twice is recorded once */
  requestId?: string;
  therapyPlanId?: string | null;
  activationPolicy?: PackageActivationPolicy;
  startDate?: ISODate;
  endDate?: ISODate | null;
  sessionCount?: number;
  discountType?: PackageDiscountType;
  discountValue?: Money | null;
  agreedPrice?: Money | null;
  notes?: string | null;
}

export interface CreateEnrollmentInput extends EnrollmentTermsInput {
  patientId: string;
  packageId: string;
}

export interface AdjustmentInput {
  type: AdjustmentType;
  quantity?: number;
  consumptionId?: string;
  reason: string;
  requestId?: string;
}

export interface EnrollmentOptionsParams {
  patientId: string;
  therapyTypeId?: string;
  type?: AppointmentType;
  date?: ISODate;
  appointmentId?: string;
}

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

const packagePath = (id: string) => `/packages/${encodeURIComponent(id)}`;
const enrollmentPath = (id: string) => `/package-enrollments/${encodeURIComponent(id)}`;

export const packagesApi = {
  list: (params: PackageListParams) =>
    request<Paginated<TherapyPackageItem>>(
      `/packages${query({ ...params, page: params.page ?? 1, pageSize: params.pageSize ?? 20 })}`,
    ),
  get: (id: string) => request<TherapyPackageItem>(packagePath(id)),
  create: (input: PackageInput) =>
    request<TherapyPackageItem>('/packages', { method: 'POST', body: input }),
  update: (id: string, input: Partial<PackageInput>) =>
    request<TherapyPackageItem>(packagePath(id), { method: 'PATCH', body: input }),
  setStatus: (id: string, isActive: boolean) =>
    request<TherapyPackageItem>(`${packagePath(id)}/status`, {
      method: 'PATCH',
      body: { isActive },
    }),
  remove: (id: string) => request<void>(packagePath(id), { method: 'DELETE' }),
  duplicate: (id: string) =>
    request<TherapyPackageItem>(`${packagePath(id)}/duplicate`, { method: 'POST' }),
};

export const enrollmentsApi = {
  list: (params: EnrollmentListParams) =>
    request<Paginated<EnrollmentItem>>(
      `/package-enrollments${query({ ...params, page: params.page ?? 1, pageSize: params.pageSize ?? 20 })}`,
    ),
  get: (id: string) => request<EnrollmentDetail>(enrollmentPath(id)),
  ledger: (id: string) => request<{ items: EnrollmentMovement[] }>(`${enrollmentPath(id)}/ledger`),
  patientEnrollments: (patientId: string) =>
    request<{ patient: { id: string; code: string; fullName: string }; items: EnrollmentItem[] }>(
      `/patients/${encodeURIComponent(patientId)}/package-enrollments`,
    ),
  options: (params: EnrollmentOptionsParams) =>
    request<{ date: ISODate; items: EnrollmentOption[] }>(
      `/package-enrollments/options${query(params)}`,
    ),
  create: (input: CreateEnrollmentInput) =>
    request<EnrollmentDetail>('/package-enrollments', { method: 'POST', body: input }),
  renew: (id: string, input: EnrollmentTermsInput & { packageId?: string }) =>
    request<EnrollmentDetail>(`${enrollmentPath(id)}/renew`, { method: 'POST', body: input }),
  cancel: (id: string, reason: string) =>
    request<EnrollmentDetail>(`${enrollmentPath(id)}/cancel`, {
      method: 'POST',
      body: { reason },
    }),
  adjust: (id: string, input: AdjustmentInput) =>
    request<EnrollmentDetail>(`${enrollmentPath(id)}/adjust`, { method: 'POST', body: input }),
};

// ── Hooks ───────────────────────────────────────────────────────────────────

export function usePackageList(params: PackageListParams, enabled = true) {
  return useQuery({
    queryKey: keys.packageList(params),
    queryFn: () => packagesApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePackage(id: string | undefined) {
  return useQuery({
    queryKey: keys.package(id ?? ''),
    queryFn: () => packagesApi.get(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useEnrollmentList(params: EnrollmentListParams, enabled = true) {
  return useQuery({
    queryKey: keys.enrollmentList(params),
    queryFn: () => enrollmentsApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useEnrollment(id: string | undefined) {
  return useQuery({
    queryKey: keys.enrollment(id ?? ''),
    queryFn: () => enrollmentsApi.get(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useEnrollmentLedger(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.enrollmentLedger(id),
    queryFn: () => enrollmentsApi.ledger(id),
    enabled,
  });
}

export function usePatientEnrollments(patientId: string, enabled = true) {
  return useQuery({
    queryKey: keys.patientEnrollments(patientId),
    queryFn: () => enrollmentsApi.patientEnrollments(patientId),
    enabled,
  });
}

export function useEnrollmentOptions(params: EnrollmentOptionsParams | null) {
  return useQuery({
    queryKey: keys.enrollmentOptions(params ?? {}),
    queryFn: () => enrollmentsApi.options(params!),
    enabled: Boolean(params),
    placeholderData: keepPreviousData,
  });
}

function usePackageMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['packages'] }),
  });
}

export function useCreatePackage() {
  return usePackageMutation(packagesApi.create);
}

export function useUpdatePackage() {
  return usePackageMutation((v: { id: string; input: Partial<PackageInput> }) =>
    packagesApi.update(v.id, v.input),
  );
}

export function useSetPackageStatus() {
  return usePackageMutation((v: { id: string; isActive: boolean }) =>
    packagesApi.setStatus(v.id, v.isActive),
  );
}

export function useDeletePackage() {
  return usePackageMutation((id: string) => packagesApi.remove(id));
}

export function useDuplicatePackage() {
  return usePackageMutation((id: string) => packagesApi.duplicate(id));
}

/**
 * Enrollment writes change balances that packages, enrollment lists, patient tabs and
 * appointment details show, so they refresh all of those. A returned enrollment goes
 * straight into the cache.
 */
function useEnrollmentMutation<TArgs>(fn: (args: TArgs) => Promise<EnrollmentDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (saved) => {
      qc.setQueryData(keys.enrollment(saved.id), saved);
      for (const key of ['package-enrollments', 'packages', 'appointments']) {
        void qc.invalidateQueries({
          queryKey: [key],
          predicate: (q) =>
            !(
              q.queryKey[1] === 'detail' &&
              q.queryKey[2] === saved.id &&
              key === 'package-enrollments'
            ),
        });
      }
    },
  });
}

export function useCreateEnrollment() {
  return useEnrollmentMutation(enrollmentsApi.create);
}

export function useRenewEnrollment() {
  return useEnrollmentMutation(
    (v: { id: string; input: EnrollmentTermsInput & { packageId?: string } }) =>
      enrollmentsApi.renew(v.id, v.input),
  );
}

export function useCancelEnrollment() {
  return useEnrollmentMutation((v: { id: string; reason: string }) =>
    enrollmentsApi.cancel(v.id, v.reason),
  );
}

export function useAdjustEnrollment() {
  return useEnrollmentMutation((v: { id: string; input: AdjustmentInput }) =>
    enrollmentsApi.adjust(v.id, v.input),
  );
}
