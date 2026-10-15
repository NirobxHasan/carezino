import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import type { Permission } from '../auth/permissions';
import { apiError } from '../common/errors';
import type { Prisma } from '../generated/prisma/client';
import { MembershipStatus, Role } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { ListStaffQuery } from './dto';

const staffSelect = {
  id: true,
  role: true,
  status: true,
  joinedAt: true,
  updatedAt: true,
  user: { select: { id: true, fullName: true, email: true, mobile: true } },
} satisfies Prisma.CenterMembershipSelect;

type StaffRow = Prisma.CenterMembershipGetPayload<{
  select: typeof staffSelect;
}>;

function toStaff(row: StaffRow, tenant: TenantContext) {
  const { user, ...membership } = row;
  return {
    ...membership,
    userId: user.id,
    fullName: user.fullName,
    email: user.email,
    mobile: user.mobile,
    isYou: row.id === tenant.membershipId,
  };
}

const notFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Staff member not found', 'NOT_FOUND');

/**
 * Staff are the center's memberships. A membership's role and status belong to this
 * center only; the person's name, email and mobile are their own global identity, which
 * they manage from their profile, so one center can't rewrite details another relies on.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenant: TenantContext, query: ListStaffQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search;
    const where: Prisma.CenterMembershipWhereInput = {
      centerId: tenant.centerId,
      ...(query.role && { role: query.role }),
      ...(query.status && { status: query.status }),
      ...(search && {
        user: {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { mobile: { contains: search.replace(/[\s-]/g, '') } },
          ],
        },
      }),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.centerMembership.count({ where }),
      this.prisma.centerMembership.findMany({
        where,
        select: staffSelect,
        orderBy: [{ joinedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => toStaff(r, tenant)),
      total,
      page,
      pageSize,
    };
  }

  async get(tenant: TenantContext, id: string) {
    const row = await this.prisma.centerMembership.findFirst({
      where: { id, centerId: tenant.centerId },
      select: staffSelect,
    });
    if (!row) throw notFound();
    return toStaff(row, tenant);
  }

  /**
   * Runs a membership change with the center row locked, so two admins demoting each
   * other at the same moment can't leave the center without an active administrator.
   */
  private async withCenterLock<T>(
    tenant: TenantContext,
    id: string,
    fn: (tx: Prisma.TransactionClient, current: StaffRow) => Promise<T>,
  ) {
    if (id === tenant.membershipId) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'You can’t change your own role or status. Ask another administrator.',
        'SELF_CHANGE',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Center" WHERE id = ${tenant.centerId}::uuid FOR UPDATE`;
      const current = await tx.centerMembership.findFirst({
        where: { id, centerId: tenant.centerId },
        select: staffSelect,
      });
      if (!current) throw notFound();
      return fn(tx, current);
    });
  }

  private async assertNotLastAdmin(
    tx: Prisma.TransactionClient,
    tenant: TenantContext,
    row: StaffRow,
  ) {
    if (
      row.role !== Role.CENTER_ADMIN ||
      row.status !== MembershipStatus.ACTIVE
    )
      return;
    const admins = await tx.centerMembership.count({
      where: {
        centerId: tenant.centerId,
        role: Role.CENTER_ADMIN,
        status: MembershipStatus.ACTIVE,
      },
    });
    if (admins <= 1) {
      throw apiError(
        HttpStatus.CONFLICT,
        'A center needs at least one active administrator. Make someone else an administrator first.',
        'LAST_ADMIN',
      );
    }
  }

  async changeRole(
    tenant: TenantContext,
    id: string,
    role: Role,
    ipAddress: string | null,
  ) {
    const updated = await this.withCenterLock(
      tenant,
      id,
      async (tx, current) => {
        if (current.role === role) return current;
        if (role !== Role.CENTER_ADMIN)
          await this.assertNotLastAdmin(tx, tenant, current);
        const row = await tx.centerMembership.update({
          where: { id },
          data: { role },
          select: staffSelect,
        });
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: 'staff.role_changed',
            entityType: 'CenterMembership',
            entityId: id,
            metadata: { userId: current.user.id, from: current.role, to: role },
            ipAddress,
          },
          tx,
        );
        return row;
      },
    );
    return toStaff(updated, tenant);
  }

  async changeStatus(
    tenant: TenantContext,
    id: string,
    status: MembershipStatus,
    ipAddress: string | null,
  ) {
    const needed: Permission =
      status === MembershipStatus.ACTIVE ? 'staff.update' : 'staff.deactivate';
    if (!tenant.permissions.includes(needed)) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'You don’t have permission to do this',
        'FORBIDDEN',
      );
    }
    const updated = await this.withCenterLock(
      tenant,
      id,
      async (tx, current) => {
        if (current.status === status) return current;
        if (status === MembershipStatus.INACTIVE) {
          await this.assertNotLastAdmin(tx, tenant, current);
          // Access checks re-validate the membership on every request; this also clears
          // the center from their open sessions so they land on the center picker.
          await tx.session.updateMany({
            where: { userId: current.user.id, activeCenterId: tenant.centerId },
            data: { activeCenterId: null },
          });
        }
        const row = await tx.centerMembership.update({
          where: { id },
          data: { status },
          select: staffSelect,
        });
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action:
              status === MembershipStatus.ACTIVE
                ? 'staff.activated'
                : 'staff.deactivated',
            entityType: 'CenterMembership',
            entityId: id,
            metadata: { userId: current.user.id, role: current.role },
            ipAddress,
          },
          tx,
        );
        return row;
      },
    );
    return toStaff(updated, tenant);
  }
}
