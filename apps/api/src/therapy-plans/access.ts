import { HttpStatus } from '@nestjs/common';

import { patientsInCare } from '../assessments/access';
import type { TenantContext } from '../auth/auth-context';
import { apiError } from '../common/errors';
import type { Prisma } from '../generated/prisma/client';
import { TherapyPlanStatus } from '../generated/prisma/enums';

/**
 * Who sees which therapy plans. Every plan query goes through these; anything outside
 * them looks like a 404. The same shape as assessments (../assessments/access.ts):
 *
 * - Clinical content (goals, progress, reviews, notes, history): every plan with
 *   therapy_plans.read; otherwise (therapy_plans.read_own) the caller's own plans (by
 *   the therapist profile linked to their membership), drafts included, and non-draft
 *   plans of patients in their care, e.g. a colleague's SLT plan for their OT patient.
 * - Status only (patient, therapy, therapist, frequency, dates, status): every plan of
 *   the center with therapy_plans.read_status, for front desk scheduling and managers'
 *   oversight of active plans and upcoming reviews.
 * - Clinical writes: only the responsible therapist, checked by the service (isOwn).
 */

const has = (tenant: TenantContext, p: TenantContext['permissions'][number]) =>
  tenant.permissions.includes(p);

/** Plans whose responsible therapist is linked to the caller's own membership. */
export function ownPlans(tenant: TenantContext): Prisma.TherapyPlanWhereInput {
  return { therapist: { membershipId: tenant.membershipId } };
}

/** Plans whose clinical content the caller may read. */
export function readablePlans(
  tenant: TenantContext,
): Prisma.TherapyPlanWhereInput {
  if (has(tenant, 'therapy_plans.read')) return { centerId: tenant.centerId };
  return {
    centerId: tenant.centerId,
    OR: [
      ownPlans(tenant),
      {
        status: { not: TherapyPlanStatus.DRAFT },
        patient: patientsInCare(tenant),
      },
    ],
  };
}

/** Plans the caller may see listed, with or without their content. */
export function listablePlans(
  tenant: TenantContext,
): Prisma.TherapyPlanWhereInput {
  return has(tenant, 'therapy_plans.read') ||
    has(tenant, 'therapy_plans.read_status')
    ? { centerId: tenant.centerId }
    : readablePlans(tenant);
}

/** Whether the caller is (linked to) the plan's responsible therapist. */
export function isOwn(
  tenant: TenantContext,
  therapist: { membershipId: string | null },
) {
  return (
    therapist.membershipId !== null &&
    therapist.membershipId === tenant.membershipId
  );
}

export const planNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Therapy plan not found', 'NOT_FOUND');

export const goalNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Goal not found', 'NOT_FOUND');

export const reviewNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Review not found', 'NOT_FOUND');

export const categoryNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Goal category not found', 'NOT_FOUND');
