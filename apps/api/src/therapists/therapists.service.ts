import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import type { Permission } from '../auth/permissions';
import { isUniqueViolation } from '../centers/centers.service';
import { apiError } from '../common/errors';
import { lockCenter } from '../common/locks';
import { addDays, formatIsoDate, parseIsoDate, todayIn } from '../common/time';
import { Prisma } from '../generated/prisma/client';
import { MembershipStatus, TherapistStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  findVisibleTherapist,
  lockTherapist,
  therapistNotFound,
  visibleTherapists,
} from './access';
import {
  THERAPIST_APPOINTMENTS,
  type TherapistAppointments,
} from './appointments.port';
import {
  AvailabilityService,
  summarizeAvailability,
  validateAvailability,
} from './availability.service';
import type {
  CreateTherapistDto,
  ListTherapistsQuery,
  SpecializationsDto,
  UpdateTherapistDto,
} from './dto';

type Tx = Prisma.TransactionClient;

const CODE_PREFIX = 'TH-';

const specializationSelect = {
  isPrimary: true,
  createdAt: true,
  therapyType: {
    select: {
      id: true,
      name: true,
      code: true,
      color: true,
      isActive: true,
      displayOrder: true,
    },
  },
} satisfies Prisma.TherapistSpecializationSelect;

const listSelect = {
  id: true,
  code: true,
  fullName: true,
  mobile: true,
  email: true,
  gender: true,
  photoUrl: true,
  designation: true,
  employmentType: true,
  joiningDate: true,
  status: true,
  membershipId: true,
  createdAt: true,
  updatedAt: true,
  specializations: { select: specializationSelect },
  availability: {
    where: { isActive: true },
    select: { dayOfWeek: true, startMinutes: true, endMinutes: true },
  },
} satisfies Prisma.TherapistSelect;

const detailSelect = {
  ...listSelect,
  qualifications: true,
  registrationNumber: true,
  yearsOfExperience: true,
  notes: true,
  membership: {
    select: {
      id: true,
      role: true,
      status: true,
      user: { select: { fullName: true, email: true } },
    },
  },
} satisfies Prisma.TherapistSelect;

/** Just the columns an update compares: no relations, so it's safe inside a transaction. */
const editableSelect = {
  fullName: true,
  mobile: true,
  email: true,
  gender: true,
  photoUrl: true,
  designation: true,
  qualifications: true,
  registrationNumber: true,
  yearsOfExperience: true,
  employmentType: true,
  notes: true,
  joiningDate: true,
  membershipId: true,
} satisfies Prisma.TherapistSelect;

type ListRow = Prisma.TherapistGetPayload<{ select: typeof listSelect }>;
type DetailRow = Prisma.TherapistGetPayload<{ select: typeof detailSelect }>;
type SpecializationRow = ListRow['specializations'][number];

/** Primary first, then in the center's therapy type order. */
function toSpecializations(rows: SpecializationRow[]) {
  return [...rows]
    .sort(
      (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) ||
        a.therapyType.displayOrder - b.therapyType.displayOrder ||
        a.therapyType.name.localeCompare(b.therapyType.name),
    )
    .map((s) => ({
      therapyTypeId: s.therapyType.id,
      name: s.therapyType.name,
      code: s.therapyType.code,
      color: s.therapyType.color,
      /** Inactive types stay on the profile but can't be booked */
      isActive: s.therapyType.isActive,
      isPrimary: s.isPrimary,
      assignedAt: s.createdAt,
    }));
}

function toListItem(row: ListRow, tenant: TenantContext) {
  const { availability, membershipId, specializations, ...rest } = row;
  return {
    ...rest,
    joiningDate: row.joiningDate ? formatIsoDate(row.joiningDate) : null,
    specializations: toSpecializations(specializations),
    availabilitySummary: summarizeAvailability(availability),
    hasAccount: membershipId !== null,
    isYou: membershipId !== null && membershipId === tenant.membershipId,
  };
}

/** What stops new bookings with this therapist, so screens can say what's missing. */
function bookingIssues(row: ListRow) {
  const issues: ('INACTIVE' | 'NO_SPECIALIZATION' | 'NO_AVAILABILITY')[] = [];
  if (row.status !== TherapistStatus.ACTIVE) issues.push('INACTIVE');
  if (!row.specializations.some((s) => s.therapyType.isActive)) {
    issues.push('NO_SPECIALIZATION');
  }
  if (!row.availability.length) issues.push('NO_AVAILABILITY');
  return issues;
}

