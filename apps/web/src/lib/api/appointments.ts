'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  AppointmentCalendar,
  AppointmentDetail,
  AppointmentItem,
  AppointmentRecordStatus,
  AppointmentSeries,
  AppointmentType,
  AvailableSlots,
  CancellationReason,
  ClockTime,
  ISODate,
  Paginated,
  SeriesFrequency,
  SeriesOccurrence,
  SeriesPreview,
} from '../types';
import { request } from './client';
import { keys } from './keys';

export interface AppointmentListParams {
  search?: string;
  /** Center-local dates, both included */
  from?: ISODate;
  to?: ISODate;
  therapistId?: string;
  therapyTypeId?: string;
  patientId?: string;
  type?: AppointmentType;
  status?: AppointmentRecordStatus[];
  /** upcoming: from now on; past: started before now */
  timeframe?: 'upcoming' | 'past';
  /** By start time */
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface CalendarParams {
  startDate: ISODate;
  endDate: ISODate;
  therapistId?: string;
  therapyTypeId?: string;
  type?: AppointmentType;
  status?: AppointmentRecordStatus[];
}

export interface SlotParams {
  therapistId: string;
  therapyTypeId: string;
  date: ISODate;
  durationMinutes: number;
  patientId?: string;
  excludeAppointmentId?: string;
}

/** Who and what is booked, shared by single and recurring bookings */
interface BookingInput {
  patientId: string;
  type: AppointmentType;
  therapyTypeId: string;
  therapistId: string;
  durationMinutes: number;
  internalNotes?: string;
  /** Book over clashes with other appointments where the center allows double booking */
  allowOverlap?: boolean;
  /** The patient's package that pays for it: one session is held per appointment */
  packageEnrollmentId?: string;
}

export interface CreateAppointmentInput extends BookingInput {
  date: ISODate;
  startTime: ClockTime;
}

export interface RescheduleInput {
  date: ISODate;
  startTime: ClockTime;
  durationMinutes?: number;
  therapistId?: string;
  therapyTypeId?: string;
  reason?: string;
  allowOverlap?: boolean;
  /** Left out: keep the package. null: take it off. An ID: move to that package. */
  packageEnrollmentId?: string | null;
}

export interface CancelInput {
  reason: CancellationReason;
  note?: string;
}

export interface SeriesInput extends BookingInput {
  startTime: ClockTime;
  recurrence: {
    frequency: SeriesFrequency;
    interval: number;
    daysOfWeek?: number[];
    startDate: ISODate;
    endType: 'UNTIL' | 'COUNT';
    until?: ISODate;
    count?: number;
  };
}

export type StatusChange = 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW';

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
  return q.toString();
}

const path = (id: string) => `/appointments/${encodeURIComponent(id)}`;

export const appointmentsApi = {
  list: (params: AppointmentListParams) =>
    request<Paginated<AppointmentItem>>(
      `/appointments?${query({ ...params, page: params.page ?? 1, pageSize: params.pageSize ?? 20 })}`,
    ),
  calendar: (params: CalendarParams) =>
    request<AppointmentCalendar>(`/appointments/calendar?${query(params)}`),
  get: (id: string) => request<AppointmentDetail>(path(id)),
  slots: (params: SlotParams) =>
    request<AvailableSlots>(`/appointments/available-slots?${query(params)}`),
  create: (input: CreateAppointmentInput) =>
    request<AppointmentDetail>('/appointments', { method: 'POST', body: input }),
  update: (id: string, input: { type?: AppointmentType; internalNotes?: string }) =>
    request<AppointmentDetail>(path(id), { method: 'PATCH', body: input }),
  reschedule: (id: string, input: RescheduleInput) =>
    request<AppointmentDetail>(`${path(id)}/reschedule`, { method: 'PATCH', body: input }),
  cancel: (id: string, input: CancelInput) =>
    request<AppointmentDetail>(`${path(id)}/cancel`, { method: 'PATCH', body: input }),
  /** Which package pays for an open appointment; null takes it off its package */
  setPackage: (id: string, packageEnrollmentId: string | null) =>
    request<AppointmentDetail>(`${path(id)}/package`, {
      method: 'PATCH',
      body: { packageEnrollmentId },
    }),
  /** Completing records attendance first when given (it must be marked to complete). */
  setStatus: (id: string, status: StatusChange, attendance?: 'PRESENT' | 'LATE') =>
    request<AppointmentDetail>(`${path(id)}/status`, {
      method: 'PATCH',
      body: attendance ? { status, attendance } : { status },
    }),
  previewSeries: (input: SeriesInput) =>
    request<SeriesPreview>('/appointment-series/preview', { method: 'POST', body: input }),
  createSeries: (input: SeriesInput & { skipConflicts?: boolean }) =>
    request<{ series: AppointmentSeries; created: number; skipped: SeriesOccurrence[] }>(
      '/appointment-series',
      { method: 'POST', body: input },
    ),
  getSeries: (id: string) =>
    request<AppointmentSeries>(`/appointment-series/${encodeURIComponent(id)}`),
  cancelSeries: (id: string, input: CancelInput & { fromAppointmentId?: string }) =>
    request<{ cancelled: number; series: AppointmentSeries }>(
      `/appointment-series/${encodeURIComponent(id)}/cancel-future`,
      { method: 'POST', body: input },
    ),
};

