import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { apiError } from '../common/errors';
import { generateToken, hashToken } from '../common/tokens';
import { AppConfig } from '../config/app-config';
import {
  CenterStatus,
  MembershipStatus,
  UserStatus,
} from '../generated/prisma/enums';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  requestMeta,
  type AuthContext,
  type AuthenticatedRequest,
} from './auth-context';
import {
  clearSessionCookie,
  issueCsrfCookie,
  setSessionCookie,
} from './cookies';
import type {
  AdminLoginDto,
  ChangePasswordDto,
  LoginDto,
  NewPasswordDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from './dto';
import { PasswordService } from './password.service';
import { SessionsService } from './sessions.service';

const INVALID_CREDENTIALS = 'Incorrect email or password';

function assertPasswordsMatch(dto: NewPasswordDto) {
  if (dto.password !== dto.confirmPassword) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'Please check the highlighted fields',
      'VALIDATION_FAILED',
      {
        confirmPassword: 'Passwords don’t match',
      },
    );
  }
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Signs the user in on this browser: ends any session the browser already had (no
   * session fixation), sets a new HttpOnly session cookie and rotates the CSRF token.
   */
  async startSession(
    req: Request,
    res: Response,
    userId: string,
    opts: { remember: boolean; centerId?: string },
  ) {
    const previous = (req as AuthenticatedRequest).auth?.sessionId;
    if (previous) await this.sessions.revoke(previous);
    const meta = requestMeta(req);
    const { token, expiresAt } = await this.sessions.create(userId, {
      remember: opts.remember,
      centerId: opts.centerId,
      ...meta,
    });
    setSessionCookie(res, token, {
      secure: this.config.cookieSecure,
      persistentUntil: opts.remember ? expiresAt : undefined,
    });
    issueCsrfCookie(res, this.config.cookieSecure);
  }

  async login(dto: LoginDto, req: Request, res: Response) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, passwordHash: true, status: true },
    });
    // Always run a hash comparison so timing doesn't reveal whether the email exists.
    const valid = await this.passwords.verify(user?.passwordHash, dto.password);
    if (!user || !valid || user.status !== UserStatus.ACTIVE) {
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        INVALID_CREDENTIALS,
        'INVALID_CREDENTIALS',
      );
    }
    await this.startSession(req, res, user.id, {
      remember: dto.remember ?? false,
    });
  }

  /**
   * Sign-in for platform administrators, by username. Fails with the same generic
   * message as a wrong password when the account isn't a platform administrator.
   */
  async adminLogin(dto: AdminLoginDto, req: Request, res: Response) {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      select: {
        id: true,
        passwordHash: true,
        status: true,
        isPlatformAdmin: true,
      },
    });
    const valid = await this.passwords.verify(user?.passwordHash, dto.password);
    if (
      !user ||
      !valid ||
      !user.isPlatformAdmin ||
      user.status !== UserStatus.ACTIVE
    ) {
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        'Incorrect username or password',
        'INVALID_CREDENTIALS',
      );
    }
    await this.startSession(req, res, user.id, { remember: false });
  }

  /** Revokes the session if it's still valid; the cookie is cleared either way. */
  async logout(req: AuthenticatedRequest, res: Response) {
    if (req.auth) await this.sessions.revoke(req.auth.sessionId);
    clearSessionCookie(res, this.config.cookieSecure);
    issueCsrfCookie(res, this.config.cookieSecure);
  }

  /** The signed-in user, their active center (with permissions) and centers they can switch to. */
  async me(auth: AuthContext) {
    const [user, memberships] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: auth.user.id },
        select: {
          id: true,
          fullName: true,
          email: true,
          mobile: true,
          username: true,
          isPlatformAdmin: true,
        },
      }),
      this.prisma.centerMembership.findMany({
        where: {
          userId: auth.user.id,
          status: MembershipStatus.ACTIVE,
          center: { status: CenterStatus.ACTIVE },
        },
        select: {
          role: true,
          center: {
            select: {
              id: true,
              code: true,
              name: true,
              logoUrl: true,
              timezone: true,
              currency: true,
            },
          },
        },
        orderBy: { center: { name: 'asc' } },
      }),
    ]);
    const centers = memberships.map((m) => ({ ...m.center, role: m.role }));
    const active = auth.membership
      ? centers.find((c) => c.id === auth.membership!.centerId)
      : undefined;
    return {
      user,
      activeCenter:
        active && auth.membership
          ? {
              ...active,
              membershipId: auth.membership.id,
              permissions: auth.membership.permissions,
            }
          : null,
      centers: centers.map(({ id, code, name, logoUrl, role }) => ({
        id,
        code,
        name,
        logoUrl,
        role,
      })),
    };
  }

  async updateProfile(auth: AuthContext, dto: UpdateProfileDto) {
    await this.prisma.user.update({
      where: { id: auth.user.id },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName }),
        ...(dto.mobile !== undefined && { mobile: dto.mobile }),
      },
    });
  }

  /**
   * Always succeeds from the caller's point of view, so it can't be used to find out
   * which emails have accounts. The email itself is sent in the background.
   */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, fullName: true, email: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) return;

    const token = generateToken();
    const ttl = this.config.passwordResetTtlMs;
    await this.prisma.$transaction([
      // Only the newest link works.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + ttl),
        },
      }),
    ]);
    const link = `${this.config.webAppUrl}/reset-password?token=${encodeURIComponent(token)}`;
    void this.mail
      .sendPasswordReset(
        user.email,
        user.fullName,
        link,
        Math.round(ttl / 60_000),
      )
      .catch(() => this.logger.error('Password reset email failed'));
  }

  async resetPassword(dto: ResetPasswordDto) {
    assertPasswordsMatch(dto);
    const invalid = () =>
      apiError(
        HttpStatus.BAD_REQUEST,
        'This reset link is invalid or has expired. Request a new one.',
        'RESET_TOKEN_INVALID',
      );
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
      include: { user: { select: { status: true } } },
    });
    if (
      !record ||
      record.usedAt ||
      record.expiresAt <= new Date() ||
      record.user.status !== UserStatus.ACTIVE
    ) {
      throw invalid();
    }
    const passwordHash = await this.passwords.hash(dto.password);
    await this.prisma.$transaction(async (tx) => {
      // Conditional claim: a token can only be used once, even by concurrent requests.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw invalid();
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      // Whoever had the old password is signed out everywhere.
      await tx.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async changePassword(auth: AuthContext, dto: ChangePasswordDto) {
    assertPasswordsMatch(dto);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: { passwordHash: true },
    });
    if (
      !(await this.passwords.verify(user.passwordHash, dto.currentPassword))
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'Please check the highlighted fields',
        'VALIDATION_FAILED',
        {
          currentPassword: 'Current password is incorrect',
        },
      );
    }
    if (dto.password === dto.currentPassword) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'Please check the highlighted fields',
        'VALIDATION_FAILED',
        {
          password: 'Choose a password different from your current one',
        },
      );
    }
    await this.prisma.user.update({
      where: { id: auth.user.id },
      data: { passwordHash: await this.passwords.hash(dto.password) },
    });
    // Keep this browser signed in; sign out every other device.
    await this.sessions.revokeAllForUser(auth.user.id, auth.sessionId);
  }
}
