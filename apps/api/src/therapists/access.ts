import { HttpStatus } from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import { apiError } from '../common/errors';
import type { Prisma } from '../generated/prisma/client';

/**
 * The therapists a caller may see: every profile in their center with therapists.read,
 * otherwise (therapists.read_own) only the one linked to their own staff membership.
 * Deleted profiles are never visible. Anything outside this looks like a 404.
 */
export function visibleTherapists(
  tenant: TenantContext,
): Prisma.TherapistWhereInput {
  return {
    centerId: tenant.centerId,
    deletedAt: null,
    ...(!tenant.permissions.includes('therapists.read') && {
      membershipId: tenant.membershipId,
    }),
  };
}

export const therapistNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Therapist not found', 'NOT_FOUND');

/** The therapist's ID if the caller may see it, else a 404. */
export async function findVisibleTherapist(
  tx: Prisma.TransactionClient,
  tenant: TenantContext,
  id: string,
) {
  const row = await tx.therapist.findFirst({
    where: { id, ...visibleTherapists(tenant) },
    select: { id: true, fullName: true, status: true },
  });
  if (!row) throw therapistNotFound();
  return row;
}

/** Locks the therapist row until the transaction ends, so related writes don't interleave. */
export async function lockTherapist(
  tx: Prisma.TransactionClient,
  therapistId: string,
) {
  await tx.$queryRaw`SELECT id FROM "Therapist" WHERE id = ${therapistId}::uuid FOR UPDATE`;
}
