import { Injectable } from '@nestjs/common';

import { generateToken, hashToken } from '../common/tokens';
import { AppConfig } from '../config/app-config';
import {
  CenterStatus,
  MembershipStatus,
  UserStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from './auth-context';
import { permissionsFor } from './permissions';

/** Only write lastUsedAt this often, so every request doesn't become a database write. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const activeMembershipWhere = {
  status: MembershipStatus.ACTIVE,
  center: { status: CenterStatus.ACTIVE },
} as const;

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** Creates a session and returns the raw token for the cookie. Only its hash is stored. */
  async create(
    userId: string,
    opts: {
      remember: boolean;
      /** Start in this center; still re-validated against memberships on every request. */
      centerId?: string;
      ipAddress: string | null;
      userAgent: string | null;
    },
  ) {
    const token = generateToken();
    const ttl = opts.remember
      ? this.config.rememberedSessionTtlMs
      : this.config.sessionTtlMs;
    const expiresAt = new Date(Date.now() + ttl);
    // A single active membership is selected automatically; with several, the user picks.
    const memberships = await this.prisma.centerMembership.findMany({
      where: { userId, ...activeMembershipWhere },
      select: { centerId: true },
    });
    const preferred = memberships.find((m) => m.centerId === opts.centerId);
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt,
        activeCenterId:
          preferred?.centerId ??
          (memberships.length === 1 ? memberships[0].centerId : null),
        ipAddress: opts.ipAddress,
        userAgent: opts.userAgent,
      },
    });
    return { token, expiresAt };
  }

  /**
   * Resolves a session cookie into the caller's identity and active membership. Returns
   * null for unknown, expired or revoked sessions and for disabled users. The membership
   * and center status are re-checked on every request, so deactivation applies at once.
   */
  async resolve(token: string): Promise<AuthContext | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            status: true,
            isPlatformAdmin: true,
          },
        },
      },
    });
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt <= now) return null;
    if (session.user.status !== UserStatus.ACTIVE) return null;

    let membership = session.activeCenterId
      ? await this.prisma.centerMembership.findFirst({
          where: {
            userId: session.userId,
            centerId: session.activeCenterId,
            ...activeMembershipWhere,
          },
        })
      : null;

    let activeCenterId = membership?.centerId ?? null;
    if (!membership) {
      // The selected center is gone or access was removed: fall back to the only remaining one.
      const remaining = await this.prisma.centerMembership.findMany({
        where: { userId: session.userId, ...activeMembershipWhere },
        take: 2,
      });
      membership = remaining.length === 1 ? remaining[0] : null;
      activeCenterId = membership?.centerId ?? null;
    }

    const stale =
      now.getTime() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS;
    if (stale || activeCenterId !== session.activeCenterId) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastUsedAt: now, activeCenterId },
      });
    }

    const { user } = session;
    return {
      sessionId: session.id,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        isPlatformAdmin: user.isPlatformAdmin,
      },
      membership: membership
        ? {
            id: membership.id,
            centerId: membership.centerId,
            role: membership.role,
            permissions: permissionsFor(membership.role),
          }
        : null,
    };
  }

  /** Points the session at another center the user actively belongs to. */
  async switchCenter(sessionId: string, userId: string, centerId: string) {
    const membership = await this.prisma.centerMembership.findFirst({
      where: { userId, centerId, ...activeMembershipWhere },
      select: { id: true },
    });
    if (!membership) return false;
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { activeCenterId: centerId },
    });
    return true;
  }

  async revoke(sessionId: string) {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Signs the user out everywhere, optionally keeping the session making the request. */
  async revokeAllForUser(userId: string, exceptSessionId?: string) {
    await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId && { id: { not: exceptSessionId } }),
      },
      data: { revokedAt: new Date() },
    });
  }
}
