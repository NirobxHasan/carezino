import { HttpStatus } from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import { apiError } from '../common/errors';
import type { Prisma } from '../generated/prisma/client';
import {
  GuardianContactType,
  GuardianRelationship,
} from '../generated/prisma/enums';
import type { ContactType } from './dto';

type Tx = Prisma.TransactionClient;

/** A 400 with the message on one field, for errors only the service can detect. */
export function fieldError(field: string, message: string, code: string) {
  return apiError(HttpStatus.BAD_REQUEST, message, code, { [field]: message });
}

export const guardianSelect = {
  id: true,
  fullName: true,
  mobile: true,
  secondaryMobile: true,
  email: true,
  address: true,
  updatedAt: true,
  // Patients who'd see a change to this guardian's details
  _count: {
    select: { patients: { where: { patient: { deletedAt: null } } } },
  },
} satisfies Prisma.GuardianSelect;

export const contactSelect = {
  id: true,
  contactType: true,
  relationship: true,
  customRelationship: true,
  isPrimary: true,
  isEmergencyContact: true,
  createdAt: true,
  guardian: { select: guardianSelect },
} satisfies Prisma.PatientGuardianSelect;

type GuardianRow = Prisma.GuardianGetPayload<{
  select: typeof guardianSelect;
}>;
type ContactRow = Prisma.PatientGuardianGetPayload<{
  select: typeof contactSelect;
}>;

export function toGuardian(row: GuardianRow) {
  const { _count, ...rest } = row;
  return { ...rest, linkedPatientCount: _count.patients };
}

/** A guardian as linked to one patient: the person plus this relationship. */
export function toContact(row: ContactRow) {
  return {
    relationId: row.id,
    guardianId: row.guardian.id,
    contactType: row.contactType,
    relationship: row.relationship,
    customRelationship: row.customRelationship,
    isPrimary: row.isPrimary,
    isEmergencyContact: row.isEmergencyContact,
    linkedAt: row.createdAt,
    guardian: toGuardian(row.guardian),
  };
}

/** Who to call first, in the same shape whether it's the patient or a guardian. */
export function primaryContactOf(patient: {
  fullName: string;
  mobile: string | null;
  primaryContactIsSelf: boolean;
  guardians: {
    isPrimary: boolean;
    contactType: GuardianContactType;
    relationship: GuardianRelationship;
    customRelationship: string | null;
    guardian: { fullName: string; mobile: string };
  }[];
}): {
  type: ContactType;
  name: string;
  mobile: string | null;
  relationship: GuardianRelationship | null;
  customRelationship: string | null;
} | null {
  if (patient.primaryContactIsSelf) {
    return {
      type: 'SELF',
      name: patient.fullName,
      mobile: patient.mobile,
      relationship: null,
      customRelationship: null,
    };
  }
  const link = patient.guardians.find((g) => g.isPrimary);
  if (!link) return null;
  return {
    type: link.contactType,
    name: link.guardian.fullName,
    mobile: link.guardian.mobile,
    relationship: link.relationship,
    customRelationship: link.customRelationship,
  };
}

/** The relationship columns of a link; a custom label only goes with OTHER. */
export function relationshipOf(input: {
  contactType: ContactType;
  relationship?: GuardianRelationship;
  customRelationship?: string;
  isEmergencyContact?: boolean;
}) {
  return {
    contactType:
      input.contactType === 'CAREGIVER'
        ? GuardianContactType.CAREGIVER
        : GuardianContactType.GUARDIAN,
    relationship: input.relationship!,
    customRelationship:
      input.relationship === GuardianRelationship.OTHER
        ? (input.customRelationship ?? null)
        : null,
    isEmergencyContact: input.isEmergencyContact ?? false,
  };
}

/**
 * The guardian a new link points at: an existing one of this center (never another
 * center's: those don't exist as far as this is concerned), or a new record. An existing
 * guardian's details are left untouched.
 */
export async function resolveGuardian(
  tx: Tx,
  tenant: TenantContext,
  input: {
    guardianId?: string;
    fullName?: string;
    mobile?: string;
    secondaryMobile?: string;
    email?: string;
    address?: string;
  },
  pathPrefix = '',
) {
  if (input.guardianId) {
    const existing = await tx.guardian.findFirst({
      where: { id: input.guardianId, centerId: tenant.centerId },
      select: { id: true, fullName: true },
    });
    if (!existing) {
      throw fieldError(
        `${pathPrefix}guardianId`,
        'That guardian no longer exists. Search again or add them as new.',
        'GUARDIAN_NOT_FOUND',
      );
    }
    return { ...existing, created: false };
  }
  const created = await tx.guardian.create({
    data: {
      centerId: tenant.centerId,
      fullName: input.fullName!,
      mobile: input.mobile!,
      secondaryMobile: input.secondaryMobile ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
    },
    select: { id: true, fullName: true },
  });
  return { ...created, created: true };
}
