import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { isUniqueViolation } from '../centers/centers.service';
import { apiError } from '../common/errors';
import { Prisma } from '../generated/prisma/client';
import {
  ConsentGivenBy,
  GuardianRelationship,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { assertCan, lockVisiblePatient, visiblePatients } from './access';
import {
  fieldError,
  guardianSelect,
  relationshipOf,
  resolveGuardian,
  toGuardian,
} from './contacts';
import type {
  LinkGuardianDto,
  RecordConsentDto,
  SetPrimaryContactDto,
  UpdateGuardianDto,
  UpdatePatientGuardianDto,
} from './dto';
import { PatientsService } from './patients.service';

type Tx = Prisma.TransactionClient;

const GUARDIAN_FIELDS = [
  'fullName',
  'mobile',
  'secondaryMobile',
  'email',
  'address',
] as const satisfies readonly (keyof UpdateGuardianDto)[];

const linkNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Contact not found', 'NOT_FOUND');

/**
 * A patient's contacts beyond registration: linking guardians and caregivers (new or on
 * record), their relationship to the patient, the single primary contact, unlinking, and
 * consent. Guardians are never merged or deleted here; a matching mobile is only a hint.
 * Changes to a patient's contacts return the patient, as GET /patients/:id does.
 */
@Injectable()
export class GuardiansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly patients: PatientsService,
  ) {}

  private record(
    tx: Tx,
    tenant: TenantContext,
    action: string,
    entity: { type: 'Patient' | 'Guardian'; id: string },
    metadata: Prisma.InputJsonValue,
    ipAddress: string | null,
  ) {
    return this.audit.record(
      {
        centerId: tenant.centerId,
        actorUserId: tenant.userId,
        action,
        entityType: entity.type,
        entityId: entity.id,
        metadata,
        ipAddress,
      },
      tx,
    );
  }

  private async write<T>(fn: (tx: Tx) => Promise<T>) {
    try {
      return await this.prisma.$transaction(fn);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw apiError(
          HttpStatus.CONFLICT,
          'This person is already a contact for this patient',
          'ALREADY_LINKED',
        );
      }
      throw error;
    }
  }

  /**
   * Guardians of this center whose mobile (4+ digits) or name matches, for staff to
   * recognize and confirm. Each comes with the patients already linked to them.
   */
  async search(tenant: TenantContext, q: string) {
    const digits = q.replace(/[\s\-().]/g, '').replace(/^\+?88(?=01)/, '');
    const byPhone = /^\+?\d{4,}$/.test(digits);
    const rows = await this.prisma.guardian.findMany({
      where: {
        centerId: tenant.centerId,
        ...(byPhone
          ? {
              OR: [
                { mobile: { contains: digits } },
                { secondaryMobile: { contains: digits } },
              ],
            }
          : { fullName: { contains: q, mode: 'insensitive' } }),
      },
      select: {
        ...guardianSelect,
        patients: {
          where: { patient: visiblePatients(tenant) },
          orderBy: { createdAt: 'asc' },
          take: 5,
          select: {
            relationship: true,
            customRelationship: true,
            patient: { select: { id: true, code: true, fullName: true } },
          },
        },
      },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      take: 10,
    });
    return rows.map(({ patients, ...guardian }) => ({
      ...toGuardian(guardian),
      patients: patients.map((p) => ({
        ...p.patient,
        relationship: p.relationship,
        customRelationship: p.customRelationship,
      })),
    }));
  }

  /**
   * Adds a guardian or caregiver. Linking one already on record needs guardians.read
   * (it's a lookup); a new person is a new guardian record. The first contact of a
   * patient without one becomes primary on its own.
   */
  async link(
    tenant: TenantContext,
    patientId: string,
    dto: LinkGuardianDto,
    ipAddress: string | null,
  ) {
    if (dto.guardianId) assertCan(tenant, 'guardians.read');
    await this.write(async (tx) => {
      const patient = await lockVisiblePatient(tx, tenant, patientId);
      const guardian = await resolveGuardian(tx, tenant, dto);
      if (!guardian.created) {
        const existing = await tx.patientGuardian.findUnique({
          where: {
            patientId_guardianId: { patientId, guardianId: guardian.id },
          },
          select: { id: true },
        });
        if (existing) {
          throw apiError(
            HttpStatus.CONFLICT,
            `${guardian.fullName} is already a contact for ${patient.fullName}`,
            'ALREADY_LINKED',
            { guardianId: 'Already a contact for this patient' },
          );
        }
      }
      const hasPrimary =
        patient.primaryContactIsSelf ||
        (await tx.patientGuardian.count({
          where: { patientId, isPrimary: true },
        })) > 0;
      const isPrimary = dto.isPrimary === true || !hasPrimary;
      if (isPrimary) await this.clearPrimary(tx, patientId);
      const link = await tx.patientGuardian.create({
        data: {
          patientId,
          guardianId: guardian.id,
          ...relationshipOf(dto),
          isPrimary,
        },
        select: { id: true },
      });
      await this.record(
        tx,
        tenant,
        'patient.guardian_linked',
        { type: 'Patient', id: patientId },
        {
          code: patient.code,
          relationId: link.id,
          guardianId: guardian.id,
          newGuardian: guardian.created,
          isPrimary,
        },
        ipAddress,
      );
    });
    return this.patients.get(tenant, patientId);
  }

  private async clearPrimary(tx: Tx, patientId: string) {
    await tx.patientGuardian.updateMany({
      where: { patientId, isPrimary: true },
      data: { isPrimary: false },
    });
    await tx.patient.update({
      where: { id: patientId },
      data: { primaryContactIsSelf: false },
    });
  }

  private async findLink(tx: Tx, patientId: string, relationId: string) {
    const link = await tx.patientGuardian.findFirst({
      where: { id: relationId, patientId },
      select: {
        id: true,
        guardianId: true,
        relationship: true,
        customRelationship: true,
        contactType: true,
        isEmergencyContact: true,
        isPrimary: true,
        guardian: { select: { fullName: true } },
      },
    });
    if (!link) throw linkNotFound();
    return link;
  }

  /** The relationship to this patient; the guardian's own details are unchanged. */
  async updateLink(
    tenant: TenantContext,
    patientId: string,
    relationId: string,
    dto: UpdatePatientGuardianDto,
    ipAddress: string | null,
  ) {
    await this.write(async (tx) => {
      const patient = await lockVisiblePatient(tx, tenant, patientId);
      const before = await this.findLink(tx, patientId, relationId);
      const relationship = dto.relationship ?? before.relationship;
      const custom =
        relationship === GuardianRelationship.OTHER
          ? dto.customRelationship !== undefined
            ? dto.customRelationship
            : before.customRelationship
          : null;
      if (relationship === GuardianRelationship.OTHER && !custom) {
        throw fieldError(
          'customRelationship',
          'Describe the relationship',
          'VALIDATION_FAILED',
        );
      }
      const next = {
        contactType: dto.contactType ?? before.contactType,
        relationship,
        customRelationship: custom,
        isEmergencyContact: dto.isEmergencyContact ?? before.isEmergencyContact,
      };
      const fields = (Object.keys(next) as (keyof typeof next)[]).filter(
        (k) => next[k] !== before[k],
      );
      if (!fields.length) return;
      await tx.patientGuardian.update({
        where: { id: relationId },
        data: next,
      });
      await this.record(
        tx,
        tenant,
        'patient.guardian_updated',
        { type: 'Patient', id: patientId },
        { code: patient.code, relationId, fields },
        ipAddress,
      );
    });
    return this.patients.get(tenant, patientId);
  }

  /**
   * Removes the relationship only: the guardian stays on record, with their other
   * patients and any consent they gave. The primary contact can't be removed until
   * someone else is primary, so a patient is never left without one.
   */
  async unlink(
    tenant: TenantContext,
    patientId: string,
    relationId: string,
    ipAddress: string | null,
  ) {
    await this.write(async (tx) => {
      const patient = await lockVisiblePatient(tx, tenant, patientId);
      const link = await this.findLink(tx, patientId, relationId);
      if (link.isPrimary) {
        throw apiError(
          HttpStatus.CONFLICT,
          `${link.guardian.fullName} is the primary contact. Make someone else primary before removing them.`,
          'PRIMARY_CONTACT',
        );
      }
      await tx.patientGuardian.delete({ where: { id: relationId } });
      await this.record(
        tx,
        tenant,
        'patient.guardian_unlinked',
        { type: 'Patient', id: patientId },
        {
          code: patient.code,
          relationId,
          guardianId: link.guardianId,
          relationship: link.relationship,
        },
        ipAddress,
      );
    });
    return this.patients.get(tenant, patientId);
  }

  /** One of the patient's guardian links, or the patient themselves (needs their mobile). */
  async setPrimary(
    tenant: TenantContext,
    patientId: string,
    dto: SetPrimaryContactDto,
    ipAddress: string | null,
  ) {
    if (dto.self && dto.relationId) {
      throw fieldError(
        'relationId',
        'Choose either the patient or a contact',
        'VALIDATION_FAILED',
      );
    }
    await this.write(async (tx) => {
      const patient = await lockVisiblePatient(tx, tenant, patientId);
      if (dto.self) {
        if (patient.primaryContactIsSelf) return;
        if (!patient.mobile) {
          throw fieldError(
            'mobile',
            'Add the patient’s own mobile number before making them their own contact',
            'MOBILE_REQUIRED',
          );
        }
        await this.clearPrimary(tx, patientId);
        await tx.patient.update({
          where: { id: patientId },
          data: { primaryContactIsSelf: true },
        });
      } else {
        const link = await this.findLink(tx, patientId, dto.relationId!);
        if (link.isPrimary) return;
        await this.clearPrimary(tx, patientId);
        await tx.patientGuardian.update({
          where: { id: link.id },
          data: { isPrimary: true },
        });
      }
      await this.record(
        tx,
        tenant,
        'patient.primary_contact_changed',
        { type: 'Patient', id: patientId },
        { code: patient.code, to: dto.self ? 'SELF' : dto.relationId! },
        ipAddress,
      );
    });
    return this.patients.get(tenant, patientId);
  }

  /** The guardian's own details, which every patient they're linked to shares. */
  async updateGuardian(
    tenant: TenantContext,
    guardianId: string,
    dto: UpdateGuardianDto,
    ipAddress: string | null,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.guardian.findFirst({
        where: { id: guardianId, centerId: tenant.centerId },
        select: {
          fullName: true,
          mobile: true,
          secondaryMobile: true,
          email: true,
          address: true,
        },
      });
      if (!before) {
        throw apiError(HttpStatus.NOT_FOUND, 'Guardian not found', 'NOT_FOUND');
      }
      const data: Prisma.GuardianUpdateInput = {};
      const fields: string[] = [];
      for (const field of GUARDIAN_FIELDS) {
        const value = dto[field];
        if (value === undefined || value === before[field]) continue;
        Object.assign(data, { [field]: value });
        fields.push(field);
      }
      if (!fields.length) return;
      await tx.guardian.update({ where: { id: guardianId }, data });
      await this.record(
        tx,
        tenant,
        'guardian.updated',
        { type: 'Guardian', id: guardianId },
        { fields },
        ipAddress,
      );
    });
    const row = await this.prisma.guardian.findUniqueOrThrow({
      where: { id: guardianId },
      select: guardianSelect,
    });
    return toGuardian(row);
  }

  /**
   * Appends to the consent history; a withdrawal is a new record, never an edit. A
   * guardian giving consent must be linked to the patient now.
   */
  async recordConsent(
    tenant: TenantContext,
    patientId: string,
    dto: RecordConsentDto,
    ipAddress: string | null,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const patient = await lockVisiblePatient(tx, tenant, patientId);
      let givenByName = patient.fullName;
      if (dto.givenBy === ConsentGivenBy.GUARDIAN) {
        const link = await tx.patientGuardian.findUnique({
          where: {
            patientId_guardianId: { patientId, guardianId: dto.guardianId! },
          },
          select: { guardian: { select: { fullName: true } } },
        });
        if (!link) {
          throw fieldError(
            'guardianId',
            'Choose one of the patient’s current contacts',
            'GUARDIAN_NOT_FOUND',
          );
        }
        givenByName = link.guardian.fullName;
      }
      const consent = await tx.patientConsent.create({
        data: {
          centerId: tenant.centerId,
          patientId,
          purpose: dto.purpose,
          version: dto.version ?? null,
          granted: dto.granted,
          givenBy: dto.givenBy,
          guardianId:
            dto.givenBy === ConsentGivenBy.GUARDIAN ? dto.guardianId! : null,
          givenByName,
          note: dto.note ?? null,
          recordedById: tenant.userId,
        },
        select: { id: true },
      });
      await this.record(
        tx,
        tenant,
        dto.granted ? 'patient.consent_given' : 'patient.consent_withdrawn',
        { type: 'Patient', id: patientId },
        { code: patient.code, consentId: consent.id, purpose: dto.purpose },
        ipAddress,
      );
    });
    return this.patients.get(tenant, patientId);
  }
}
