import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { AuthContext, TenantContext } from '../auth/auth-context';
import { PasswordService } from '../auth/password.service';
import { isUniqueViolation } from '../centers/centers.service';
import { apiError } from '../common/errors';
import { generateToken, hashToken } from '../common/tokens';
import { AppConfig } from '../config/app-config';
import type { Prisma } from '../generated/prisma/client';
import {
  CenterStatus,
  MembershipStatus,
  Role,
  UserStatus,
} from '../generated/prisma/enums';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AcceptInvitationDto, InviteStaffDto } from './dto';

const invitationSelect = {
  id: true,
  email: true,
  fullName: true,
  mobile: true,
  role: true,
  expiresAt: true,
  createdAt: true,
  invitedBy: { select: { fullName: true } },
} satisfies Prisma.InvitationSelect;

type InvitationRow = Prisma.InvitationGetPayload<{
  select: typeof invitationSelect;
}>;

function toSummary(row: InvitationRow) {
  const { invitedBy, ...rest } = row;
  return {
    ...rest,
    invitedByName: invitedBy.fullName,
    expired: row.expiresAt <= new Date(),
  };
}

const INVALID_LINK =
  'This invitation link is invalid or has expired. Ask your center administrator to send a new one.';

const invalidLink = () =>
  apiError(HttpStatus.NOT_FOUND, INVALID_LINK, 'INVITATION_INVALID');

