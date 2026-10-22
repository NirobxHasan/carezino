import { HttpStatus } from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import { apiError } from '../common/errors';
import type { Prisma } from '../generated/prisma/client';

/**
 * The appointments a caller may see: every one in their center with appointments.read,
 * otherwise (appointments.read_own) only those with the therapist profile linked to
 * their own staff membership. Every appointment query goes through this; anything
 * outside it looks like a 404.
 */
export function visibleAppointments(
  tenant: TenantContext,
): Prisma.AppointmentWhereInput {
  return {
    centerId: tenant.centerId,
    ...(!tenant.permissions.includes('appointments.read') && {
      therapist: { membershipId: tenant.membershipId },
    }),
  };
}

/** The same rule for recurring series. */
export function visibleSeries(
  tenant: TenantContext,
): Prisma.AppointmentSeriesWhereInput {
  return {
    centerId: tenant.centerId,
    ...(!tenant.permissions.includes('appointments.read') && {
      therapist: { membershipId: tenant.membershipId },
    }),
  };
}

export const appointmentNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Appointment not found', 'NOT_FOUND');

export const seriesNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Recurring booking not found', 'NOT_FOUND');
