import { HttpStatus, Injectable } from '@nestjs/common';

import type { AuthContext } from '../auth/auth-context';
import type { RegisterCenterDto } from '../auth/dto';
import {
  CentersService,
  assertOwnerPasswordsMatch,
  centerSelect,
} from '../centers/centers.service';
import { apiError } from '../common/errors';
import type { Prisma } from '../generated/prisma/client';
import { MembershipStatus, Role } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { ListCentersQuery } from './dto';

const adminSelect = {
  id: true,
  status: true,
  joinedAt: true,
  user: { select: { fullName: true, email: true, mobile: true } },
} satisfies Prisma.CenterMembershipSelect;

type AdminRow = Prisma.CenterMembershipGetPayload<{
  select: typeof adminSelect;
}>;

function toAdmin({ user, ...membership }: AdminRow) {
  return { ...membership, ...user };
}

/**
 * Cross-center views and actions for platform administrators. Deliberately not
 * tenant-scoped: callers are checked by @PlatformAdminOnly on the controller.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly centers: CentersService,
  ) {}

  async listCenters(query: ListCentersQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search;
    const where: Prisma.CenterWhereInput = {
      ...(query.status && { status: query.status }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search.replace(/[\s-]/g, '') } },
          { district: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.center.count({ where }),
      this.prisma.center.findMany({
        where,
        select: {
          id: true,
          code: true,
          name: true,
          phone: true,
          email: true,
          district: true,
          status: true,
          createdAt: true,
          _count: {
            select: {
              memberships: { where: { status: MembershipStatus.ACTIVE } },
            },
          },
          memberships: {
            where: { role: Role.CENTER_ADMIN, status: MembershipStatus.ACTIVE },
            select: adminSelect,
            orderBy: { joinedAt: 'asc' },
            take: 1,
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const items = rows.map(({ _count, memberships, ...center }) => ({
      ...center,
      activeStaff: _count.memberships,
      primaryAdmin: memberships[0] ? toAdmin(memberships[0]) : null,
    }));
    return { items, total, page, pageSize };
  }

  async getCenter(id: string) {
    const center = await this.prisma.center.findUnique({
      where: { id },
      select: {
        ...centerSelect,
        memberships: {
          where: { role: Role.CENTER_ADMIN },
          select: adminSelect,
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!center) {
      throw apiError(HttpStatus.NOT_FOUND, 'Center not found', 'NOT_FOUND');
    }
    const [activeStaff, inactiveStaff, pendingInvitations] = await Promise.all([
      this.prisma.centerMembership.count({
        where: { centerId: id, status: MembershipStatus.ACTIVE },
      }),
      this.prisma.centerMembership.count({
        where: { centerId: id, status: MembershipStatus.INACTIVE },
      }),
      this.prisma.invitation.count({
        where: {
          centerId: id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      }),
    ]);
    const { memberships, ...profile } = center;
    return {
      ...profile,
      administrators: memberships.map(toAdmin),
      counts: { activeStaff, inactiveStaff, pendingInvitations },
    };
  }

  /**
   * Registers a center with its first administrator. The super admin sets the owner's
   * initial password and passes it on; the owner can change it from My profile.
   */
  async createCenter(
    auth: AuthContext,
    dto: RegisterCenterDto,
    ipAddress: string | null,
  ) {
    assertOwnerPasswordsMatch(dto.owner);
    const { center } = await this.centers.register(dto.center, dto.owner, {
      ipAddress,
      via: 'platform_admin',
      actorUserId: auth.user.id,
      defaultTherapyTypes: dto.defaultTherapyTypes,
    });
    return { center };
  }
}
