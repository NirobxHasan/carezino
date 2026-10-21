'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CenterProfile, InvitationPreview, Me } from '../types';
import { request } from './client';
import { keys } from './keys';

// ── Requests ────────────────────────────────────────────────────────────────

/** The signed-in user, or null when there's no valid session (not an error response). */
export async function getMe(): Promise<Me | null> {
  return (await request<{ me: Me | null }>('/auth/session')).me;
}

export interface LoginInput {
  email: string;
  password: string;
  remember: boolean;
}

export interface RegisterCenterInput {
  center: {
    name: string;
    phone: string;
    email?: string;
    address: string;
    district?: string;
    country: string;
    timezone: string;
    currency: string;
    website?: string;
  };
  owner: {
    fullName: string;
    email: string;
    mobile: string;
    password: string;
    confirmPassword: string;
  };
  /** Start with the standard therapy types (OT, ABA, SLT). Defaults to true. */
  defaultTherapyTypes?: boolean;
}

export interface NewPasswordInput {
  password: string;
  confirmPassword: string;
}

export interface AcceptInvitationInput {
  token: string;
  fullName?: string;
  mobile?: string;
  password?: string;
  confirmPassword?: string;
}

export const authApi = {
  login: (input: LoginInput) => request<void>('/auth/login', { method: 'POST', body: input }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  registration: () => request<{ enabled: boolean }>('/auth/registration'),
  registerCenter: (input: RegisterCenterInput) =>
    request<{ center: CenterProfile }>('/auth/register-center', { method: 'POST', body: input }),
  forgotPassword: (email: string) =>
    request<{ message: string }>('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (input: NewPasswordInput & { token: string }) =>
    request<void>('/auth/reset-password', { method: 'POST', body: input }),
  changePassword: (input: NewPasswordInput & { currentPassword: string }) =>
    request<void>('/auth/change-password', { method: 'POST', body: input }),
  updateProfile: (input: { fullName: string; mobile: string }) =>
    request<Me>('/auth/me', { method: 'PATCH', body: input }),
  switchCenter: (centerId: string) =>
    request<void>('/centers/switch', { method: 'POST', body: { centerId } }),
  previewInvitation: (token: string) =>
    request<InvitationPreview | { valid: false; message: string }>('/invitations/preview', {
      method: 'POST',
      body: { token },
    }),
  acceptInvitation: (input: AcceptInvitationInput) =>
    request<{ centerId: string }>('/invitations/accept', { method: 'POST', body: input }),
};

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Pass `initialMe` when the server already resolved the session (protected layouts). */
export function useMe(initialMe?: Me | null) {
  return useQuery({
    queryKey: keys.me,
    queryFn: getMe,
    staleTime: 60_000,
    retry: false,
    initialData: initialMe,
  });
}

export function useRegistrationStatus() {
  return useQuery({ queryKey: ['auth', 'registration'], queryFn: authApi.registration });
}

/**
 * Wipes every cached query, so nothing from the previous user or center can be shown
 * after signing in or out or switching centers. Active queries refetch.
 */
export function useResetSessionCache() {
  const qc = useQueryClient();
  return () => qc.resetQueries();
}

export function useLogin() {
  const reset = useResetSessionCache();
  return useMutation({ mutationFn: authApi.login, onSuccess: reset });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      qc.clear();
    },
  });
}

export function useRegisterCenter() {
  const reset = useResetSessionCache();
  return useMutation({ mutationFn: authApi.registerCenter, onSuccess: reset });
}

export function useSwitchCenter() {
  const reset = useResetSessionCache();
  return useMutation({ mutationFn: authApi.switchCenter, onSuccess: reset });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.updateProfile,
    onSuccess: (me) => qc.setQueryData(keys.me, me),
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: authApi.changePassword });
}

export function useAcceptInvitation() {
  const reset = useResetSessionCache();
  return useMutation({ mutationFn: authApi.acceptInvitation, onSuccess: reset });
}