const EDITABLE = [
  'fullName',
  'mobile',
  'email',
  'gender',
  'photoUrl',
  'designation',
  'qualifications',
  'registrationNumber',
  'yearsOfExperience',
  'employmentType',
  'notes',
] as const satisfies readonly (keyof UpdateTherapistDto)[];

/**
 * Center-scoped therapist profiles: the professional record (not a login) that bookings,
 * assessments and session notes will refer to. Profiles are soft-deleted only.
 */
@Injectable()
export class TherapistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly availability: AvailabilityService,
    @Inject(THERAPIST_APPOINTMENTS)
    private readonly appointments: TherapistAppointments,
  ) {}

  async list(tenant: TenantContext, query: ListTherapistsQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search;
    const joinedFrom = query.joinedFrom ? parseIsoDate(query.joinedFrom) : null;
    const joinedTo = query.joinedTo ? parseIsoDate(query.joinedTo) : null;
    // "+880 1712-…" should find 01712…, which is how BD mobiles are stored.
    const digits = search
      ?.replace(/[\s\-().]/g, '')
      .replace(/^\+?88(?=01)/, '');
    const where: Prisma.TherapistWhereInput = {
      ...visibleTherapists(tenant),
      ...(query.status && { status: query.status }),
      ...(query.employmentType && { employmentType: query.employmentType }),
      ...(query.therapyTypeId && {
        specializations: { some: { therapyTypeId: query.therapyTypeId } },
      }),
      ...((joinedFrom || joinedTo) && {
        joiningDate: {
          ...(joinedFrom && { gte: joinedFrom }),
          ...(joinedTo && { lte: joinedTo }),
        },
      }),
      ...(search && {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          ...(digits ? [{ mobile: { contains: digits } }] : []),
        ],
      }),
    };
    const order = query.sortOrder ?? 'asc';
    const orderBy: Prisma.TherapistOrderByWithRelationInput[] = [
      query.sortBy === 'joiningDate'
        ? { joiningDate: { sort: order, nulls: 'last' } }
        : { [query.sortBy ?? 'fullName']: order },
      { id: 'asc' },
    ];
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.therapist.count({ where }),
      this.prisma.therapist.findMany({
        where,
        select: listSelect,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => toListItem(r, tenant)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Writes return this after committing rather than reading it inside the transaction:
   * Prisma loads sibling relations in parallel, which a transaction's single connection
   * can't do (pg warns, and pg@9 will refuse).
   */
  async get(tenant: TenantContext, id: string) {
    const row = await this.prisma.therapist.findFirst({
      where: { id, ...visibleTherapists(tenant) },
      select: detailSelect,
    });
    if (!row) throw therapistNotFound();
    return this.toDetail(row, tenant);
  }

  private async toDetail(row: DetailRow, tenant: TenantContext) {
    const { membership, ...rest } = row;
    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: { timezone: true },
    });
    const upcoming = await this.appointments.overlapping(
      tenant.centerId,
      row.id,
      new Date(),
    );
    return {
      ...toListItem(rest, tenant),
      qualifications: row.qualifications,
      registrationNumber: row.registrationNumber,
      yearsOfExperience: row.yearsOfExperience,
      notes: row.notes,
      account: membership && {
        membershipId: membership.id,
        fullName: membership.user.fullName,
        email: membership.user.email,
        role: membership.role,
        status: membership.status,
      },
      bookingIssues: bookingIssues(rest),
      /** Null until an appointment module can answer: not the same as none */
      upcomingAppointments: upcoming === null ? null : upcoming.length,
      timezone: center.timezone,
    };
  }

  /** Runs a write with the center locked, mapping unique-index races to a 409. */
  private async write<T>(tenant: TenantContext, fn: (tx: Tx) => Promise<T>) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockCenter(tx, tenant.centerId);
        return fn(tx);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw apiError(
          HttpStatus.CONFLICT,
          'Someone else just changed this therapist. Reload and try again.',
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
        entityType: 'Therapist',
        entityId,
        metadata,
        ipAddress,
      },
      tx,
    );
  }

  /** The next therapist ID in this center, e.g. TH-0008. IDs of deleted profiles aren't reused. */
  private async nextCode(tx: Tx, centerId: string) {
    const rows = await tx.therapist.findMany({
      where: { centerId, code: { startsWith: CODE_PREFIX } },
      select: { code: true },
    });
    const last = rows.reduce(
      (max, r) => Math.max(max, Number(r.code.slice(CODE_PREFIX.length)) || 0),
      0,
    );
    return `${CODE_PREFIX}${String(last + 1).padStart(4, '0')}`;
  }

  /** A real calendar date, from 1950 up to a year ahead (an agreed future start). */
  private async parseJoiningDate(tenant: TenantContext, value: string) {
    const date = parseIsoDate(value);
    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: { timezone: true },
    });
    const latest = addDays(todayIn(center.timezone), 366);
    if (!date || date < new Date(Date.UTC(1950, 0, 1)) || date > latest) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'Please check the highlighted fields',
        'VALIDATION_FAILED',
        { joiningDate: 'Choose a valid joining date' },
      );
    }
    return date;
  }

  /**
   * An active staff membership of this center that isn't already linked to another
   * therapist profile. Linking only lets that person see this profile as their own.
   */
  private async assertLinkable(
    tx: Tx,
    tenant: TenantContext,
    membershipId: string,
    therapistId?: string,
  ) {
    const membership = await tx.centerMembership.findFirst({
      where: { id: membershipId, centerId: tenant.centerId },
      select: {
        status: true,
        user: { select: { fullName: true } },
        therapist: { select: { id: true, fullName: true, deletedAt: true } },
      },
    });
    const fail = (
      message: string,
      code: string,
      status = HttpStatus.BAD_REQUEST,
    ) => apiError(status, message, code, { membershipId: message });
    if (!membership) throw fail('Staff member not found', 'NOT_FOUND');
    if (membership.status !== MembershipStatus.ACTIVE) {
      throw fail(
        `${membership.user.fullName}’s staff access is inactive. Reactivate it first.`,
        'MEMBERSHIP_INACTIVE',
      );
    }
    const linked = membership.therapist;
    if (linked && linked.id !== therapistId) {
      throw fail(
        `${membership.user.fullName} is already linked to ${linked.fullName}’s profile`,
        'ALREADY_LINKED',
        HttpStatus.CONFLICT,
      );
    }
    return membership;
  }

  /**
   * Checks a requested set of specializations against the center's therapy types and
   * works out the primary. Types from another center don't exist as far as this is
   * concerned; inactive types can stay on a profile but can't be newly added.
   */
  private async resolveSpecializations(
    tx: Tx,
    tenant: TenantContext,
    input: SpecializationsDto,
    current: { therapyTypeId: string; isPrimary: boolean }[],
    pathPrefix = '',
  ) {
    const ids = input.therapyTypeIds;
    const fail = (field: string, message: string, code: string) =>
      apiError(HttpStatus.BAD_REQUEST, message, code, {
        [`${pathPrefix}${field}`]: message,
      });
    if (
      input.primaryTherapyTypeId &&
      !ids.includes(input.primaryTherapyTypeId)
    ) {
      throw fail(
        'primaryTherapyTypeId',
        'The primary specialization must be one of the selected therapy types',
        'VALIDATION_FAILED',
      );
    }
    const types = await tx.therapyType.findMany({
      where: { id: { in: ids }, centerId: tenant.centerId },
      select: { id: true, name: true, isActive: true },
    });
    if (types.length !== ids.length) {
      throw fail(
        'therapyTypeIds',
        'One of the selected therapy types no longer exists. Reload and try again.',
        'THERAPY_TYPE_NOT_FOUND',
      );
    }
    const existing = new Set(current.map((c) => c.therapyTypeId));
    const newlyInactive = types.find((t) => !t.isActive && !existing.has(t.id));
    if (newlyInactive) {
      throw fail(
        'therapyTypeIds',
        `${newlyInactive.name} is inactive, so it can’t be assigned. Activate it in Settings first.`,
        'THERAPY_TYPE_INACTIVE',
      );
    }
    const currentPrimary = current.find((c) => c.isPrimary)?.therapyTypeId;
    const primary =
      input.primaryTherapyTypeId ??
      (currentPrimary && ids.includes(currentPrimary)
        ? currentPrimary
        : ids[0]);
    return ids.map((therapyTypeId) => ({
      therapyTypeId,
      isPrimary: therapyTypeId === primary,
    }));
  }

  async create(
    tenant: TenantContext,
    dto: CreateTherapistDto,
    ipAddress: string | null,
  ) {
    const joiningDate = dto.joiningDate
      ? await this.parseJoiningDate(tenant, dto.joiningDate)
      : null;
    const hours = dto.availability
      ? validateAvailability(dto.availability.days, 'availability.')
      : [];
    const id = await this.write(tenant, async (tx) => {
      if (dto.membershipId)
        await this.assertLinkable(tx, tenant, dto.membershipId);
      const specializations = dto.specializations
        ? await this.resolveSpecializations(
            tx,
            tenant,
            dto.specializations,
            [],
            'specializations.',
          )
        : [];
      const code = await this.nextCode(tx, tenant.centerId);
      const row = await tx.therapist.create({
        data: {
          centerId: tenant.centerId,
          code,
          fullName: dto.fullName,
          mobile: dto.mobile,
          email: dto.email ?? null,
          gender: dto.gender ?? null,
          photoUrl: dto.photoUrl ?? null,
          designation: dto.designation ?? null,
          qualifications: dto.qualifications ?? null,
          registrationNumber: dto.registrationNumber ?? null,
          yearsOfExperience: dto.yearsOfExperience ?? null,
          joiningDate,
          employmentType: dto.employmentType ?? null,
          notes: dto.notes ?? null,
          status: dto.status ?? TherapistStatus.ACTIVE,
          membershipId: dto.membershipId ?? null,
          specializations: { create: specializations },
        },
        select: { id: true },
      });
      if (hours.length) {
        await this.availability.write(tx, tenant.centerId, row.id, hours);
      }
      await this.record(
        tx,
        tenant,
        'therapist.created',
        row.id,
        {
          code,
          fullName: dto.fullName,
          linkedMembershipId: dto.membershipId ?? null,
        },
        ipAddress,
      );
      return row.id;
    });
    return this.get(tenant, id);
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateTherapistDto,
    ipAddress: string | null,
  ) {
    const joiningDate =
      typeof dto.joiningDate === 'string'
        ? await this.parseJoiningDate(tenant, dto.joiningDate)
        : dto.joiningDate;
    await this.write(tenant, async (tx) => {
      const before = await tx.therapist.findFirst({
        where: { id, ...visibleTherapists(tenant) },
        select: editableSelect,
      });
      if (!before) throw therapistNotFound();

      const data: Prisma.TherapistUncheckedUpdateInput = {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of EDITABLE) {
        const value = dto[field];
        if (value === undefined || value === before[field]) continue;
        Object.assign(data, { [field]: value });
        // Free-text fields may hold personal details: record that they changed, not to what.
        changes[field] = ['notes', 'qualifications'].includes(field)
          ? { from: '…', to: '…' }
          : { from: before[field], to: value };
      }
      if (joiningDate !== undefined) {
        const from = before.joiningDate && formatIsoDate(before.joiningDate);
        const to = joiningDate && formatIsoDate(joiningDate);
        if (from !== to) {
          data.joiningDate = joiningDate;
          changes.joiningDate = { from, to };
        }
      }
      if (
        dto.membershipId !== undefined &&
        dto.membershipId !== before.membershipId
      ) {
        if (dto.membershipId)
          await this.assertLinkable(tx, tenant, dto.membershipId, id);
        data.membershipId = dto.membershipId;
        changes.membershipId = {
          from: before.membershipId,
          to: dto.membershipId,
        };
      }
      if (!Object.keys(changes).length) return;

      await tx.therapist.update({ where: { id }, data });
      await this.record(
        tx,
        tenant,
        changes.membershipId && Object.keys(changes).length === 1
          ? 'therapist.account_linked'
          : 'therapist.updated',
        id,
        changes as Prisma.InputJsonValue,
        ipAddress,
      );
    });
    return this.get(tenant, id);
  }

  /**
   * Activation needs therapists.update, deactivation therapists.deactivate. Deactivating
   * stops new bookings only: past and future appointments, notes and the person's staff
   * account are left as they are.
   */
  async setStatus(
    tenant: TenantContext,
    id: string,
    status: TherapistStatus,
    ipAddress: string | null,
  ) {
    const needed: Permission =
      status === TherapistStatus.ACTIVE
        ? 'therapists.update'
        : 'therapists.deactivate';
    if (!tenant.permissions.includes(needed)) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'You don’t have permission to do this',
        'FORBIDDEN',
      );
    }
    await this.write(tenant, async (tx) => {
      const before = await findVisibleTherapist(tx, tenant, id);
      if (before.status !== status) {
        await tx.therapist.update({ where: { id }, data: { status } });
        await this.record(
          tx,
          tenant,
          status === TherapistStatus.ACTIVE
            ? 'therapist.activated'
            : 'therapist.deactivated',
          id,
          { fullName: before.fullName },
          ipAddress,
        );
      }
    });
    return this.get(tenant, id);
  }

  /**
   * Soft delete: the profile disappears from lists and can't be booked, but stays in the
   * database for everything that refers to it. The staff link is released so the person's
   * account can be linked to a new profile; the account itself isn't touched.
   */
  async remove(tenant: TenantContext, id: string, ipAddress: string | null) {
    await this.write(tenant, async (tx) => {
      const before = await tx.therapist.findFirst({
        where: { id, ...visibleTherapists(tenant) },
        select: { code: true, fullName: true, membershipId: true },
      });
      if (!before) throw therapistNotFound();
      await tx.therapist.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          status: TherapistStatus.INACTIVE,
          membershipId: null,
        },
      });
      await this.record(
        tx,
        tenant,
        'therapist.deleted',
        id,
        { ...before },
        ipAddress,
      );
    });
  }

  // ── Specializations ───────────────────────────────────────────────────────

  async listSpecializations(tenant: TenantContext, id: string) {
    await findVisibleTherapist(this.prisma, tenant, id);
    const rows = await this.prisma.therapistSpecialization.findMany({
      where: { therapistId: id },
      select: specializationSelect,
    });
    return toSpecializations(rows);
  }

  /**
   * Replaces the set of therapy types. Types kept keep their row (and assignment date);
   * removing one doesn't touch past records, which store their own therapy type.
   */
  async replaceSpecializations(
    tenant: TenantContext,
    id: string,
    dto: SpecializationsDto,
    ipAddress: string | null,
  ) {
    return this.write(tenant, async (tx) => {
      const therapist = await findVisibleTherapist(tx, tenant, id);
      await lockTherapist(tx, id);
      const current = await tx.therapistSpecialization.findMany({
        where: { therapistId: id },
        select: { id: true, therapyTypeId: true, isPrimary: true },
      });
      const next = await this.resolveSpecializations(tx, tenant, dto, current);
      const wanted = new Map(next.map((s) => [s.therapyTypeId, s.isPrimary]));
      const removed = current.filter((c) => !wanted.has(c.therapyTypeId));
      const added = next.filter(
        (n) => !current.some((c) => c.therapyTypeId === n.therapyTypeId),
      );
      const primaryChanged = current.filter(
        (c) =>
          wanted.has(c.therapyTypeId) &&
          wanted.get(c.therapyTypeId) !== c.isPrimary,
      );
      const primary = next.find((n) => n.isPrimary)?.therapyTypeId;
      if (removed.length || added.length || primaryChanged.length) {
        await tx.therapistSpecialization.deleteMany({
          where: { therapistId: id, id: { in: removed.map((r) => r.id) } },
        });
        await tx.therapistSpecialization.createMany({
          data: added.map((a) => ({ therapistId: id, ...a })),
        });
        await tx.therapistSpecialization.updateMany({
          where: { therapistId: id, therapyTypeId: { not: primary } },
          data: { isPrimary: false },
        });
        if (primary) {
          await tx.therapistSpecialization.updateMany({
            where: { therapistId: id, therapyTypeId: primary },
            data: { isPrimary: true },
          });
        }
        await this.record(
          tx,
          tenant,
          'therapist.specializations_updated',
          id,
          {
            fullName: therapist.fullName,
            added: added.map((a) => a.therapyTypeId),
            removed: removed.map((r) => r.therapyTypeId),
            primary: primary ?? null,
          },
          ipAddress,
        );
      }
      const rows = await tx.therapistSpecialization.findMany({
        where: { therapistId: id },
        select: specializationSelect,
      });
      return toSpecializations(rows);
    });
  }
}
