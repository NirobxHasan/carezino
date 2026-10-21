import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { seedDefaultTherapyTypes } from '../center-settings/defaults';
import { LIMITS } from '../center-settings/limits';
import { isUniqueViolation } from '../centers/centers.service';
import { apiError } from '../common/errors';
import { lockCenter } from '../common/locks';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateDurationOptionDto,
  CreateTherapyTypeDto,
  ListTherapyTypesQuery,
  UpdateDurationOptionDto,
  UpdateTherapyTypeDto,
} from './dto';

const optionSelect = {
  id: true,
  durationMinutes: true,
  label: true,
  isActive: true,
  displayOrder: true,
} satisfies Prisma.TherapyDurationOptionSelect;

const typeSelect = {
  id: true,
  name: true,
  code: true,
  description: true,
  defaultDurationMinutes: true,
  color: true,
  isActive: true,
  displayOrder: true,
  createdAt: true,
  updatedAt: true,
  durationOptions: {
    select: optionSelect,
    orderBy: [{ displayOrder: 'asc' }, { durationMinutes: 'asc' }],
  },
} satisfies Prisma.TherapyTypeSelect;

type TypeRow = Prisma.TherapyTypeGetPayload<{ select: typeof typeSelect }>;
type Tx = Prisma.TransactionClient;

/** The default option is the one matching the type's default duration. */
function toTherapyType(row: TypeRow) {
  return {
    ...row,
    durationOptions: row.durationOptions.map((o) => ({
      ...o,
      isDefault: o.durationMinutes === row.defaultDurationMinutes,
    })),
  };
}

const EDITABLE = [
  'name',
  'code',
  'description',
  'defaultDurationMinutes',
  'color',
  'isActive',
  'displayOrder',
] as const satisfies readonly (keyof UpdateTherapyTypeDto)[];

const notFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Therapy type not found', 'NOT_FOUND');

const durationNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Duration option not found', 'NOT_FOUND');

function isForeignKeyViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003'
  );
}

/**
 * Therapy types and their duration options, per center. Writes lock the center row so
 * the case-insensitive uniqueness checks and default-duration bookkeeping can't race.
 */
