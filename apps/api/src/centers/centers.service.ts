import { HttpStatus, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { PasswordService } from '../auth/password.service';
import { apiError } from '../common/errors';
import { Prisma } from '../generated/prisma/client';
import {
  CenterStatus,
  MembershipStatus,
  Role,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { OwnerDto } from '../auth/dto';
import type { CenterDetailsDto, UpdateCenterDto } from './dto';

export const centerSelect = {
  id: true,
  code: true,
  name: true,
  phone: true,
  email: true,
  address: true,
  district: true,
  country: true,
  timezone: true,
  currency: true,
  logoUrl: true,
  website: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CenterSelect;

const EDITABLE_FIELDS = [
  'name',
  'phone',
  'email',
  'address',
  'district',
  'website',
  'logoUrl',
  'timezone',
  'currency',
] as const satisfies readonly (keyof UpdateCenterDto)[];

/** Initials of the center name plus four digits, e.g. "Shishu Bikash Therapy Center" → SBTC-4821. */
export function centerCodePrefix(name: string) {
  const letters = name
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z]/gi, '')[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 4);
  return letters.length >= 2 ? letters : `CZ${letters}`.slice(0, 4);
}

export function centerData(center: CenterDetailsDto) {
  return {
    name: center.name,
    phone: center.phone,
    email: center.email ?? null,
    address: center.address,
    district: center.district ?? null,
    website: center.website ?? null,
    ...(center.country && { country: center.country }),
    ...(center.timezone && { timezone: center.timezone }),
    ...(center.currency && { currency: center.currency }),
  };
}

/** The owner's password and its confirmation must match (checked before any writes). */
export function assertOwnerPasswordsMatch(owner: OwnerDto) {
  if (owner.password !== owner.confirmPassword) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'Please check the highlighted fields',
      'VALIDATION_FAILED',
      { 'owner.confirmPassword': 'Passwords don’t match' },
    );
  }
}

export function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class CentersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async generateCode(name: string, tx: Prisma.TransactionClient = this.prisma) {
    const prefix = centerCodePrefix(name);
    for (let attempt = 0; attempt < 10; attempt++) {
      const digits = attempt < 6 ? 4 : 6;
      const code = `${prefix}-${randomInt(10 ** (digits - 1), 10 ** digits)}`;
      const taken = await tx.center.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!taken) return code;
    }
    throw new Error('Could not generate a unique center code');
  }

  /**
   * Creates the center, its owner account and the owner's CENTER_ADMIN membership in one
   * transaction, so a failure leaves nothing behind.
   */
  async register(
    center: CenterDetailsDto,
    owner: OwnerDto,
    meta: {
      ipAddress: string | null;
      via: 'public_registration' | 'platform_admin';
      /** Who performed it; defaults to the new owner for public signup. */
      actorUserId?: string;
    },
  ) {
    const passwordHash = await this.passwords.hash(owner.password);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({
          where: { email: owner.email },
          select: { id: true },
        });
        if (existing) throw this.emailTaken();

        const created = await tx.center.create({
          data: {
            ...centerData(center),
            code: await this.generateCode(center.name, tx),
          },
          select: centerSelect,
        });
        const user = await tx.user.create({
          data: {
            fullName: owner.fullName,
            email: owner.email,
            mobile: owner.mobile,
            passwordHash,
          },
          select: { id: true },
        });
        await tx.centerMembership.create({
          data: {
            centerId: created.id,
            userId: user.id,
            role: Role.CENTER_ADMIN,
            status: MembershipStatus.ACTIVE,
          },
        });
        await this.audit.record(
          {
            centerId: created.id,
            actorUserId: meta.actorUserId ?? user.id,
            action: 'center.created',
            entityType: 'Center',
            entityId: created.id,
            metadata: {
              code: created.code,
              name: created.name,
              via: meta.via,
            },
            ipAddress: meta.ipAddress,
          },
          tx,
        );
        return { center: created, userId: user.id };
      });
    } catch (error) {
      // A concurrent registration with the same email loses the race on the unique index.
      if (isUniqueViolation(error)) throw this.emailTaken();
      throw error;
    }
  }

  private emailTaken() {
    return apiError(
      HttpStatus.CONFLICT,
      'An account with this email already exists. Sign in instead, or use a different email.',
      'EMAIL_TAKEN',
      { 'owner.email': 'An account with this email already exists' },
    );
  }

  async getCurrent(tenant: TenantContext) {
    return this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: centerSelect,
    });
  }

  async updateCurrent(
    tenant: TenantContext,
    input: UpdateCenterDto,
    ipAddress: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.center.findUniqueOrThrow({
        where: { id: tenant.centerId },
        select: centerSelect,
      });
      const data: Prisma.CenterUpdateInput = {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of EDITABLE_FIELDS) {
        const value = input[field];
        if (value === undefined || value === before[field]) continue;
        if (
          value === null &&
          ['name', 'phone', 'address', 'timezone', 'currency'].includes(field)
        ) {
          continue; // required fields can't be cleared
        }
        Object.assign(data, { [field]: value });
        changes[field] = { from: before[field], to: value };
      }
      if (!Object.keys(changes).length) return before;

      const updated = await tx.center.update({
        where: { id: tenant.centerId },
        data,
        select: centerSelect,
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'center.updated',
          entityType: 'Center',
          entityId: tenant.centerId,
          metadata: changes as Prisma.InputJsonValue,
          ipAddress,
        },
        tx,
      );
      return updated;
    });
  }

  /** Centers where the user has an active membership, with their role in each. */
  async listForUser(userId: string) {
    const memberships = await this.prisma.centerMembership.findMany({
      where: {
        userId,
        status: MembershipStatus.ACTIVE,
        center: { status: CenterStatus.ACTIVE },
      },
      select: {
        role: true,
        center: { select: { id: true, code: true, name: true, logoUrl: true } },
      },
      orderBy: { center: { name: 'asc' } },
    });
    return memberships.map((m) => ({ ...m.center, role: m.role }));
  }
}