// ── Hooks ───────────────────────────────────────────────────────────────────
// Every write invalidates the ['appointments'] prefix (lists, calendars, slots, details)
// and ['therapists'], whose schedules and upcoming counts include appointments.

export function useAppointmentList(params: AppointmentListParams, enabled = true) {
  return useQuery({
    queryKey: keys.appointmentList(params),
    queryFn: () => appointmentsApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAppointmentCalendar(params: CalendarParams) {
  return useQuery({
    queryKey: keys.appointmentCalendar(params),
    queryFn: () => appointmentsApi.calendar(params),
    placeholderData: keepPreviousData,
  });
}

export function useAppointment(id: string | undefined) {
  return useQuery({
    queryKey: keys.appointmentDetail(id ?? ''),
    queryFn: () => appointmentsApi.get(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

/** Slots go stale fast: always refetch on mount so a picked time was free recently. */
export function useAvailableSlots(params: SlotParams | null) {
  return useQuery({
    queryKey: keys.availableSlots(params ?? {}),
    queryFn: () => appointmentsApi.slots(params!),
    enabled: Boolean(params),
    staleTime: 0,
    retry: false,
  });
}

export function useSeriesPreview(input: SeriesInput | null) {
  return useQuery({
    queryKey: keys.seriesPreview(input ?? {}),
    queryFn: () => appointmentsApi.previewSeries(input!),
    enabled: Boolean(input),
    staleTime: 0,
    retry: false,
  });
}

export function useAppointmentSeries(id: string | undefined) {
  return useQuery({
    queryKey: keys.appointmentSeries(id ?? ''),
    queryFn: () => appointmentsApi.getSeries(id!),
    enabled: Boolean(id),
  });
}

function useAppointmentMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      // Also after failures: a 409 means someone else's booking changed what's free.
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      void qc.invalidateQueries({ queryKey: ['therapists'] });
      // Booking, moving, cancelling and completing hold, free or use package sessions.
      void qc.invalidateQueries({ queryKey: ['package-enrollments'] });
      // Completing and no-shows are session and attendance changes too.
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useCreateAppointment() {
  return useAppointmentMutation(appointmentsApi.create);
}

export function useUpdateAppointment() {
  return useAppointmentMutation(
    (v: { id: string; input: { type?: AppointmentType; internalNotes?: string } }) =>
      appointmentsApi.update(v.id, v.input),
  );
}

export function useRescheduleAppointment() {
  return useAppointmentMutation((v: { id: string; input: RescheduleInput }) =>
    appointmentsApi.reschedule(v.id, v.input),
  );
}

export function useSetAppointmentPackage() {
  return useAppointmentMutation((v: { id: string; packageEnrollmentId: string | null }) =>
    appointmentsApi.setPackage(v.id, v.packageEnrollmentId),
  );
}

export function useCancelAppointment() {
  return useAppointmentMutation((v: { id: string; input: CancelInput }) =>
    appointmentsApi.cancel(v.id, v.input),
  );
}

export function useSetAppointmentStatus() {
  return useAppointmentMutation(
    (v: { id: string; status: StatusChange; attendance?: 'PRESENT' | 'LATE' }) =>
      appointmentsApi.setStatus(v.id, v.status, v.attendance),
  );
}

export function useCreateSeries() {
  return useAppointmentMutation(appointmentsApi.createSeries);
}

export function useCancelSeries() {
  return useAppointmentMutation(
    (v: { id: string; input: CancelInput & { fromAppointmentId?: string } }) =>
      appointmentsApi.cancelSeries(v.id, v.input),
  );
}
