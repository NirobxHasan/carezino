import type { TenantContext } from '../auth/auth-context';

/**
 * How the appointments module completes appointments and marks no-shows, which belong
 * to the session lifecycle (sessions/lifecycle.service.ts): completing needs attended
 * attendance and records the session, a no-show is absent attendance. The sessions
 * module binds this (SessionsModule exports it), so this module needn't import the
 * sessions code, which builds on appointments.
 */
export interface SessionOutcomes {
  /** Completes the session, recording attendance first when given and not marked. */
  complete(
    tenant: TenantContext,
    appointmentId: string,
    input: { attendance?: 'PRESENT' | 'LATE' },
  ): Promise<void>;
  /** Marks the patient absent, which makes the appointment a no-show. */
  markAbsent(tenant: TenantContext, appointmentId: string): Promise<void>;
}

export const SESSION_OUTCOMES = Symbol('SESSION_OUTCOMES');