export interface NewInvitation {
  centerId: string;
  invitedById: string;
  email: string;
  fullName: string;
  mobile?: string | null;
  role: Role;
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
  ) {}

  private link(token: string) {
    return `${this.config.webAppUrl}/invite?token=${encodeURIComponent(token)}`;
  }

  /**
   * Creates an invitation inside the caller's transaction and returns the raw token for
   * the email. Rejects people who already belong to the center and open invitations.
   * Responses are the same whether or not the email has a Carezino account elsewhere.
   */
  async createInTx(tx: Prisma.TransactionClient, input: NewInvitation) {
    const member = await tx.centerMembership.findFirst({
      where: { centerId: input.centerId, user: { email: input.email } },
      select: { id: true },
    });
    if (member) {
      throw apiError(
        HttpStatus.CONFLICT,
        'This person is already on your staff list. Change their status there instead.',
        'ALREADY_MEMBER',
        { email: 'Already on your staff list' },
      );
    }
    const open = await tx.invitation.findFirst({
      where: {
        centerId: input.centerId,
        email: input.email,
        acceptedAt: null,
        revokedAt: null,
      },
      select: { id: true, expiresAt: true },
    });
    if (open && open.expiresAt > new Date()) {
      throw apiError(
        HttpStatus.CONFLICT,
        'This email already has a pending invitation. Resend it from the Invitations tab.',
        'INVITATION_PENDING',
        { email: 'Already invited' },
      );
    }
    if (open) {
      await tx.invitation.update({
        where: { id: open.id },
        data: { revokedAt: new Date() },
      });
    }

    const token = generateToken();
    const invitation = await tx.invitation.create({
      data: {
        centerId: input.centerId,
        invitedById: input.invitedById,
        email: input.email,
        fullName: input.fullName,
        mobile: input.mobile ?? null,
        role: input.role,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + this.config.invitationTtlMs),
      },
      select: invitationSelect,
    });
    return { invitation, token };
  }

  /** Emails the invitation link. Returns whether the email was actually handed to SMTP. */
  async deliver(centerId: string, invitation: InvitationRow, token: string) {
    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: centerId },
      select: { name: true },
    });
    return this.mail.sendInvitation(invitation.email, {
      name: invitation.fullName,
      centerName: center.name,
      inviterName: invitation.invitedBy.fullName,
      link: this.link(token),
      ttlDays: Math.round(this.config.invitationTtlMs / 86_400_000),
    });
  }

  async invite(
    tenant: TenantContext,
    input: InviteStaffDto,
    ipAddress: string | null,
  ) {
    const { invitation, token } = await this.prisma.$transaction(async (tx) => {
      const created = await this.createInTx(tx, {
        ...input,
        centerId: tenant.centerId,
        invitedById: tenant.userId,
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'staff.invited',
          entityType: 'Invitation',
          entityId: created.invitation.id,
          metadata: { email: input.email, role: input.role },
          ipAddress,
        },
        tx,
      );
      return created;
    });
    const emailDelivered = await this.deliver(
      tenant.centerId,
      invitation,
      token,
    );
    return { invitation: toSummary(invitation), emailDelivered };
  }

  /** Open invitations (pending or expired, not accepted or revoked) for the active center. */
  async listOpen(tenant: TenantContext) {
    const rows = await this.prisma.invitation.findMany({
      where: { centerId: tenant.centerId, acceptedAt: null, revokedAt: null },
      select: invitationSelect,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(toSummary);
  }

  private async findOpen(tenant: TenantContext, id: string) {
    // Scoped by center: another center's invitation ID is indistinguishable from a missing one.
    const invitation = await this.prisma.invitation.findFirst({
      where: {
        id,
        centerId: tenant.centerId,
        acceptedAt: null,
        revokedAt: null,
      },
      select: { id: true },
    });
    if (!invitation) {
      throw apiError(HttpStatus.NOT_FOUND, 'Invitation not found', 'NOT_FOUND');
    }
    return invitation;
  }

  /** Issues a new link (the old one stops working) and a fresh expiry, then re-sends. */
  async resend(tenant: TenantContext, id: string, ipAddress: string | null) {
    await this.findOpen(tenant, id);
    const token = generateToken();
    const invitation = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.invitation.update({
        where: { id },
        data: {
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + this.config.invitationTtlMs),
        },
        select: invitationSelect,
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'staff.invitation_resent',
          entityType: 'Invitation',
          entityId: id,
          metadata: { email: updated.email },
          ipAddress,
        },
        tx,
      );
      return updated;
    });
    const emailDelivered = await this.deliver(
      tenant.centerId,
      invitation,
      token,
    );
    return { invitation: toSummary(invitation), emailDelivered };
  }

  async revoke(tenant: TenantContext, id: string, ipAddress: string | null) {
    await this.findOpen(tenant, id);
    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.invitation.update({
        where: { id },
        data: { revokedAt: new Date() },
        select: { email: true },
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'staff.invitation_revoked',
          entityType: 'Invitation',
          entityId: id,
          metadata: { email: revoked.email },
          ipAddress,
        },
        tx,
      );
    });
  }

  private async findByToken(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { center: { select: { id: true, name: true, status: true } } },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= new Date() ||
      invitation.center.status !== CenterStatus.ACTIVE
    ) {
      throw invalidLink();
    }
    return invitation;
  }

  /**
   * What the accept page shows, or `{ valid: false }` for an unknown, used, revoked or
   * expired link. Only the holder of the emailed link can call this.
   */
  async preview(token: string) {
    let invitation: Awaited<ReturnType<typeof this.findByToken>>;
    try {
      invitation = await this.findByToken(token);
    } catch (error) {
      // A dead link is an expected outcome for the page, not an error response.
      if (error instanceof HttpException && error.getStatus() === 404) {
        return { valid: false as const, message: INVALID_LINK };
      }
      throw error;
    }
    const user = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });
    return {
      valid: true as const,
      centerName: invitation.center.name,
      email: invitation.email,
      fullName: invitation.fullName,
      mobile: invitation.mobile,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      accountExists: Boolean(user),
    };
  }

  /**
   * Accepts an invitation. Invitees without an account choose a password here; existing
   * users must be signed in as the invited email, so a forwarded link can't attach
   * someone else's account to the center.
   */
  async accept(
    dto: AcceptInvitationDto,
    auth: AuthContext | null,
    ipAddress: string | null,
  ) {
    const invitation = await this.findByToken(dto.token);
    const existing = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true, status: true },
    });

    let passwordHash: string | null = null;
    if (existing) {
      if (!auth) {
        throw apiError(
          HttpStatus.UNAUTHORIZED,
          'You already have a Carezino account. Sign in to accept this invitation.',
          'SIGN_IN_REQUIRED',
        );
      }
      if (auth.user.id !== existing.id) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'This invitation was sent to a different email address. Sign out, then open the link again.',
          'WRONG_ACCOUNT',
        );
      }
      if (existing.status !== UserStatus.ACTIVE) throw invalidLink();
    } else {
      const errors: Record<string, string> = {};
      if (!dto.fullName && !invitation.fullName)
        errors.fullName = 'Full name is required';
      if (!dto.password) errors.password = 'Choose a password';
      else if (dto.password !== dto.confirmPassword)
        errors.confirmPassword = 'Passwords don’t match';
      if (Object.keys(errors).length) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'Please check the highlighted fields',
          'VALIDATION_FAILED',
          errors,
        );
      }
      passwordHash = await this.passwords.hash(dto.password!);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Conditional update: two concurrent accepts can't both succeed.
        const claimed = await tx.invitation.updateMany({
          where: { id: invitation.id, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: new Date() },
        });
        if (claimed.count !== 1) throw invalidLink();

        const userId =
          existing?.id ??
          (
            await tx.user.create({
              data: {
                fullName: dto.fullName ?? invitation.fullName,
                email: invitation.email,
                mobile: dto.mobile ?? invitation.mobile,
                passwordHash: passwordHash!,
              },
              select: { id: true },
            })
          ).id;

        const membership = await tx.centerMembership.create({
          data: {
            centerId: invitation.centerId,
            userId,
            role: invitation.role,
            status: MembershipStatus.ACTIVE,
          },
          select: { id: true },
        });
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { acceptedUserId: userId },
        });
        await this.audit.record(
          {
            centerId: invitation.centerId,
            actorUserId: userId,
            action: 'staff.invitation_accepted',
            entityType: 'CenterMembership',
            entityId: membership.id,
            metadata: { invitationId: invitation.id, role: invitation.role },
            ipAddress,
          },
          tx,
        );
        return {
          userId,
          centerId: invitation.centerId,
          createdAccount: !existing,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw apiError(
          HttpStatus.CONFLICT,
          'This invitation can’t be accepted because the account is already linked to the center, or the email was just registered. Try signing in.',
          'ACCEPT_CONFLICT',
        );
      }
      throw error;
    }
  }
}
