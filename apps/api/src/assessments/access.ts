import { HttpStatus } from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import { apiError } from '../common/errors';
import type { Prisma } from '../generated/prisma/client';
import { AppointmentStatus, AssessmentStatus } from '../generated/prisma/enums';
import { visiblePatients } from '../patients/access';

/**
 * Who sees which assessments. Every assessment query goes through these; anything
 * outside them looks like a 404.
 *
 * - Clinical content: everything with assessments.read; otherwise (assessments.read_own)
 *   the caller's own assessments (by the therapist profile linked to their membership),
 *   drafts included, and completed ones of patients in their care.
 * - Status only (date, people, therapy, status): every assessment of the center with
 *   assessments.read_status, e.g. for the front desk; otherwise the same as content.
 * - Writes: only the caller's own assessments, checked by the service (isOwn).
 */

const has = (tenant: TenantContext, p: TenantContext['permissions'][number]) =>
  tenant.permissions.includes(p);

/** Assessments by the therapist profile linked to the caller's own membership. */
export function ownAssessments(
  tenant: TenantContext,
): Prisma.AssessmentWhereInput {
  return { therapist: { membershipId: tenant.membershipId } };
}

/**
 * Patients in the caller's care: those with a (not cancelled) appointment, an
 * assessment or a therapy plan with the caller's own therapist profile. Until patients
 * can be assigned to therapists, this is how therapists, who can't read the patient
 * list, reach the patients they actually see.
 */
export function patientsInCare(
  tenant: TenantContext,
): Prisma.PatientWhereInput {
  const mine = { membershipId: tenant.membershipId };
  return {
    OR: [
      {
        appointments: {
          some: {
            therapist: mine,
            status: { not: AppointmentStatus.CANCELLED },
          },
        },
      },
      { assessments: { some: { therapist: mine } } },
      { therapyPlans: { some: { therapist: mine } } },
    ],
  };
}

/** Patients the caller may assess or see the assessment history of. */
export function assessablePatients(
  tenant: TenantContext,
): Prisma.PatientWhereInput {
  return has(tenant, 'patients.read')
    ? visiblePatients(tenant)
    : { AND: [visiblePatients(tenant), patientsInCare(tenant)] };
}

/** Assessments whose clinical content the caller may read. */
export function readableAssessments(
  tenant: TenantContext,
): Prisma.AssessmentWhereInput {
  if (has(tenant, 'assessments.read')) return { centerId: tenant.centerId };
  return {
    centerId: tenant.centerId,
    OR: [
      ownAssessments(tenant),
      {
        status: { not: AssessmentStatus.DRAFT },
        patient: patientsInCare(tenant),
      },
    ],
  };
}

/** Assessments the caller may see listed, with or without their content. */
export function listableAssessments(
  tenant: TenantContext,
): Prisma.AssessmentWhereInput {
  return has(tenant, 'assessments.read') ||
    has(tenant, 'assessments.read_status')
    ? { centerId: tenant.centerId }
    : readableAssessments(tenant);
}

/** Whether the caller wrote (or will write) this assessment. */
export function isOwn(
  tenant: TenantContext,
  therapist: { membershipId: string | null },
) {
  return (
    therapist.membershipId !== null &&
    therapist.membershipId === tenant.membershipId
  );
}

export const assessmentNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Assessment not found', 'NOT_FOUND');

export const templateNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Assessment template not found', 'NOT_FOUND');
