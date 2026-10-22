import { HttpStatus } from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import type { Permission } from '../auth/permissions';
import { apiError } from '../common/errors';
import type { Prisma } from '../generated/prisma/client';

/**
 * The patients a caller may see: those of their own center that aren't deleted. Routes
 * already require patients.read; when therapists can be assigned patients, narrow this
 * for them here, the one place every patient query goes through. Anything outside it
 * looks like a 404.
 */
export function visiblePatients(
  tenant: TenantContext,
): Prisma.PatientWhereInput {
  return { centerId: tenant.centerId, deletedAt: null };
}

export const patientNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Patient not found', 'NOT_FOUND');

/** For checks a route decorator can't express, e.g. permissions that depend on the input. */
export function assertCan(tenant: TenantContext, permission: Permission) {
  if (!tenant.permissions.includes(permission)) {
    throw apiError(
      HttpStatus.FORBIDDEN,
      'You don’t have permission to do this',
      'FORBIDDEN',
    );
  }
}

/**
 * Locks a visible patient's row until the transaction ends, so contact changes (the
 * single primary contact in particular) can't interleave. Throws a 404 otherwise.
 */
export async function lockVisiblePatient(
  tx: Prisma.TransactionClient,
  tenant: TenantContext,
  id: string,
) {
  await tx.$queryRaw`
    SELECT id FROM "Patient"
    WHERE id = ${id}::uuid AND "centerId" = ${tenant.centerId}::uuid
    FOR UPDATE`;
  // Read after locking, so what callers check is what they'll change.
  const patient = await tx.patient.findFirst({
    where: { id, ...visiblePatients(tenant) },
    select: {
      id: true,
      code: true,
      fullName: true,
      mobile: true,
      primaryContactIsSelf: true,
      status: true,
    },
  });
  if (!patient) throw patientNotFound();
  return patient;
}
