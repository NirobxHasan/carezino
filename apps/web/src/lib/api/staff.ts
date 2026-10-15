'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  CenterProfile,
  MembershipStatus,
  Paginated,
  Role,
  StaffInvitation,
  StaffMember,
} from '../types';
import { request } from './client';
import { keys } from './keys';

export interface StaffListParams {
  search?: string;
  role?: Role | 'all';
  status?: MembershipStatus | 'all';
  page?: number;
  pageSize?: number;
}

function query(params: StaffListParams) {
  const q = new URLSearchParams();
  if (params.search?.trim()) q.set('search', params.search.trim());
  if (params.role && params.role !== 'all') q.set('role', params.role);
  if (params.status && params.status !== 'all') q.set('status', params.status);
  q.set('page', String(params.page ?? 1));
  q.set('pageSize', String(params.pageSize ?? 10));
  return q.toString();
}

export interface InviteStaffInput {
  fullName: string;
  email: string;
  mobile?: string;
  role: Role;
}

export interface InvitationResult {
  invitation: StaffInvitation;
  /** False when no email provider is configured or sending failed */
  emailDelivered: boolean;
}

export type CenterUpdate = Partial<
  Pick<
    CenterProfile,
    | 'name'
    | 'phone'
    | 'email'
    | 'address'
    | 'district'
    | 'website'
    | 'logoUrl'
    | 'timezone'
    | 'currency'
  >
>;

export const centerApi = {
  current: () => request<CenterProfile>('/centers/current'),
  update: (input: CenterUpdate) =>
    request<CenterProfile>('/centers/current', { method: 'PATCH', body: input }),
};

export const staffApi = {
  list: (params: StaffListParams) => request<Paginated<StaffMember>>(`/staff?${query(params)}`),
  get: (id: string) => request<StaffMember>(`/staff/${encodeURIComponent(id)}`),
  changeRole: (id: string, role: Role) =>
    request<StaffMember>(`/staff/${encodeURIComponent(id)}/role`, {
      method: 'PATCH',
      body: { role },
    }),
  changeStatus: (id: string, status: MembershipStatus) =>
    request<StaffMember>(`/staff/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: { status },
    }),
  invitations: () => request<StaffInvitation[]>('/staff/invitations'),
  invite: (input: InviteStaffInput) =>
    request<InvitationResult>('/staff/invitations', { method: 'POST', body: input }),
  resend: (id: string) =>
    request<InvitationResult>(`/staff/invitations/${encodeURIComponent(id)}/resend`, {
      method: 'POST',
    }),
  revoke: (id: string) =>
    request<void>(`/staff/invitations/${encodeURIComponent(id)}/revoke`, { method: 'POST' }),
};

// ── Hooks ───────────────────────────────────────────────────────────────────
// Query keys start with the center-scoped prefixes in keys.ts, and the whole cache is
// reset on center switch, so one center's data is never shown in another.

export function useCurrentCenter() {
  return useQuery({ queryKey: keys.center, queryFn: centerApi.current });
}

export function useUpdateCenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: centerApi.update,
    onSuccess: (center) => {
      qc.setQueryData(keys.center, center);
      // Name and logo appear in the app shell, which reads them from /auth/me.
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function useStaff(params: StaffListParams) {
  return useQuery({
    queryKey: keys.staff(params),
    queryFn: () => staffApi.list(params),
    placeholderData: keepPreviousData,
  });
}

export function useStaffMember(id: string | undefined) {
  return useQuery({
    queryKey: keys.staffMember(id ?? ''),
    queryFn: () => staffApi.get(id!),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useInvitations(enabled = true) {
  return useQuery({ queryKey: keys.invitations, queryFn: staffApi.invitations, enabled });
}

function useStaffMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
  });
}

export function useChangeRole() {
  return useStaffMutation((v: { id: string; role: Role }) => staffApi.changeRole(v.id, v.role));
}

export function useChangeStatus() {
  return useStaffMutation((v: { id: string; status: MembershipStatus }) =>
    staffApi.changeStatus(v.id, v.status),
  );
}

export function useInviteStaff() {
  return useStaffMutation(staffApi.invite);
}

export function useResendInvitation() {
  return useStaffMutation(staffApi.resend);
}

export function useRevokeInvitation() {
  return useStaffMutation(staffApi.revoke);
}
