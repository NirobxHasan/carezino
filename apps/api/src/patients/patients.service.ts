import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { ensureSettingsRows } from '../center-settings/defaults';
import { isUniqueViolation } from '../centers/centers.service';
import { apiError } from '../common/errors';
import { nextSequenceValue } from '../common/sequences';
import {
  addDays,
  formatIsoDate,
  parseIsoDate,
  todayIn,
  zonedToInstant,
} from '../common/time';
import { Prisma } from '../generated/prisma/client';
import {
  ConsentGivenBy,
  PatientStatus,
  ReferralSource,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertCan,
  lockVisiblePatient,
  patientNotFound,
  visiblePatients,
} from './access';
import { MAX_AGE_YEARS, patientAge } from './age';
import {
  contactSelect,
  fieldError,
  primaryContactOf,
  relationshipOf,
  resolveGuardian,
  toContact,
} from './contacts';
import type {
  ApproximateAgeDto,
  CreatePatientDto,
  ListPatientsQuery,
  UpdatePatientDto,
} from './dto';

type Tx = Prisma.TransactionClient;

/** CenterSequence name for patient codes */
const CODE_SEQUENCE = 'patient';
const OLDEST_BIRTH_DATE = new Date(Date.UTC(1900, 0, 1));

const therapyTypeSelect = {
  id: true,
  name: true,
  code: true,
  color: true,
  isActive: true,
  displayOrder: true,
} satisfies Prisma.TherapyTypeSelect;