@Injectable()
export class TherapyTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenant: TenantContext, query: ListTherapyTypesQuery) {
    const search = query.search;
    const rows = await this.prisma.therapyType.findMany({
      where: {
        centerId: tenant.centerId,
        ...(query.status && { isActive: query.status === 'ACTIVE' }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      select: typeSelect,
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toTherapyType);
  }

  async get(tenant: TenantContext, id: string) {
    return toTherapyType(await this.find(this.prisma, tenant, id));
  }

  private async find(tx: Tx, tenant: TenantContext, id: string) {
    // Another center's therapy type looks exactly like a missing one.
    const row = await tx.therapyType.findFirst({
      where: { id, centerId: tenant.centerId },
      select: typeSelect,
    });
    if (!row) throw notFound();
    return row;
  }

  /** Name and code are unique per center; names ignore case, codes are stored upper-cased. */
  private async assertUnique(
    tx: Tx,
    tenant: TenantContext,
    fields: { name?: string; code?: string },
    exceptId?: string,
  ) {
    const errors: Record<string, string> = {};
    const others: Prisma.TherapyTypeWhereInput = {
      centerId: tenant.centerId,
      ...(exceptId && { id: { not: exceptId } }),
    };
    if (fields.name) {
      const taken = await tx.therapyType.findFirst({
        where: {
          ...others,
          name: { equals: fields.name, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (taken) errors.name = 'Another therapy type already has this name';
    }
    if (fields.code) {
      const taken = await tx.therapyType.findFirst({
        where: { ...others, code: fields.code },
        select: { id: true },
      });
      if (taken) errors.code = 'Another therapy type already uses this code';
    }
    if (Object.keys(errors).length) {
      throw apiError(
        HttpStatus.CONFLICT,
        Object.values(errors)[0],
        'THERAPY_TYPE_EXISTS',
        errors,
      );
    }
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
          'That name, code or duration is already in use. Reload and try again.',
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
        entityType: 'TherapyType',
        entityId,
        metadata,
        ipAddress,
      },
      tx,
    );
  }

  async create(
    tenant: TenantContext,
    dto: CreateTherapyTypeDto,
    ipAddress: string | null,
  ) {
    return this.write(tenant, async (tx) => {
      const count = await tx.therapyType.count({
        where: { centerId: tenant.centerId },
      });
      if (count >= LIMITS.therapyTypesPerCenter) {
        throw apiError(
          HttpStatus.CONFLICT,
          `A center can have up to ${LIMITS.therapyTypesPerCenter} therapy types. Deactivate or delete one you no longer offer.`,
          'LIMIT_REACHED',
        );
      }
      await this.assertUnique(tx, tenant, dto);
      const last = await tx.therapyType.aggregate({
        where: { centerId: tenant.centerId },
        _max: { displayOrder: true },
      });
      const row = await tx.therapyType.create({
        data: {
          centerId: tenant.centerId,
          name: dto.name,
          code: dto.code,
          description: dto.description ?? null,
          defaultDurationMinutes: dto.defaultDurationMinutes,
          color: dto.color ?? null,
          isActive: dto.isActive ?? true,
          displayOrder: dto.displayOrder ?? (last._max.displayOrder ?? -1) + 1,
          durationOptions: {
            create: { durationMinutes: dto.defaultDurationMinutes },
          },
        },
        select: typeSelect,
      });
      await this.record(
        tx,
        tenant,
        'therapy_type.created',
        row.id,
        { name: row.name, code: row.code },
        ipAddress,
      );
      return toTherapyType(row);
    });
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateTherapyTypeDto,
    ipAddress: string | null,
  ) {
    return this.write(tenant, async (tx) => {
      const before = await this.find(tx, tenant, id);
      const data: Prisma.TherapyTypeUpdateInput = {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of EDITABLE) {
        const value = dto[field];
        if (value === undefined || value === before[field]) continue;
        Object.assign(data, { [field]: value });
        changes[field] = { from: before[field], to: value };
      }
      if (!Object.keys(changes).length) return toTherapyType(before);

      await this.assertUnique(
        tx,
        tenant,
        {
          // A change of case only ("Ot" → "OT") isn't a clash with itself.
          name: changes.name ? dto.name : undefined,
          code: changes.code ? dto.code : undefined,
        },
        id,
      );
      if (
        dto.defaultDurationMinutes !== undefined &&
        changes.defaultDurationMinutes
      ) {
        await this.ensureOption(tx, before, dto.defaultDurationMinutes);
      }
      await tx.therapyType.update({ where: { id }, data });
      await this.record(
        tx,
        tenant,
        'therapy_type.updated',
        id,
        changes as Prisma.InputJsonValue,
        ipAddress,
      );
      return toTherapyType(await this.find(tx, tenant, id));
    });
  }

  /** Makes sure an active option exists for a new default duration. */
  private async ensureOption(tx: Tx, type: TypeRow, durationMinutes: number) {
    const existing = type.durationOptions.find(
      (o) => o.durationMinutes === durationMinutes,
    );
    if (existing) {
      if (!existing.isActive) {
        await tx.therapyDurationOption.update({
          where: { id: existing.id },
          data: { isActive: true },
        });
      }
      return;
    }
    this.assertRoomForOption(type);
    await tx.therapyDurationOption.create({
      data: { therapyTypeId: type.id, durationMinutes },
    });
  }

  private assertRoomForOption(type: TypeRow) {
    if (type.durationOptions.length >= LIMITS.durationOptionsPerType) {
      throw apiError(
        HttpStatus.CONFLICT,
        `A therapy type can have up to ${LIMITS.durationOptionsPerType} durations. Remove one you no longer offer.`,
        'LIMIT_REACHED',
      );
    }
  }

  async setStatus(
    tenant: TenantContext,
    id: string,
    isActive: boolean,
    ipAddress: string | null,
  ) {
    return this.write(tenant, async (tx) => {
      const before = await this.find(tx, tenant, id);
      if (before.isActive === isActive) return toTherapyType(before);
      await tx.therapyType.update({ where: { id }, data: { isActive } });
      await this.record(
        tx,
        tenant,
        isActive ? 'therapy_type.activated' : 'therapy_type.deactivated',
        id,
        { name: before.name, code: before.code },
        ipAddress,
      );
      return toTherapyType(await this.find(tx, tenant, id));
    });
  }

  /**
   * Permanently deletes a therapy type nothing refers to. Records in other modules
   * reference therapy types with ON DELETE RESTRICT, so the database itself refuses to
   * delete one in use; that becomes a 409 suggesting deactivation instead.
   */
  async remove(tenant: TenantContext, id: string, ipAddress: string | null) {
    try {
      await this.write(tenant, async (tx) => {
        const before = await this.find(tx, tenant, id);
        await tx.therapyType.delete({ where: { id } });
        await this.record(
          tx,
          tenant,
          'therapy_type.deleted',
          id,
          { name: before.name, code: before.code },
          ipAddress,
        );
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) throw this.inUse('therapy type');
      throw error;
    }
  }

  private inUse(what: string) {
    return apiError(
      HttpStatus.CONFLICT,
      `This ${what} is used by existing records, so it can’t be deleted. Deactivate it instead: past records keep it, and it can’t be chosen for new ones.`,
      'IN_USE',
    );
  }

  /** Sets the display order from a complete list of the center's therapy type IDs. */
  async reorder(
    tenant: TenantContext,
    ids: string[],
    ipAddress: string | null,
  ) {
    return this.write(tenant, async (tx) => {
      const current = await tx.therapyType.findMany({
        where: { centerId: tenant.centerId },
        select: { id: true },
      });
      const known = new Set(current.map((t) => t.id));
      if (ids.length !== known.size || !ids.every((id) => known.has(id))) {
        throw apiError(
          HttpStatus.CONFLICT,
          'The list of therapy types has changed. Reload the page and try again.',
          'LIST_CHANGED',
        );
      }
      for (const [displayOrder, id] of ids.entries()) {
        await tx.therapyType.update({ where: { id }, data: { displayOrder } });
      }
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'therapy_type.reordered',
          entityType: 'TherapyType',
          ipAddress,
        },
        tx,
      );
      return this.listIn(tx, tenant);
    });
  }

  private async listIn(tx: Tx, tenant: TenantContext) {
    const rows = await tx.therapyType.findMany({
      where: { centerId: tenant.centerId },
      select: typeSelect,
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toTherapyType);
  }

  /** Adds the standard therapy types the center doesn't have yet. Safe to repeat. */
  async addDefaults(tenant: TenantContext, ipAddress: string | null) {
    return this.write(tenant, async (tx) => {
      const created = await seedDefaultTherapyTypes(tx, tenant.centerId);
      if (created) {
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: 'therapy_type.defaults_added',
            entityType: 'TherapyType',
            metadata: { created },
            ipAddress,
          },
          tx,
        );
      }
      return { created, items: await this.listIn(tx, tenant) };
    });
  }

  // ── Duration options ──────────────────────────────────────────────────────

  async listDurations(tenant: TenantContext, typeId: string) {
    return this.get(tenant, typeId).then((t) => t.durationOptions);
  }

  private assertNoDuplicate(type: TypeRow, minutes: number, exceptId?: string) {
    if (
      type.durationOptions.some(
        (o) => o.durationMinutes === minutes && o.id !== exceptId,
      )
    ) {
      throw apiError(
        HttpStatus.CONFLICT,
        'This duration is already offered',
        'DURATION_EXISTS',
        { durationMinutes: 'This duration is already offered' },
      );
    }
  }

  async addDuration(
    tenant: TenantContext,
    typeId: string,
    dto: CreateDurationOptionDto,
    ipAddress: string | null,
  ) {
    return this.write(tenant, async (tx) => {
      const type = await this.find(tx, tenant, typeId);
      this.assertNoDuplicate(type, dto.durationMinutes);
      this.assertRoomForOption(type);
      if (dto.isDefault && dto.isActive === false) throw this.defaultInactive();
      await tx.therapyDurationOption.create({
        data: {
          therapyTypeId: typeId,
          durationMinutes: dto.durationMinutes,
          label: dto.label ?? null,
          isActive: dto.isActive ?? true,
          displayOrder: dto.displayOrder ?? 0,
        },
      });
      if (dto.isDefault) {
        await tx.therapyType.update({
          where: { id: typeId },
          data: { defaultDurationMinutes: dto.durationMinutes },
        });
      }
      await this.record(
        tx,
        tenant,
        'therapy_type.duration_added',
        typeId,
        { durationMinutes: dto.durationMinutes, isDefault: !!dto.isDefault },
        ipAddress,
      );
      return toTherapyType(await this.find(tx, tenant, typeId));
    });
  }

  async updateDuration(
    tenant: TenantContext,
    typeId: string,
    optionId: string,
    dto: UpdateDurationOptionDto,
    ipAddress: string | null,
  ) {
    return this.write(tenant, async (tx) => {
      const type = await this.find(tx, tenant, typeId);
      const option = type.durationOptions.find((o) => o.id === optionId);
      if (!option) throw durationNotFound();

      const wasDefault = option.durationMinutes === type.defaultDurationMinutes;
      const minutes = dto.durationMinutes ?? option.durationMinutes;
      const isActive = dto.isActive ?? option.isActive;
      const willBeDefault = wasDefault || dto.isDefault === true;
      if (dto.durationMinutes !== undefined)
        this.assertNoDuplicate(type, minutes, optionId);
      if (willBeDefault && !isActive) throw this.defaultInactive();

      await tx.therapyDurationOption.update({
        where: { id: optionId },
        data: {
          durationMinutes: minutes,
          isActive,
          ...(dto.label !== undefined && { label: dto.label }),
          ...(dto.displayOrder !== undefined && {
            displayOrder: dto.displayOrder,
          }),
        },
      });
      // The default follows its option when the option's length changes.
      if (willBeDefault && type.defaultDurationMinutes !== minutes) {
        await tx.therapyType.update({
          where: { id: typeId },
          data: { defaultDurationMinutes: minutes },
        });
      }
      await this.record(
        tx,
        tenant,
        'therapy_type.duration_updated',
        typeId,
        {
          optionId,
          from: {
            durationMinutes: option.durationMinutes,
            isActive: option.isActive,
          },
          to: { durationMinutes: minutes, isActive, isDefault: willBeDefault },
        },
        ipAddress,
      );
      return toTherapyType(await this.find(tx, tenant, typeId));
    });
  }

  async removeDuration(
    tenant: TenantContext,
    typeId: string,
    optionId: string,
    ipAddress: string | null,
  ) {
    try {
      return await this.write(tenant, async (tx) => {
        const type = await this.find(tx, tenant, typeId);
        const option = type.durationOptions.find((o) => o.id === optionId);
        if (!option) throw durationNotFound();
        if (option.durationMinutes === type.defaultDurationMinutes) {
          throw apiError(
            HttpStatus.CONFLICT,
            'This is the default duration. Make another duration the default before removing it.',
            'DEFAULT_DURATION',
          );
        }
        await tx.therapyDurationOption.delete({ where: { id: optionId } });
        await this.record(
          tx,
          tenant,
          'therapy_type.duration_removed',
          typeId,
          { durationMinutes: option.durationMinutes },
          ipAddress,
        );
        return toTherapyType(await this.find(tx, tenant, typeId));
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) throw this.inUse('duration');
      throw error;
    }
  }

  private defaultInactive() {
    return apiError(
      HttpStatus.CONFLICT,
      'The default duration must stay active. Make another duration the default first.',
      'DEFAULT_DURATION',
      { isActive: 'The default duration must stay active' },
    );
  }
}
