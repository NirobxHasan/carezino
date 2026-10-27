import { HttpStatus } from '@nestjs/common';

import { patientsInCare } from '../assessments/access';
import type { TenantContext } from '../auth/auth-context';
import { apiError } from '../common/errors';
import type { Prisma } from '../generated/prisma/client';
import { SessionNoteStatus } from '../generated/prisma/enums';

/**
 * Who sees which sessions and notes. Every query goes through these; anything outside
 * them looks like a 404. A session is addressed by its appointment's ID.
 *
 * - Sessions (attendance, session and note status, package usage, never note content):
 *   every appointment of the center with sessions.read; otherwise (sessions.read_own)
 *   only those with the therapist profile linked to the caller's membership.
 * - Note content: every note with session_notes.read; otherwise (session_notes.read_own)
 *   the caller's own notes, drafts included, and completed notes of patients in their
 *   care, the same rule as assessments (../assessments/access.ts).
 * - Note writes: only the note's own therapist, checked by the service (isOwn).
 */

const has = (tenant: TenantContext, p: TenantContext['permissions'][number]) =>
  tenant.permissions.includes(p);

export function visibleSessions(
  tenant: TenantContext,
): Prisma.AppointmentWhereInput {
  return {
    centerId: tenant.centerId,
    ...(!has(tenant, 'sessions.read') && {
      therapist: { membershipId: tenant.membershipId },
    }),
  };
}

/** Notes whose clinical content the caller may read. */
export function readableNotes(
  tenant: TenantContext,
): Prisma.SessionNoteWhereInput {
  if (has(tenant, 'session_notes.read')) return { centerId: tenant.centerId };
  if (!has(tenant, 'session_notes.read_own')) {
    return { centerId: tenant.centerId, id: { in: [] } };
  }
  return {
    centerId: tenant.centerId,
    OR: [
      { therapist: { membershipId: tenant.membershipId } },
      {
        status: { not: SessionNoteStatus.DRAFT },
        session: { appointment: { patient: patientsInCare(tenant) } },
      },
    ],
  };
}

export const sessionNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Session not found', 'NOT_FOUND');

export const noteNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Session note not found', 'NOT_FOUND');

export const noteTemplateNotFound = () =>
  apiError(
    HttpStatus.NOT_FOUND,
    'Session note template not found',
    'NOT_FOUND',
  );