const consentSelect = {
  id: true,
  purpose: true,
  version: true,
  granted: true,
  givenBy: true,
  guardianId: true,
  givenByName: true,
  note: true,
  recordedAt: true,
  recordedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.PatientConsentSelect;

/** What lists show: enough to recognize and reach a patient, nothing clinical. */
const listSelect = {
  id: true,
  code: true,
  fullName: true,
  gender: true,
  dateOfBirth: true,
  approxAgeMonths: true,
  approxAgeAsOf: true,
  photoUrl: true,
  status: true,
  mobile: true,
  primaryContactIsSelf: true,
  registeredAt: true,
  createdAt: true,
  updatedAt: true,
  therapyInterests: { select: { therapyType: { select: therapyTypeSelect } } },
  guardians: {
    where: { isPrimary: true },
    take: 1,
    select: {
      isPrimary: true,
      contactType: true,
      relationship: true,
      customRelationship: true,
      guardian: { select: { fullName: true, mobile: true } },
    },
  },
} satisfies Prisma.PatientSelect;

const detailSelect = {
  ...listSelect,
  primaryConcern: true,
  secondaryMobile: true,
  email: true,
  address: true,
  emergencyPhone: true,
  referralSource: true,
  referralOther: true,
  internalNotes: true,
  registeredBy: { select: { id: true, fullName: true } },
  guardians: {
    select: contactSelect,
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
  consents: { select: consentSelect, orderBy: { recordedAt: 'desc' } },
} satisfies Prisma.PatientSelect;

/** Just the columns an update compares: no relations, so it's safe inside a transaction. */
const editableSelect = {
  code: true,
  fullName: true,
  dateOfBirth: true,
  approxAgeMonths: true,
  gender: true,
  photoUrl: true,
  primaryConcern: true,
  mobile: true,
  secondaryMobile: true,
  email: true,
  address: true,
  emergencyPhone: true,
  primaryContactIsSelf: true,
  referralSource: true,
  referralOther: true,
  internalNotes: true,
} satisfies Prisma.PatientSelect;

type ListRow = Prisma.PatientGetPayload<{ select: typeof listSelect }>;
type DetailRow = Prisma.PatientGetPayload<{ select: typeof detailSelect }>;

/** Plain columns PATCH copies when they differ. */
const EDITABLE = [
  'fullName',
  'gender',
  'photoUrl',
  'primaryConcern',
  'mobile',
  'secondaryMobile',
  'email',
  'address',
  'emergencyPhone',
  'internalNotes',
] as const satisfies readonly (keyof UpdatePatientDto)[];

/** In the center's therapy type order; inactive types stay, flagged. */
function toInterests(rows: ListRow['therapyInterests']) {
  return rows
    .map((r) => r.therapyType)
    .sort(
      (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
    )
    .map((t) => ({
      therapyTypeId: t.id,
      name: t.name,
      code: t.code,
      color: t.color,
      isActive: t.isActive,
    }));
}

function toListItem(row: ListRow, today: Date) {
  return {
    id: row.id,
    code: row.code,
    fullName: row.fullName,
    gender: row.gender,
    dateOfBirth: row.dateOfBirth && formatIsoDate(row.dateOfBirth),
    age: patientAge(row, today),
    photoUrl: row.photoUrl,
    status: row.status,
    registeredAt: row.registeredAt,
    therapyInterests: toInterests(row.therapyInterests),
    primaryContact: primaryContactOf(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Center-scoped patient records: registration, the list, profile edits, status and soft
 * deletion. Contacts beyond the first live in GuardiansService. Registration needs no
 * assessment, therapist, plan, package or payment.
 */
@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async timezone(tenant: TenantContext) {
    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: { timezone: true },
    });
    return center.timezone;
  }

  async list(tenant: TenantContext, query: ListPatientsQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const timezone = await this.timezone(tenant);
    const range = this.registrationRange(query, timezone);
    const search = query.search;
    // "+880 1712-…" should find 01712…, which is how BD mobiles are stored.
    const digits = search
      ?.replace(/[\s\-().]/g, '')
      .replace(/^\+?88(?=01)/, '');
    const phoneLike = digits !== undefined && /^\+?\d{3,}$/.test(digits);
    const where: Prisma.PatientWhereInput = {
      ...visiblePatients(tenant),
      ...(query.status && { status: query.status }),
      ...(query.gender && { gender: query.gender }),
      ...(query.therapyTypeId && {
        therapyInterests: { some: { therapyTypeId: query.therapyTypeId } },
      }),
      ...(range && { registeredAt: range }),
      ...(search && {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
          {
            guardians: {
              some: {
                guardian: {
                  fullName: { contains: search, mode: 'insensitive' },
                },
              },
            },
          },
          ...(phoneLike
            ? [
                { mobile: { contains: digits } },
                { secondaryMobile: { contains: digits } },
                {
                  guardians: {
                    some: {
                      guardian: {
                        OR: [
                          { mobile: { contains: digits } },
                          { secondaryMobile: { contains: digits } },
                        ],
                      },
                    },
                  },
                },
              ]
            : []),
        ],
      }),
    };
    const sortBy = query.sortBy ?? 'registeredAt';
    const order =
      query.sortOrder ?? (sortBy === 'registeredAt' ? 'desc' : 'asc');
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.patient.count({ where }),
      this.prisma.patient.findMany({
        where,
        select: listSelect,
        orderBy: [{ [sortBy]: order }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const today = todayIn(timezone);
    return {
      items: rows.map((r) => toListItem(r, today)),
      total,
      page,
      pageSize,
    };
  }

  /** Center-local dates, both included, as a half-open range of instants. */
  private registrationRange(query: ListPatientsQuery, timezone: string) {
    const parse = (field: 'registeredFrom' | 'registeredTo') => {
      const value = query[field];
      if (!value) return null;
      const date = parseIsoDate(value);
      if (!date)
        throw fieldError(field, 'Choose a valid date', 'VALIDATION_FAILED');
      return date;
    };
    const from = parse('registeredFrom');
    const to = parse('registeredTo');
    if (!from && !to) return null;
    return {
      ...(from && { gte: zonedToInstant(from, 0, timezone) }),
      ...(to && { lt: zonedToInstant(addDays(to, 1), 0, timezone) }),
    };
  }

  /**
   * Writes return this after committing rather than reading it inside the transaction:
   * Prisma loads sibling relations in parallel, which a transaction's single connection
   * can't do.
   */
  async get(tenant: TenantContext, id: string) {
    const row = await this.prisma.patient.findFirst({
      where: { id, ...visiblePatients(tenant) },
      select: detailSelect,
    });
    if (!row) throw patientNotFound();
    return this.toDetail(row, todayIn(await this.timezone(tenant)));
  }

  private toDetail(row: DetailRow, today: Date) {
    return {
      ...toListItem(row, today),
      approximateAgeRecordedOn: row.approxAgeAsOf
        ? formatIsoDate(row.approxAgeAsOf)
        : null,
      primaryConcern: row.primaryConcern,
      mobile: row.mobile,
      secondaryMobile: row.secondaryMobile,
      email: row.email,
      address: row.address,
      emergencyPhone: row.emergencyPhone,
      primaryContactIsSelf: row.primaryContactIsSelf,
      referralSource: row.referralSource,
      referralOther: row.referralOther,
      internalNotes: row.internalNotes,
      registeredBy: row.registeredBy,
      contacts: row.guardians.map(toContact),
      consents: row.consents,
    };
  }

  /** Runs a write in a transaction, mapping unique-index races to a 409. */
  private async write<T>(fn: (tx: Tx) => Promise<T>) {
    try {
      return await this.prisma.$transaction(fn);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw apiError(
          HttpStatus.CONFLICT,
          'Someone else just changed this patient. Reload and try again.',
          'CONFLICT',
        );
      }
      throw error;
    }
  }

  private record(
    tx: Tx,
    tenant: TenantContext,
    action: string,
    entityId: string,
    metadata: Prisma.InputJsonValue,
    ipAddress: string | null,
  ) {
    return this.audit.record(
      {
        centerId: tenant.centerId,
        actorUserId: tenant.userId,
        action,
        entityType: 'Patient',
        entityId,
        metadata,
        ipAddress,
      },
      tx,
    );
  }

  private async generalSettings(tx: Tx, centerId: string) {
    await ensureSettingsRows(tx, centerId);
    return tx.centerGeneralSettings.findUniqueOrThrow({
      where: { centerId },
      select: {
        autoGeneratePatientCode: true,
        patientCodePrefix: true,
        defaultPatientStatus: true,
      },
    });
  }

  private async assertCodeFree(tx: Tx, centerId: string, code: string) {
    // Deleted patients keep their codes, so those count too.
    const taken = await tx.patient.findFirst({
      where: { centerId, code },
      select: { id: true },
    });
    if (taken) {
      throw apiError(
        HttpStatus.CONFLICT,
        `Patient ID ${code} is already in use`,
        'CODE_TAKEN',
        { code: `Patient ID ${code} is already in use` },
      );
    }
  }

  /**
   * The next code from the center's sequence, e.g. P-0042, in its current prefix. Codes
   * typed by hand earlier are skipped rather than duplicated; numbers are never reused.
   */
  private async generateCode(tx: Tx, centerId: string, prefix: string | null) {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const n = await nextSequenceValue(tx, centerId, CODE_SEQUENCE);
      const code = `${prefix ?? ''}${String(n).padStart(4, '0')}`;
      const taken = await tx.patient.findFirst({
        where: { centerId, code },
        select: { id: true },
      });
      if (!taken) return code;
    }
    throw new Error('No free patient code found');
  }

  /** A real calendar date from 1900 up to today in the center. */
  private parseDateOfBirth(value: string, today: Date) {
    const date = parseIsoDate(value);
    if (!date || date < OLDEST_BIRTH_DATE || date > today) {
      throw fieldError(
        'dateOfBirth',
        date && date > today
          ? 'The date of birth can’t be in the future'
          : 'Choose a valid date of birth',
        'VALIDATION_FAILED',
      );
    }
    return date;
  }

  private approxMonths(age: ApproximateAgeDto) {
    const months = age.years * 12 + (age.months ?? 0);
    if (months > MAX_AGE_YEARS * 12) {
      throw fieldError(
        'approximateAge.years',
        `Enter an age up to ${MAX_AGE_YEARS} years`,
        'VALIDATION_FAILED',
      );
    }
    return months;
  }

  /**
   * Checks requested therapy interests against the center's therapy types. Another
   * center's types don't exist as far as this is concerned; inactive types can stay on
   * a patient but can't be newly chosen.
   */
  private async assertTherapyTypes(
    tx: Tx,
    tenant: TenantContext,
    ids: string[],
    current: string[],
  ) {
    if (!ids.length) return;
    const types = await tx.therapyType.findMany({
      where: { id: { in: ids }, centerId: tenant.centerId },
      select: { id: true, name: true, isActive: true },
    });
    if (types.length !== ids.length) {
      throw fieldError(
        'therapyTypeIds',
        'One of the selected therapy services no longer exists. Reload and try again.',
        'THERAPY_TYPE_NOT_FOUND',
      );
    }
    const inactive = types.find((t) => !t.isActive && !current.includes(t.id));
    if (inactive) {
      throw fieldError(
        'therapyTypeIds',
        `${inactive.name} is inactive, so it can’t be chosen. Activate it in Settings first.`,
        'THERAPY_TYPE_INACTIVE',
      );
    }
  }

  private assertReferral(source: ReferralSource | null, other: string | null) {
    if (source === ReferralSource.OTHER && !other) {
      throw fieldError(
        'referralOther',
        'Say who referred the patient',
        'VALIDATION_FAILED',
      );
    }
  }

  async create(
    tenant: TenantContext,
    dto: CreatePatientDto,
    ipAddress: string | null,
  ) {
    const contact = dto.contact;
    const self = contact.contactType === 'SELF';
    // Picking a guardian on record means looking them up; anyone else is a new record.
    if (!self)
      assertCan(
        tenant,
        contact.guardianId ? 'guardians.read' : 'guardians.create',
      );
    if (dto.dateOfBirth && dto.approximateAge) {
      throw fieldError(
        'approximateAge',
        'Enter a date of birth or an approximate age, not both',
        'VALIDATION_FAILED',
      );
    }
    const today = todayIn(await this.timezone(tenant));
    const dateOfBirth = dto.dateOfBirth
      ? this.parseDateOfBirth(dto.dateOfBirth, today)
      : null;
    const approxAgeMonths = dto.approximateAge
      ? this.approxMonths(dto.approximateAge)
      : null;
    const referralSource = dto.referralSource ?? null;
    const referralOther =
      referralSource === ReferralSource.OTHER
        ? (dto.referralOther ?? null)
        : null;
    this.assertReferral(referralSource, referralOther);
    const therapyTypeIds = dto.therapyTypeIds ?? [];
    const purposes = new Set(dto.consents?.map((c) => c.purpose));
    if (purposes.size !== (dto.consents?.length ?? 0)) {
      throw fieldError(
        'consents',
        'Each consent can only be recorded once',
        'VALIDATION_FAILED',
      );
    }

    const id = await this.write(async (tx) => {
      const settings = await this.generalSettings(tx, tenant.centerId);
      await this.assertTherapyTypes(tx, tenant, therapyTypeIds, []);
      const guardian = self
        ? null
        : await resolveGuardian(tx, tenant, contact, 'contact.');

      let code: string;
      if (settings.autoGeneratePatientCode) {
        if (dto.code) {
          throw fieldError(
            'code',
            'Patient IDs are generated automatically at this center',
            'CODE_AUTOMATIC',
          );
        }
        // Last, so the sequence row is locked for as short a time as possible.
        code = await this.generateCode(
          tx,
          tenant.centerId,
          settings.patientCodePrefix,
        );
      } else {
        if (!dto.code) {
          throw fieldError('code', 'Enter a patient ID', 'VALIDATION_FAILED');
        }
        await this.assertCodeFree(tx, tenant.centerId, dto.code);
        code = dto.code;
      }

      const patient = await tx.patient.create({
        data: {
          centerId: tenant.centerId,
          code,
          fullName: dto.fullName,
          dateOfBirth,
          approxAgeMonths,
          approxAgeAsOf: approxAgeMonths === null ? null : today,
          gender: dto.gender ?? null,
          photoUrl: dto.photoUrl ?? null,
          primaryConcern: dto.primaryConcern ?? null,
          // A self-managing patient's own details; a guardian's go on the guardian.
          mobile: self ? contact.mobile! : null,
          secondaryMobile: self ? (contact.secondaryMobile ?? null) : null,
          email: self ? (contact.email ?? null) : null,
          address: self ? (contact.address ?? null) : null,
          emergencyPhone: dto.emergencyPhone ?? null,
          primaryContactIsSelf: self,
          status: dto.status ?? settings.defaultPatientStatus,
          referralSource,
          referralOther,
          internalNotes: dto.internalNotes ?? null,
          registeredById: tenant.userId,
          therapyInterests: {
            create: therapyTypeIds.map((therapyTypeId) => ({ therapyTypeId })),
          },
        },
        select: { id: true, fullName: true },
      });
      if (guardian) {
        await tx.patientGuardian.create({
          data: {
            patientId: patient.id,
            guardianId: guardian.id,
            ...relationshipOf(contact),
            isPrimary: true,
          },
        });
      }
      if (dto.consents?.length) {
        await tx.patientConsent.createMany({
          data: dto.consents.map((c) => ({
            centerId: tenant.centerId,
            patientId: patient.id,
            purpose: c.purpose,
            version: c.version ?? null,
            granted: true,
            givenBy: guardian ? ConsentGivenBy.GUARDIAN : ConsentGivenBy.SELF,
            guardianId: guardian?.id ?? null,
            givenByName: guardian?.fullName ?? patient.fullName,
            recordedById: tenant.userId,
          })),
        });
      }
      // Codes and IDs only: names and health details stay out of the audit log.
      await this.record(
        tx,
        tenant,
        'patient.registered',
        patient.id,
        {
          code,
          contactType: contact.contactType,
          guardianId: guardian?.id ?? null,
          newGuardian: guardian?.created ?? false,
          therapyTypeIds,
          consents: [...purposes],
        },
        ipAddress,
      );
      return patient.id;
    });
    return this.get(tenant, id);
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdatePatientDto,
    ipAddress: string | null,
  ) {
    if (dto.dateOfBirth && dto.approximateAge) {
      throw fieldError(
        'approximateAge',
        'Enter a date of birth or an approximate age, not both',
        'VALIDATION_FAILED',
      );
    }
    const today = todayIn(await this.timezone(tenant));
    await this.write(async (tx) => {
      await lockVisiblePatient(tx, tenant, id);
      const before = await tx.patient.findUniqueOrThrow({
        where: { id },
        select: editableSelect,
      });
      const data: Prisma.PatientUncheckedUpdateInput = {};
      const changed = new Set<string>();

      for (const field of EDITABLE) {
        const value = dto[field];
        if (value === undefined || value === before[field]) continue;
        Object.assign(data, { [field]: value });
        changed.add(field);
      }
      if (data.mobile === null && before.primaryContactIsSelf) {
        throw fieldError(
          'mobile',
          'The patient is their own primary contact, so their mobile is required. Make someone else primary first.',
          'VALIDATION_FAILED',
        );
      }

      // A date of birth and an approximate age replace each other.
      if (dto.dateOfBirth !== undefined) {
        const dob = dto.dateOfBirth
          ? this.parseDateOfBirth(dto.dateOfBirth, today)
          : null;
        if (dob?.getTime() !== before.dateOfBirth?.getTime()) {
          data.dateOfBirth = dob;
          changed.add('dateOfBirth');
        }
        if (dob && before.approxAgeMonths !== null) {
          data.approxAgeMonths = null;
          data.approxAgeAsOf = null;
          changed.add('approximateAge');
        }
      }
      if (dto.approximateAge !== undefined) {
        if (dto.approximateAge) {
          data.approxAgeMonths = this.approxMonths(dto.approximateAge);
          data.approxAgeAsOf = today;
          changed.add('approximateAge');
          if (before.dateOfBirth) {
            data.dateOfBirth = null;
            changed.add('dateOfBirth');
          }
        } else if (before.approxAgeMonths !== null) {
          data.approxAgeMonths = null;
          data.approxAgeAsOf = null;
          changed.add('approximateAge');
        }
      }

      const source =
        dto.referralSource !== undefined
          ? dto.referralSource
          : before.referralSource;
      const other =
        source === ReferralSource.OTHER
          ? dto.referralOther !== undefined
            ? dto.referralOther
            : before.referralOther
          : null;
      this.assertReferral(source, other);
      if (source !== before.referralSource) {
        data.referralSource = source;
        changed.add('referralSource');
      }
      if (other !== before.referralOther) {
        data.referralOther = other;
        changed.add('referralOther');
      }

      if (dto.code !== undefined && dto.code !== before.code) {
        const settings = await this.generalSettings(tx, tenant.centerId);
        if (settings.autoGeneratePatientCode) {
          throw fieldError(
            'code',
            'Patient IDs are generated automatically at this center and can’t be changed',
            'CODE_AUTOMATIC',
          );
        }
        await this.assertCodeFree(tx, tenant.centerId, dto.code);
        data.code = dto.code;
        changed.add('code');
      }

      let interests: { added: string[]; removed: string[] } | null = null;
      if (dto.therapyTypeIds !== undefined) {
        const current = (
          await tx.patientTherapyInterest.findMany({
            where: { patientId: id },
            select: { therapyTypeId: true },
          })
        ).map((r) => r.therapyTypeId);
        const wanted = dto.therapyTypeIds;
        await this.assertTherapyTypes(tx, tenant, wanted, current);
        const added = wanted.filter((t) => !current.includes(t));
        const removed = current.filter((t) => !wanted.includes(t));
        if (added.length || removed.length) {
          await tx.patientTherapyInterest.deleteMany({
            where: { patientId: id, therapyTypeId: { in: removed } },
          });
          await tx.patientTherapyInterest.createMany({
            data: added.map((therapyTypeId) => ({
              patientId: id,
              therapyTypeId,
            })),
          });
          interests = { added, removed };
          changed.add('therapyTypeIds');
        }
      }

      if (!changed.size) return;
      if (Object.keys(data).length) {
        await tx.patient.update({ where: { id }, data });
      } else {
        // Only interests changed: still mark the record as updated.
        await tx.patient.update({
          where: { id },
          data: { updatedAt: new Date() },
        });
      }
      await this.record(
        tx,
        tenant,
        'patient.updated',
        id,
        {
          code: typeof data.code === 'string' ? data.code : before.code,
          // Which fields, not their values: they can hold health and contact details.
          fields: [...changed],
          ...(interests && { therapyInterests: interests }),
        },
        ipAddress,
      );
    });
    return this.get(tenant, id);
  }

  /**
   * Status only: deactivating keeps the record, contacts, and any assessments,
   * appointments and invoices as they are. Booked appointments aren't cancelled.
   */
  async setStatus(
    tenant: TenantContext,
    id: string,
    status: PatientStatus,
    ipAddress: string | null,
  ) {
    await this.write(async (tx) => {
      const before = await lockVisiblePatient(tx, tenant, id);
      if (before.status === status) return;
      await tx.patient.update({ where: { id }, data: { status } });
      await this.record(
        tx,
        tenant,
        status === PatientStatus.INACTIVE
          ? 'patient.deactivated'
          : 'patient.activated',
        id,
        { code: before.code, from: before.status, to: status },
        ipAddress,
      );
    });
    return this.get(tenant, id);
  }

  /**
   * Soft delete: the patient disappears from lists and lookups but stays in the database,
   * with contacts, consents and everything else that refers to them, so it can be
   * restored. Guardians are never deleted.
   */
  async remove(tenant: TenantContext, id: string, ipAddress: string | null) {
    await this.write(async (tx) => {
      const before = await lockVisiblePatient(tx, tenant, id);
      await tx.patient.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.record(
        tx,
        tenant,
        'patient.deleted',
        id,
        { code: before.code, status: before.status },
        ipAddress,
      );
    });
  }
}
