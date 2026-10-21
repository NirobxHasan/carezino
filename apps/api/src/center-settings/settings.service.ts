import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ensureSettingsRows } from './defaults';
import type {
  UpdateGeneralSettingsDto,
  UpdateSchedulingSettingsDto,
} from './dto';

const schedulingSelect = {
  slotIntervalMinutes: true,
  bookingBufferMinutes: true,
  allowCustomDuration: true,
  allowBookingOnClosedDays: true,
  advanceBookingLimitDays: true,
  minimumBookingNoticeMinutes: true,
  allowDoubleBooking: true,
  allowPastDateBooking: true,
  cancellationCutoffMinutes: true,
  updatedAt: true,
} satisfies Prisma.CenterSchedulingSettingsSelect;

const generalSelect = {
  defaultDurationBehavior: true,
  autoGeneratePatientCode: true,
  patientCodePrefix: true,
  defaultPatientStatus: true,
  dateFormat: true,
  timeFormat: true,
  weekStartsOn: true,
  updatedAt: true,
} satisfies Prisma.CenterGeneralSettingsSelect;

/** Only what changed, as { field: { from, to } }. */
function diff<T extends object>(before: T, input: Partial<T>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(input)) {
    const from = before[key as keyof T];
    if (to !== undefined && to !== from) changes[key] = { from, to };
  }
  return changes;
}

/**
 * Typed, per-center preferences: scheduling policies and general operational options.
 * Each group is its own row with schema defaults, created on first use, so a new
 * setting is a new column with a default and never disturbs the others.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getScheduling(tenant: TenantContext) {
    await ensureSettingsRows(this.prisma, tenant.centerId);
    return this.prisma.centerSchedulingSettings.findUniqueOrThrow({
      where: { centerId: tenant.centerId },
      select: schedulingSelect,
    });
  }

  async updateScheduling(
    tenant: TenantContext,
    dto: UpdateSchedulingSettingsDto,
    ipAddress: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await ensureSettingsRows(tx, tenant.centerId);
      const where = { centerId: tenant.centerId };
      const before = await tx.centerSchedulingSettings.findUniqueOrThrow({
        where,
        select: schedulingSelect,
      });
      const changes = diff(before, dto);
      if (!Object.keys(changes).length) return before;
      const after = await tx.centerSchedulingSettings.update({
        where,
        data: dto,
        select: schedulingSelect,
      });
      await this.recordChange(
        tx,
        tenant,
        'settings.scheduling_updated',
        changes,
        ipAddress,
      );
      return after;
    });
  }

  async getGeneral(tenant: TenantContext) {
    await ensureSettingsRows(this.prisma, tenant.centerId);
    return this.prisma.centerGeneralSettings.findUniqueOrThrow({
      where: { centerId: tenant.centerId },
      select: generalSelect,
    });
  }

  async updateGeneral(
    tenant: TenantContext,
    dto: UpdateGeneralSettingsDto,
    ipAddress: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await ensureSettingsRows(tx, tenant.centerId);
      const where = { centerId: tenant.centerId };
      const before = await tx.centerGeneralSettings.findUniqueOrThrow({
        where,
        select: generalSelect,
      });
      const changes = diff(before, dto);
      if (!Object.keys(changes).length) return before;
      const after = await tx.centerGeneralSettings.update({
        where,
        data: dto,
        select: generalSelect,
      });
      await this.recordChange(
        tx,
        tenant,
        'settings.general_updated',
        changes,
        ipAddress,
      );
      return after;
    });
  }

  private recordChange(
    tx: Prisma.TransactionClient,
    tenant: TenantContext,
    action: string,
    changes: Record<string, { from: unknown; to: unknown }>,
    ipAddress: string | null,
  ) {
    return this.audit.record(
      {
        centerId: tenant.centerId,
        actorUserId: tenant.userId,
        action,
        entityType: 'CenterSettings',
        entityId: tenant.centerId,
        metadata: changes as Prisma.InputJsonValue,
        ipAddress,
      },
      tx,
    );
  }
}
