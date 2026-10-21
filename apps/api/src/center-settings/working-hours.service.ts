import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { apiError } from '../common/errors';
import { lockCenter } from '../common/locks';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateWorkingHoursDto } from './dto';
import { toWeek, validateWeek } from './working-hours';

const rowSelect = {
  dayOfWeek: true,
  startMinutes: true,
  endMinutes: true,
} satisfies Prisma.CenterWorkingHourSelect;

/**
 * The center's weekly opening hours: the outer limit for future scheduling. Therapist
 * availability will sit inside these. Times are in the center's time zone.
 */
@Injectable()
export class WorkingHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async read(tx: Prisma.TransactionClient, centerId: string) {
    const [center, rows] = await Promise.all([
      tx.center.findUniqueOrThrow({
        where: { id: centerId },
        select: { timezone: true },
      }),
      tx.centerWorkingHour.findMany({
        where: { centerId },
        select: rowSelect,
        orderBy: [{ dayOfWeek: 'asc' }, { startMinutes: 'asc' }],
      }),
    ]);
    return { timezone: center.timezone, days: toWeek(rows) };
  }

  get(tenant: TenantContext) {
    return this.read(this.prisma, tenant.centerId);
  }

  /** Replaces the whole week in one transaction. A day without intervals is closed. */
  async replace(
    tenant: TenantContext,
    dto: UpdateWorkingHoursDto,
    ipAddress: string | null,
  ) {
    const { rows, errors } = validateWeek(dto.days);
    if (Object.keys(errors).length) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'Please check the highlighted hours',
        'VALIDATION_FAILED',
        errors,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await lockCenter(tx, tenant.centerId);
      const before = await this.read(tx, tenant.centerId);
      await tx.centerWorkingHour.deleteMany({
        where: { centerId: tenant.centerId },
      });
      await tx.centerWorkingHour.createMany({
        data: rows.map((row) => ({ ...row, centerId: tenant.centerId })),
      });
      const after = await this.read(tx, tenant.centerId);
      if (JSON.stringify(before.days) !== JSON.stringify(after.days)) {
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: 'settings.working_hours_updated',
            entityType: 'CenterWorkingHour',
            metadata: { from: before.days, to: after.days },
            ipAddress,
          },
          tx,
        );
      }
      return after;
    });
  }
}
